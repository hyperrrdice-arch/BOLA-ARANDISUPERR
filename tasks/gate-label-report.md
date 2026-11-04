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

## Koreksi (2026-11-05, ditemukan dari pertanyaan owner soal 46 laga piala)

Angka verifikasi di atas **kurang lengkap**: re-run `calibrate-ratings.ts`
yang berdiri sendiri menulis ulang `calibrated_ratings.json` TANPA blok
`canonical.cupOffsets` — blok itu produsennya `scripts/fit-global-offsets.ts`
(dalam rantai daily-refresh urutannya memang calibrate → fit-offsets; run
manual di tugas ini melompati langkah kedua). Akibatnya 46 fixture piala
gagal di-rate dengan alasan "cupOffset absen", termasuk 35 laga UEL/UECL.

Perbaikan: `fit-global-offsets.ts` dijalankan (graf europe/conmebol/afc
ter-fit ulang; AFC kini 10 liga teridentifikasi, 265 jangkar). Efek
samping by-design: entri JSON SM1085/SM1088 dihapus produsen itu (kompetisi
piala dilayani model offset, bukan fit liga) — fit uncalibrated tertulis
efektif 6 liga domestik.

**Angka verifikasi FINAL (slate 48 jam, jendela sama persis):**

- Rated 75 (baseline aturan lama) → **109**; unrated 57 → **23**.
- Rated per status: calibrated 29, partial 59, **uncalibrated 21**
  (10 domestik + 11 piala berstatus uncalibrated tapi tercakup graf).
- 24 dari 46 fixture piala yang semula gagal kini ter-rate (UEL +13,
  UECL +9, ACL Two +1, FA Cup +1). Sisa 22 fixture piala memang di luar
  cakupan graf: minimal satu tim berasal dari liga tanpa fit/δ (mis.
  tim Siprus/Lincoln Red Imps/Olympique Cayenne) + 1 fixture ratings
  tidak ditemukan.
- Probe Leverkusen vs Marseille: cupOffset europe terisi
  (δ Bundesliga −0,1628; δ Ligue 1 −0,1942), status partial.

## Yang SENGAJA tidak berubah

- Registry & gerbang ukur (uji skala 2%, gerbang OOS) tetap jalan apa
  adanya — status tetap dihitung dari bukti; yang berubah hanya
  konsekuensi status terhadap penyajian.
- Parlay lab (populasi ukur historis = calibrated) tidak diubah — itu
  definisi pengukuran, bukan gerbang saji.
- Grade kejujuran pasar dari lab (mis. BTTS mentok C) tetap — itu info
  label, bukan blokir.
