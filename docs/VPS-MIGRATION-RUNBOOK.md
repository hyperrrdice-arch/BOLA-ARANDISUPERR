# Runbook Pindah VPS — Football Agent (< 10 Menit)

SOP memindahkan seluruh aplikasi (web + 7 DB SQLite + seluruh cron produksi)
dari VPS lama ke VPS baru tanpa kehilangan ledger. Arsitektur target:
Docker Compose 3 service (`web`, `scheduler`, `caddy`) — lihat
`docker-compose.yml`, `Dockerfile`, `ops/crontab.docker`.

Prasyarat VPS baru: Ubuntu/Debian + Docker Engine + Docker Compose v2 +
git. Tidak ada dependensi host lain (Node, tsx, Supercronic, tzdata semua
di dalam image).

---

## Langkah 0 — Persiapan (sebelum jendela pindah)

1. Turunkan TTL DNS `bola.mhmdarandi.biz.id` ke 60 detik (≥ 1 jam sebelum
   pindah) supaya propagasi A record baru cepat.
2. Pastikan `.env.local` terbaru tersedia untuk disalin (berisi token
   API-Football, football-data.org, dsb. — JANGAN lewat git/chat publik;
   pakai `scp` langsung antar-host).

## Langkah 1 — Backup final dari host lama

Di checkout/host lama:

```bash
cd ~/workspace/coding/app-football   # atau direktori app di host lama
npx tsx scripts/backup-sqlite-safe.ts
```

Script memindai semua `.db` di `DB_DIR`, membuat snapshot `VACUUM INTO`,
memverifikasi `PRAGMA integrity_check` tiap snapshot (gagal keras bila
satu pun tidak `ok`), dan menghasilkan:

```
<DB_DIR>/backups/bola-backup-<timestamp>.tar.gz
<DB_DIR>/backups/bola-backup-<timestamp>.tar.gz.sha256
```

Verifikasi arsip sebelum pindah:

```bash
cd <DB_DIR>/backups
sha256sum -c bola-backup-<timestamp>.tar.gz.sha256   # harus: OK
```

Bila host lama adalah instalasi Docker: jalankan script yang sama di dalam
service scheduler — `docker compose exec scheduler npx tsx scripts/backup-sqlite-safe.ts`
(arsip mendarat di `./storage/backups/` host).

## Langkah 2 — Nyalakan VPS baru

```bash
git clone https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR.git app-football
cd app-football
# salin .env.local dari host lama (scp), lalu ekstrak SEMUA .db ke ./storage/
scp <host-lama>:<path>/.env.local .
mkdir -p storage
tar -xzf bola-backup-<timestamp>.tar.gz -C /tmp/restore
cp /tmp/restore/bola-backup-<timestamp>/*.db storage/
docker compose up -d --build
```

Yang terjadi: `web` menyala dengan `DB_DIR=/app/storage` (semua .db dibaca
dari volume `./storage`), `scheduler` mulai sesudah `web` sehat dan
menjalankan seluruh jadwal WIB dari `ops/crontab.docker`, `caddy` menunggu
DNS untuk menerbitkan sertifikat.

## Langkah 3 — Verifikasi pasca-nyala (sebelum & sesudah DNS)

1. **Healthcheck:** `curl http://127.0.0.1:3101/healthz` dari dalam VPS
   (atau `docker compose ps` — `web` harus `healthy`) → **HTTP 200**.
2. **Angka kohor sama:** buka `/` dan `/bukti` (via IP/hosts lokal sebelum
   DNS dipindah) — headline kohor `/bukti` harus sama persis dengan host
   lama (jumlah pilihan dinilai + persentase). Beda angka = DB yang
   terpasang bukan snapshot terakhir; ulangi Langkah 1–2.
3. **Integritas di container:**
   ```bash
   docker compose exec web node -e "const {DatabaseSync}=require('node:sqlite');for(const f of ['picks.db','market_snapshots.db','analysis_snapshots.db']){const d=new DatabaseSync('/app/storage/'+f,{readOnly:true});console.log(f, d.prepare('PRAGMA integrity_check').get());d.close();}"
   ```
   Semua harus `integrity_check: 'ok'`.
4. **DNS:** arahkan A record `bola.mhmdarandi.biz.id` ke IP VPS baru.
   Caddy menerbitkan sertifikat HTTPS otomatis (ACME) dalam ±1 menit;
   verifikasi `curl -I https://bola.mhmdarandi.biz.id/` → 200.
5. **Matikan host lama** hanya sesudah langkah 1–4 hijau (host lama adalah
   rollback: bila ada yang salah, kembalikan A record ke IP lama).

## Jadwal yang otomatis hidup di VPS baru (WIB, via scheduler)

| Jam | Job |
| :--- | :--- |
| 03:00 | `import-fdorg-results.ts` (hasil FINISHED football-data.org) |
| 03:30 | `backup-sqlite-safe.ts` (backup harian + retensi 7 hari) |
| 04:21 & 16:21 | `free-refresh.ts` (rantai 9 langkah incl. WAL checkpoint) |
| 09:00 & 18:00 | `capture-odds-apifootball.ts` |
| 13:30 | `generate-fix4-ticket.ts` (tiket resmi harian) |

Untuk backup off-host otomatis, set `RCLONE_REMOTE` (mis. `r2:bola-backups`)
di `.env.local` — script backup mengunggah arsip + `.sha256` tiap run.
Untuk replikasi kontinu nyaris-real-time, lihat `litestream.yml.example`.

## Opsional — Recreate `ml1-venv` (riset shadow offline, BUKAN produksi)

Hanya bila eksperimen ML shadow (ML1 dst.) akan dilanjutkan di VPS baru.
Web & cron produksi TIDAK membutuhkannya:

```bash
python3 -m venv ~/workspace/tools/ml1-venv
~/workspace/tools/ml1-venv/bin/pip install lightgbm
~/workspace/tools/ml1-venv/bin/python -c "import lightgbm; print(lightgbm.__version__)"
```
