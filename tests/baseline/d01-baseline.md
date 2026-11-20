# Baseline D01 — perilaku aktual terekam (K0)

- Direkam: 2026-11-20T04:24:52.820Z dari commit `b9b38713b214f4e34c5e56c4cb5c222e4ab50c64` (Node v24.22.1).
- Skenario: `tests/d01-scenario.ts` — sandbox fixture segar, urutan penuh
  importer → builder alias → resolver → adapter, dijalankan DUA KALI.
- Perintah reproduksi persis: `npm run test:baseline:d01` (menjalankan
  ulang skenario yang sama dari `tests/d01-scenario.ts` lalu
  membandingkan), atau `npx --no-install tsx tests/record-d01-baseline.ts`
  untuk merekam ulang baseline dari kode saat itu.

## Harapan acceptance.json (belum terpenuhi di baseline ini)

- 2 pick ter-resolve, verdict [hit, miss]
- 2 laga selesai (finished + skor)
- 4 log sisi tim (telemetri tersedia di CSV fixture)
- hitungan rerun identik

## Aktual terekam

| Metrik | Harapan | Run 1 | Run 2 |
|---|---|---|---|
| pick ter-resolve | 2 | 0 | 0 |
| verdict | [hit, miss] | [] | [] |
| laga fixture selesai | 2 | 1 | 1 |
| log sisi tim (2 laga) | 4 | 2 | 2 |
| tautan kembar katalog | — | 0 | 0 |
| resolver examined/resolved | 2/2 | 2/0 | 2/0 |
| impor: inserted/bridged/already | — | 1/1/0 | 0/1/1 |
| impor: log telemetri | — | 2 | 0 |
| adapter getResult sm_901 | skor 2–1 | null | null |
| adapter getResult sm_902 | skor 0–1 | null | null |

Metrik lengkap (termasuk tally impor dan hasil adapter per id) ada di
`d01-baseline.json` — itulah yang dibandingkan `test:baseline:d01`
secara persis. Perubahan perilaku apa pun (membaik atau memburuk) tanpa
pembaruan baseline yang disadari membuat perintah itu exit 1.
