# Indeks Bukti Visual — Ronde Upgrade Frontend Bola (P0 + P1 + P2)

Brief: `Brief-Upgrade-Frontend-Bola.pdf` (audit situs publik, 22 Nov 2026).
Branch: `upgrade/frontend-amoled`. "Sebelum" pada P0/P1 = build master
`cb979eb` (tema terang redesain); "sebelum" pada P2 = build master yang
sama untuk perbandingan ronde penuh, "sesudah" = tip branch sesudah P2.
Semua tangkapan dari Chromium headless (puppeteer-core + @sparticuz/
chromium), data produksi lokal yang sama.

## P0 — Fondasi AMOLED + perbaikan P0 audit
Folder: `../upgrade-p0-evidence/` · Laporan: `../upgrade-p0-report.md`

- Jadwal sebelum/sesudah 320/360/390 + seri Plzeň (baris 350,5 → 165 px
  di 320; pecah kata di tengah = 0) + `*-jadwal-plzen.json`.
- Rekam hasil sebelum/sesudah 320/360/390 (scrollWidth 333 → 320;
  tepi kanan tab "Batal" 333 → 86; ringkasan y 680 → 388).
- Detail + matriks sebelum/sesudah 320/390 (sel 12×44 → 44×44;
  kontras teks sel minimum 2,34:1 → 5,21:1).
- `sebelum-ukuran.json` / `sesudah-ukuran.json` — seluruh angka probe.

## P1 — Beranda ringkas, Pilihan tak terpotong, panel filter tuntas
Folder: `../upgrade-p1-evidence/` · Laporan: `../upgrade-p1-report.md`

- Beranda 390 sebelum/sesudah (sorotan 335 → 129 px; baris jadwal
  pertama y 618 → 392; baris utuh sebelum nav bawah 1 → 4).
- Pilihan 320/390 sebelum/sesudah (baris terpotong 24/40 → 0/40 di 320;
  2/40 → 0/40 di 390) + `sesudah-interaksi.json` (alur draf penuh).
- Panel Rekam hasil sesudah (`sesudah-bukti-panel-390.png`): Terapkan =
  CTA jingga, Atur ulang sadar zona waktu.
- `sebelum-ukuran.json` / `sesudah-ukuran.json`.

## P2 — Grafik/tooltip gelap, transisi, desktop, audit jarak, penerimaan
Folder: `./` (folder ini) · Laporan: `../upgrade-p2-report.md`

Sebelum/sesudah kelima templat di 390 px:
`sebelum|sesudah-{beranda,jadwal,detail,pilihan,bukti}-390.png`.
Jadwal + Rekam hasil di 320 px: `sebelum|sesudah-{jadwal,bukti}-320.png`.
Beranda + Jadwal di 1440 px: `sebelum|sesudah-{beranda,jadwal}-1440.png`.

Khusus P2 (sesudah):
- `sesudah-matriks-aktif-390.png` — filter "Tamu" aktif: sel tersaring
  memakai gaya redup baru (kontras efektif 6,21:1; sebelumnya
  opacity-40 = 2,06:1). Pasangan: `sebelum-matriks-aktif-390.png`.
- `sesudah-matriks-3d-390.png` — peta 3D dengan palet AMOLED (batang
  jingga aksen di atas lantai gelap; sebelumnya hijau palet terang).
- `sebelum|sesudah-filter-bukti-320.png` — panel filter Rekam hasil
  terbuka; `sesudah-filter-jadwal-390.png` — lembar filter Jadwal.
- `sesudah-keadaan-kosong-390.png` — Jadwal tanpa hasil filter;
  `sesudah-keadaan-error-390.png` — pertandingan tidak ditemukan.
- `sesudah-jadwal-landscape.png` — landscape ponsel 844×390;
  `sesudah-jadwal-teks200.png` — emulasi teks 200% (zoom CSS 2×).
- `ukur-sebelum-p2.json` / `ukur-sesudah-p2.json` — pengukuran bedah
  jarak + kontras sel + transisi + kontainer sebelum/sesudah.
- `penerimaan-sesudah.json` — sapuan penerimaan penuh: reflow 5 rute ×
  7 lebar (35/35 lolos), nama panjang, tab "Batal", keadaan, navigasi
  keyboard matriks, nav desktop 768/1024/1440, alur Pardubice.

## Angka kunci lintas ronde
| Ukuran | Master (terang) | Sesudah P0 | Sesudah P1 | Sesudah P2 |
|---|---|---|---|---|
| Baris Bohemians 320 px | 350,5 px | 165 px | 165 px | 165 px |
| Kontras min. teks sel matriks | 2,34:1 | 5,21:1 | 5,21:1 | 5,21:1 |
| Kontras sel tersaring terpanas | — (opacity-40) | 2,06:1 | 2,06:1 | **6,21:1** |
| Sorotan Beranda 390 px | 335 px | 335 px | 129 px | 129 px |
| scrollWidth /bukti di 320 | 333 | 320 | 320 | 320 |
| Lebar kontainer desktop | 1240 px | 1240 px | 1240 px | **1200 px** |
| Reflow root 5 rute × 7 lebar | — | — | — | **35/35 lolos** |
