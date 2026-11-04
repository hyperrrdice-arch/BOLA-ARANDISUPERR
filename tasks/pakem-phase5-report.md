# Acuan Pakem Fase 5 — Bukti Angka + Peralihan Saji

Tanggal: 2026-11-05. Metode: potret form 6-laga terakhir lewat jalur saji
asli (`getTeamRollingTelemetry`) untuk semua 1.549 nama tim unik di
`data/calibrated_ratings.json`, sebelum vs sesudah peralihan
(`tasks/form-snapshot-before.json` / `tasks/form-snapshot-after.json`,
dibangun `scripts/measure-form-snapshot.ts`).

## Yang dialihkan

`getPreMatchLogs` (lib/db/team-telemetry.ts) kini membaca
`team_match_logs_canonical` lewat registry (lib/quant/team-identity.ts):
filter `source='sportmonks'` + dedupe manual pensiun; tim yang tidak
dikenal registry jatuh ke perilaku lama persis. Definisi harness
(backtest-walkforward / parlay-lab) TIDAK berubah.

## Hasil ukur

- Tim dengan sampel form: **1.273 → 1.471** (+198 tim yang sebelumnya
  buta form — kebanyakan nama bentuk panjang Jerman "1. FC …" yang
  resolusi lama lewatkan, plus AC Milan dkk).
- Dari 1.273 tim yang punya sampel di dua-duanya: **1.176 identik**
  GF/GA-nya; median |ΔGF| dan |ΔGA| = **0,00**. Peralihan tidak mengubah
  apa pun di tempat data lama sudah lengkap.
- Fenerbahçe: identik sebelum/sesudah (1,67 / 2,00 — angka bersih pasca
  perbaikan fase C); bentuk nama ASCII "Fenerbahce" naik dari sampel 0
  menjadi 6 penuh lewat alias registry.
- Penggerak terbesar semuanya perubahan komposisi jendela yang bisa
  dijelaskan, bukan inflasi:
  - Beveren: sebelum cuma 1 laga sampel (GA 8,00 — satu laga piala) →
    sesudah jendela 6 laga wajar 1,83/1,67. Angka lama yang patologis.
  - Al Ahli: dua pecahan id SM (9908 + 17837) kini satu jendela.
  - Sisanya (Angers, Burnley, Genk, Eyüpspor, …): laga tambahan dari
    sumber gratis/legacy masuk jendela; arah perubahan dua arah.
- Tidak ada pola pergeseran tak wajar (tidak ada tim yang GA-nya
  melonjak karena dobel-hitung — arah perbaikan justru sebaliknya).

## Sisa yang disadari

- 48 baris `goals_conflict=1` di tabel kanonik: skor antar sumber beda,
  dipilih per prioritas dan ditandai — belum diaudit satu-satu (volume
  kecil, dampak form terbatas karena pemenang tetap sumber prioritas).
- Tabel asal `team_match_logs` tetap utuh sebagai lapisan mentah;
  lapisan kanonik dibangun ulang reproduksibel dari sana + registry.
