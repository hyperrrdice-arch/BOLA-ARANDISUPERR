# Baseline D01 — regresi hijau (K1) + histori kegagalan (K0)

- Direkam ulang: 2026-11-20T05:01:53.098Z dari commit `76e9f3678fe591d36fd576ac763c1aaec7ea4928` (Node v24.22.1).
- Skenario: `tests/d01-scenario.ts` — sandbox fixture segar, urutan penuh
  importer → builder alias → resolver → adapter, dijalankan DUA KALI.
- Perintah reproduksi persis: `npm run test:baseline:d01` (menjalankan
  ulang skenario yang sama dari `tests/d01-scenario.ts` lalu
  membandingkan), atau `npx --no-install tsx tests/record-d01-baseline.ts`
  untuk merekam ulang baseline dari kode saat itu.

## Histori K0 — kegagalan yang dibekukan (statis, jangan dihapus)

Direkam 2026-11-20T04:24:52.820Z dari commit
`b9b38713b214f4e34c5e56c4cb5c222e4ab50c64` (kode audit, sebelum K0/K1):

| Metrik | Harapan | Run 1 (K0) | Run 2 (K0) |
|---|---|---|---|
| pick ter-resolve | 2 | 0 | 0 |
| verdict | [hit, miss] | [] | [] |
| laga fixture selesai | 2 | 1 | 1 |
| log sisi tim (2 laga) | 4 | 2 | 2 |
| tautan kembar katalog | — | 0 | 0 |
| resolver examined/resolved | 2/2 | 2/0 | 2/0 |
| adapter getResult sm_901 | skor 2–1 | null | null |
| adapter getResult sm_902 | skor 0–1 | null | null |
| adapter getResult fd_ (Alpha) | skor 2–1 | {"home_goals":2,"away_goals":1,"finished":false} | sama |

Tiga titik putus terukur saat itu: (1) importer menulis hasil Gamma/Delta
sebagai baris `fd_` baru alih-alih meng-update baris `sm_902` yang sudah
`scheduled` (jembatan tercatat, skor tidak pernah ditulis); (2) builder
alias menghasilkan 0 tautan karena hasil `fd_` hidup di dataset, bukan
katalog; (3) resolver examined=2/resolved=0 pada kedua run; ditambah
adapter web memeriksa status `'FT'` sedangkan dataset memakai
`'finished'`, dan parser tautan web mencari `groups` sedangkan builder
menulis `links`. K1 memperbaiki kelimanya lewat resolver identitas satu
pintu (`lib/identity/fixture-resolver.ts`).

## Aktual terekam saat ini (sesudah perbaikan K1)

Harapan acceptance.json kini terpenuhi: 2 pick ter-resolve dengan verdict
[hit, miss], 2 laga selesai, 4 log sisi tim, hitungan rerun identik.

| Metrik | Harapan | Run 1 | Run 2 |
|---|---|---|---|
| pick ter-resolve | 2 | 2 | 2 |
| verdict | [hit, miss] | [hit, miss] | [hit, miss] |
| laga fixture selesai | 2 | 2 | 2 |
| log sisi tim (2 laga) | 4 | 4 | 4 |
| fixture kanonik (UID) | 2 | 2 | 2 |
| alias identitas | 4 | 4 | 4 |
| revisi hasil | 2 | 2 | 2 |
| tautan kembar katalog | — | 0 | 0 |
| resolver examined/resolved | 2/2 | 2/2 | 0/0 |
| impor: inserted/bridged/already | — | 1/1/0 | 0/0/2 |
| impor: log telemetri | — | 4 | 0 |
| adapter getResult sm_901 | skor 2–1 | {"home_goals":2,"away_goals":1,"finished":true} | {"home_goals":2,"away_goals":1,"finished":true} |
| adapter getResult sm_902 | skor 0–1 | {"home_goals":0,"away_goals":1,"finished":true} | {"home_goals":0,"away_goals":1,"finished":true} |

Metrik lengkap (termasuk tally impor dan hasil adapter per id) ada di
`d01-baseline.json` — itulah yang dibandingkan `test:baseline:d01`
secara persis, di samping assertion harapan eksplisit di suite yang sama.
Perubahan perilaku apa pun (membaik atau memburuk) tanpa pembaruan
baseline yang disadari membuat perintah itu exit 1.
