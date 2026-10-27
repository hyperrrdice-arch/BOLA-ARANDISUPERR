# Implementation Plan: Frontend Redesign — Dark Quant Terminal

> File terpisah dari `tasks/plan.md` / `tasks/todo.md` (backend offline, worker lain).
> Plan frontend ini TIDAK menimpa plan itu. Tasks di `tasks/todo-frontend-redesign.md`.

## Overview

Frontend sekarang light monochrome (`#f5f5f5/#fff`, semua card putih radius 24px hairline
`#e5e5e5`) dan terasa berantakan karena: tidak ada hierarchy permukaan, tidak ada angka hero,
3 sumber token duplikat, ±830 hex hardcoded, `font-mono` jadi font container, dan copy
menyesatkan ("Live Feed" padahal API mati). Target: dark quant terminal mengikuti referensi
user `contohdesign.webp` (Stakent: bg `#0a0a12`, panel `#12121e`, accent lavender `#b8b0ff`,
angka besar putih, sidebar gelap tetap). Scope STRICT frontend saja — backend (`app/api/**`,
`lib/**`, `scripts/**`, `data/**`) tidak disentuh sama sekali; kontrak data (`AnalysisView`,
props komponen) tidak berubah bentuk.

## Subject Inventory (yang cuma punya app ini)

1. Probabilitas Dixon-Coles 1/X/2 + fair odds per match.
2. EV% dan Kelly stake (tabel value bets) — sinyal uang, bukan sekadar statistik.
3. Dislokasi model vs konsensus pasar (Shin vig-stripping).
4. Debat sindikat multi-persona (bull/bear/supreme verdict).
5. Katalog 378 fixture lokal s/d 29 Nov 2026, 112 ber-odds anchor (offline, bukan live).
6. Skor integritas data (grounded %) + daftar gaps jujur.
7. 500+ pasar 1xBet on-demand per match (scan manual, kuota terbatas).
8. Form W/D/L, xG splits, wasit, cedera Tier-1 lokal.
9. Analisis lama: tipikal 2–7 menit per match.
10. Brand final (keputusan user 19 Okt 2026): **MENCARI UANG DARI PARLAY** — menggantikan
   "Football Agent" (metadata `app/layout.tsx:16`) dan "BOLA-ARANDISUPERR" (`app/page.tsx:321`).

## Argument (klaim per view, urutan = prioritas mata)

| View | Klaim | Bukti di layar |
|---|---|---|
| Katalog | "Pilih laga yang datanya paling siap dianalisis" | Kickoff/countdown, chips kelengkapan data (odds/xG/form), count liga |
| Ringkasan | "Ini vonisnya dan kenapa" | Verdict hero, confidence, faktor kunci, pick #1 |
| Kuantitatif | "Model bilang peluangnya segini" | 3 asset card 1/X/2, prob bar, parameter, tabel Kelly |
| Odds | "Pasar beda pendapat di sini" | Best odds, delta opening→last, bar dislokasi, EV per pasar |
| Debat | "Sindikat tidak bulat, ini peta suaranya" | Consensus bar, persona bull/bear, supreme verdict |

Section/view tanpa klaim dihapus/digabung: ticker dobel dengan katalog (klaim sama),
DataIntegrityShield sebagai card penuh (klaimnya cuma 1 baris → strip).

## The Idea

> On this page, **probabilitas Dixon-Coles + EV/Kelly sebuah match** becomes
> **asset card ala portfolio staking: angka raksasa, delta vs pasar, satu panel accent
> untuk pick terbaik**.

Competitor test: situs statistik bola biasa (SofaScore/FlashScore) menampilkan skor dan
statistik, tidak punya EV/Kelly/dislokasi model-vs-pasar — kalimat di atas gugur untuk
mereka, berlaku cuma di sini. **Live thing:** di katalog, klik liga di sidebar langsung
memfilter + menampilkan count dan laga terdekat per liga (countdown live ke kickoff
berikutnya); fallback tanpa JS = semua laga tetap terlihat. Di analisis, live thing =
slider bankroll Kelly yang sudah ada (`QuantEngineCard.tsx:205`) dipertahankan dan
diangkat keluar dari `<details>`.

## Design Direction & Deviations (wajib tercatat)

- `draw.mjs` (sector finance, seed `216420935`) mendeal `editorial-report` (serif
  Young Serif, ground putih, hero board foto, lantai 4 foto). **Ditolak, bukan di-redraw:**
  itu komposisi landing page cetak; brief ini dashboard data dan user memberi referensi
  eksplisit `contohdesign.webp`. Yang diambil dari sheet hanya prinsipnya: satu accent,
  field warna flat solid, hierarki tipe ekstrem, tanpa ornamen.
- House rules taste-skill yang **sengaja dilanggar atas dasar referensi user** (catat
  sebagai `--allow` bila inspector dipakai): (1) accent lavender — house rule melarang
  violet, referensi user memakainya sebagai satu-satunya accent; (2) `font-mono` untuk
  angka — dashboard kuantitatif butuh tabular mono, diperlakukan sebagai fragment
  `data-ui`; (3) border subtle gelap di panel — di dark theme, tone-step saja tidak cukup
  memisahkan panel dari bg. Rules yang **tetap berlaku penuh**: tanpa gradient (panel
  accent = lavender solid, bukan gradient ungu contoh), tanpa shadow saat diam, tanpa
  pill-badge/eyebrow/monospace-label dekoratif, headline ≤2 baris, tanpa icon-card grid.
- `<design_plan>` (gpt-taste, RNG simulasi Node, seed = 274 char prompt mod 97 = 80):
  hero terdeal "Cinematic Center", font "Cabinet Grotesk", komponen "Segmented Prob Bar |
  Asset Cards | Inline Typography Images", motion "Image Scale Fade | Stagger Reveal".
  Adaptasi dashboard: hero = **Dark App-Shell Sidebar** (Cinematic Center tidak berlaku
  untuk app-shell; AIDA dipetakan Attention=katalog hero strip, Interest=bento analisis,
  Desire=prob/dislokasi visual, Action=pick/Kelly CTA). Font **tetap Geist** (sudah
  terpasang via `next/font`, dilarang install dependensi tanpa izin; Cabinet = open
  question). Bento wajib `grid-flow-dense`, gap terverifikasi matematis per task.
  GSAP **tidak** diinstall di plan ini: motion CSS dulu (stagger reveal + hover physics);
  GSAP = keputusan terpisah user (lihat Open Questions).

## Architecture Decisions

- **Satu sumber token.** `design-system/theme.css` jadi satu-satunya token (diimpor
  `globals.css:2`); `design-system/variables.css` yatim dihapus/digabung. Komponen dilarang
  hex hardcoded baru — semua lewat CSS var / Tailwind theme token.
- **Dark token set:** `--bg:#0a0a12; --panel:#12121e; --panel-2:#171724;
  --border:rgba(255,255,255,.08); --accent:#b8b0ff; --accent-ink:#12121e;
  --text:#f4f4f6; --muted:#9a9aad; --success:#34d399; --danger:#fb7185; --warn:#fbbf24`.
  Lavender HANYA untuk: state aktif, CTA utama, pick #1, focus ring. Hijau/merah tetap
  semantik EV/status — tidak diganti lavender.
- **Radius 3 level saja:** panel 18px, inner 12px, pill 999px. Radius 24/20/16/14/10/6
  liar dihapus bertahap per komponen.
- **Tipe:** Geist Sans untuk UI/teks, Geist Mono HANYA angka tabular. Skala: angka hero
  32–56px, judul view 24–30px, body 14–16px, metadata 11–12px (maks 5 step terlihat).
  Token display 48px yang tak pernah dipakai mulai dipakai untuk verdict/angka hero.
- **Kontrak beku:** tidak ada perubahan props/`AnalysisView`/`types.ts` shape, tidak ada
  perubahan fetch URL/payload di `page.tsx`. Worker backend aman.
- **Next.js 16:** sebelum coding baca guide relevan di `node_modules/next/dist/docs/`
  (kewajiban AGENTS.md), terutama soal `next/font` dan dynamic import bila diubah.

## Scope

**Boleh disentuh:** `app/page.tsx`, `app/layout.tsx`, `app/globals.css`,
`components/dashboard/*.tsx`, `components/icons.tsx`, `design-system/theme.css`,
`design-system/variables.css`, file plan/todo frontend ini.

**Dilarang disentuh:** `app/api/**`, `lib/**` (termasuk `lib/view/analysis-view.ts`),
`scripts/**`, `data/**`, `tasks/plan.md`, `tasks/todo.md`, plan/todo worker lain.

## Task List

### Phase 0: Baseline & token
- [ ] Task 1: Baseline visual + kontrak beku (tanpa edit kode)
- [ ] Task 2: Konsolidasi token dark theme

### Checkpoint: Fondasi
- [ ] tsc hijau, katalog+analisis tampil dark tanpa regresi fungsi

### Phase 1: Shell & katalog
- [ ] Task 3: App shell — sidebar gelap tetap + header 1 baris
- [ ] Task 4: Katalog dark + filter toolbar + live thing countdown

### Checkpoint: Katalog
- [ ] Screenshot 1440/768/390, katalog keyboard-accessible

### Phase 2: Analisis — ringkasan & kuantitatif
- [ ] Task 5: Hero match + verdict hero menyatu
- [ ] Task 6: Ringkasan — splits, integrity strip, planner, pick lavender
- [ ] Task 7: Kuantitatif — asset card 1/X/2, prob bar, Kelly terbuka

### Checkpoint: Inti analisis
- [ ] Angka hero terbaca sekilas di 390px, tabel tidak overflow

### Phase 3: Odds & debat
- [ ] Task 8: Odds comparison dark + dislokasi visual
- [ ] Task 9: Scanner 1xBet — picks featured + markets padat
- [ ] Task 10: Debat sindikat — consensus bar + persona semantik

### Checkpoint: Semua tab
- [ ] 4 tab selesai dark, tidak ada card-dalam-card 3 lapis tersisa

### Phase 4: Motion, a11y, states, QA
- [ ] Task 11: Motion layer + accessibility hardening
- [ ] Task 12: States jujur + responsive final + verifikasi penuh

### Checkpoint: Final
- [ ] Lint taste-skill FAIL = 0 (di luar allow-list tercatat), tsc+build hijau, screenshot 3 viewport lolos critique

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Worker backend mengubah `AnalysisView` bersamaan | Med | Kontrak beku: redesign hanya konsumsi shape existing; koordinasi via types existing, jangan edit `lib/view` |
| Lavender untuk semua status mengaburkan sinyal EV | Tinggi | Aturan token: lavender = aktif/CTA/pick saja; +EV hijau, bahaya merah, selalu |
| `ssr:false` + dynamic chunk blank saat pindah tab | Med | Task 11/12: beri `loading` fallback; komponen kecil (DataIntegrityShield) kembali eager |
| Analisis 2–7 menit terasa menggantung di tema baru | Tinggi | Task 12: stage progress jujur + tombol Batalkan eksplisit + skeleton hasil |
| Klaim "live" lama tertinggal di copy baru | Med | Task 12 audit copy: offline/anchor diberi label apa adanya |
| Install GSAP/font baru tanpa izin | Rendah | Tidak di plan ini; keputusan user dulu (Open Questions) |

## Open Questions

- ~~Brand final~~ **SELESAI (19 Okt 2026): MENCARI UANG DARI PARLAY.** Dipakai apa adanya
  sebagai wordmark sidebar/header dan metadata title (Task 3 + Task 12).
- ~~Ticker strip~~ **SELESAI (19 Okt 2026): hapus total** (dobel katalog).
- ~~Font~~ **SELESAI (19 Okt 2026): tetap Geist**, disesuaikan (mono hanya angka tabular).
- Motion: **SELESAI (19 Okt 2026): user izinkan GSAP.** Implementasi ponytail:
  1 file `components/dashboard/motion.tsx` (`useGsapChildren` + `GsapPct`),
  ditempel di grid katalog + 3 angka hero kuantitatif; CSS `reveal-up` jadi fallback.

## Catatan

- Bukti audit: lint taste-skill 104 FAIL (99× mono, gradient loading bar, hairline tabel)
  + 20 WARN; audit visual & QA/UX lengkap diringkas di `tasks/todo-frontend-redesign.md`
  Task 1 sebagai baseline.
- Sample/fake data dilarang: sparkline multi-titik tidak dibuat (odds cuma 2 titik:
  opening + last seen → digambar sebagai slope 2 titik, bukan kurva karangan).
