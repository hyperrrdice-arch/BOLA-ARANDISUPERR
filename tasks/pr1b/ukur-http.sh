#!/usr/bin/env bash
# PR 1B: ukur TTFB/total HTTP staging (port 3199, cwd = worktree ini,
# data/ = salinan produksi). Pemakaian: ukur-http.sh <label>
# Mengukur: Beranda `/` (1 dingin + 24 hangat), kontrol Jadwal
# `/pertandingan` (1 pemanasan + 10 hangat), kontrol detail satu laga
# (1 pemanasan + 10 hangat). Server dimatikan di akhir.
set -u
LABEL="${1:-tanpa-label}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT=3199
BASE="http://127.0.0.1:$PORT"
OUT="/tmp/pr1b-ukur-$LABEL"
mkdir -p "$OUT"

cd "$ROOT"
node_modules/.bin/next start -p $PORT > "$OUT/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for i in $(seq 1 60); do
  curl -s -o /dev/null "$BASE/healthz" && break
  sleep 1
done

pctl() { # pctl <file> <p50|p95> — nilai detik, satu per baris
  sort -n "$1" | awk -v p="$2" '{a[NR]=$1} END { i = int(p * NR / 100); if (i < 1) i = 1; if (i > NR) i = NR; printf "%.3f", a[i] }'
}

ukur() { # ukur <path> <n_hangat> <prefix>
  local path="$1" n="$2" prefix="$3"
  curl -s -o "$OUT/$prefix-cold.html" -w "%{time_total}\n" "$BASE$path" > "$OUT/$prefix-cold.txt"
  : > "$OUT/$prefix-warm.txt"
  for i in $(seq 1 "$n"); do
    curl -s -o /dev/null -w "%{time_total}\n" "$BASE$path" >> "$OUT/$prefix-warm.txt"
  done
  local cold p50 p95 bytes
  cold=$(cat "$OUT/$prefix-cold.txt")
  p50=$(pctl "$OUT/$prefix-warm.txt" 50)
  p95=$(pctl "$OUT/$prefix-warm.txt" 95)
  bytes=$(stat -c%s "$OUT/$prefix-cold.html")
  echo "{\"label\":\"$LABEL\",\"rute\":\"$path\",\"dingin_s\":$cold,\"hangat_p50_s\":$p50,\"hangat_p95_s\":$p95,\"byte_dokumen\":$bytes}"
}

# Detail kontrol: laga sorotan dari snapshot parity (data tetap).
MID=$(python3 -c "import json;print(json.load(open('$ROOT/tasks/pr1b/evidence/snapshot-sebelum.json'))['sorotan']['match_id'])" 2>/dev/null || echo "")

ukur "/" 24 beranda
ukur "/pertandingan" 10 jadwal
if [ -n "$MID" ]; then
  ukur "/pertandingan/$MID" 10 detail
fi
grep -E "\[timing\]|\[eventloop\]|event-loop" "$OUT/server.log" | tail -5 || true
kill $SRV 2>/dev/null
trap - EXIT
