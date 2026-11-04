# Gerbang Kalibrasi → Label (Keputusan Owner 2026-11-05)

**Keputusan owner (2026-11-05 03:01–03:03 WIB, main chat):** gerbang kalibrasi
menjadi LABEL, bukan pembatas — "dilabelin tapi gausah dibatasin 5%".
Alasan owner: judi tidak ada yang pasti; app ini alat bantu menaikkan
confidence level, bukan mesin kepastian. Scope yang dikonfirmasi owner:
semua liga tersaji berlabel jujur; blokir uncalibrated + cap grade dari
gerbang dilepas; grade kejujuran pasar dari lab tetap tampil sebagai info.

## Perubahan kode (branch `safe-bet-parlay`)

- `lib/picks/engine.ts` — `applyGateCap` jadi pass-through: grade murni dari
  tabel lab untuk semua status gerbang. `gate_status` tetap tercatat di
  paket/ledger sebagai label.
- `lib/quant/ratings-loader.ts` — blokir domestik uncalibrated dicabut;
  early-return uncalibrated di cabang piala dicabut. Status tetap menempel
  di metadata (`calibrationStatus` + `calibrationGate`).
- `scripts/pick-slate.ts` — dua blokir uncalibrated dicabut (pre-check
  registry + cek gateFinal). Fixture uncalibrated kini di-rate; yang gugur
  hanya karena ketiadaan data (tim tak ter-resolve / di luar graf offset).
- `scripts/calibrate-ratings.ts` — liga yang gugur di gerbang OOS kini
  fit-nya TETAP ditulis ke `calibrated_ratings.json` dengan status
  registry `uncalibrated` (sebelumnya dihapus dari JSON). Liga tanpa fit
  sama sekali (data belum cukup / fit gagal) tetap tidak ditulis — tidak
  ada angka karangan. Durable: script ini bagian dari rantai daily-refresh.
- `lib/quant/league-gate.ts` + `lib/quant/global-offsets.ts` — teks alasan
  & komentar diselaraskan (label, bukan blokir).

## Langkah data yang menyertai

- Re-run `scripts/calibrate-ratings.ts`: JSON 72 → **80 liga**; 7 fit
  uncalibrated kini tertulis: SM14 League Two, SM274 First Division (DK),
  SM603 1. Lig (TR), SM860 Botola Pro, SM1073 V-League, SM1088 ACL Two,
  SM1356 A-League Men.
- Rebuild `data/league-canonical.json` (`scripts/build-league-canonical.ts`):
  250 entri tetap; `fits` berubah HANYA untuk 7 liga itu (+ alias
  ratings-key turunan). Tanpa rebuild ini resolusi kanonik tetap mengira
  liga-liga itu tak ber-fit (fitSystem null → fallback).

## Verifikasi (slate 48 jam, jendela sama, sebelum → sesudah)

- Rated 75 → **85**; unrated 57 → 47. Alasan unrated berunsur gerbang: **0**
  (sisa: 46 fixture piala di luar graf offset + 1 ratings tidak ditemukan —
  keduanya ketiadaan data, bukan gerbang).
- **10 fixture liga uncalibrated ter-rate** (sm:1356, sm:1073, sm:603,
  sm:274, sm:860) → **65 pick live-run berlabel `gate_status='uncalibrated'`**
  (A 19 / B 32 / C 14) tersimpan di ledger + 85 paket tersimpan.
- Cap grade gerbang terbukti lepas: pick grade A kini terbit juga dari liga
  partial (52) dan uncalibrated (19) — sebelumnya partial mentok B,
  uncalibrated nol.
- Probe fixture A-League (Sydney vs Central Coast): div SM1356,
  calibrationStatus `uncalibrated`, kedua tim `primary_league`,
  λ/μ 1,511/1,011.
- `tsc --noEmit` = 0 error.

## Yang SENGAJA tidak berubah

- Registry & gerbang ukur (uji skala 2%, gerbang OOS) tetap jalan apa
  adanya — status tetap dihitung dari bukti; yang berubah hanya
  konsekuensi status terhadap penyajian.
- Parlay lab (populasi ukur historis = calibrated) tidak diubah — itu
  definisi pengukuran, bukan gerbang saji.
- Grade kejujuran pasar dari lab (mis. BTTS mentok C) tetap — itu info
  label, bukan blokir.
