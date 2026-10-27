# TODO — Frontend Redesign Dark Quant Terminal (lihat tasks/plan-frontend-redesign.md)

> STATUS 19 Okt 2026 (ponytail pass 1): Task 2 SELESAI (token dark 1 sumber, variables.css
> dihapus), Task 3 SELESAI (ticker dihapus, header 1 baris, brand MENCARI UANG DARI PARLAY,
> sidebar liga desktop + pills liga mobile-only), Task 4 SEBAGIAN (card dark + keyboard
> Enter/Space; countdown belum), Task 5 SEBAGIAN (verdict 4xl, klaim karangan dihapus),
> Task 12 SEBAGIAN (tombol Batalkan, timer 1s, copy intro jujur). Sisa: Tasks 6–11 penuh,
> tabel min-w mobile, ARIA tab, screenshot analisis. Verifikasi pass 1: tsc 0, build sukses,
> lint 104→10 FAIL (sisa = definisi mono angka + garis tabel asli, allow-list), screenshot
> katalog 1440/390 OK di `.taste-skill/inspect-*.png`.
> GSAP 19 Okt 2026 (pass 2): `gsap` installed; `components/dashboard/motion.tsx` baru
> (`useGsapChildren` stagger entrance katalog + `GsapPct` count-up 3 angka hero
> kuantitatif, reduced-motion dihormati, dynamic import biar SSR aman); tsc 0.
> Antrian 19 Okt 2026 (pass 3, tsc 0, lint 10 FAIL allow-list): countdown kickoff terdekat
> (`MatchCatalogView`, mount-only anti hydration mismatch), panel PICK #1 lavender solid
> dari `ev_teratas` + strip jujur No Bet bila null (`page.tsx` ringkasan), `min-w` tabel
> Kelly 620px + odds 560px (wrapper sudah `overflow-x-auto`), consensus bar bull/bear/netral
> + legend ikon (`SyndicateDebateCard`), ARIA tab penuh (`SidebarNav` tablist/roving
> tabindex/panah/Home/End + 4 `tabpanel` di `page.tsx`, `transition-all`→`transition-colors`),
> `scrollTo` hormati reduced-motion.
> SISA PLAN 19 Okt 2026 (pass 4, tsc 0 tiap step, lint 10 FAIL allow-list = garis tabel asli
> + mono angka): Task 5 SELESAI (vonis + strip 4 stat menyatu di `MatchHeaderCard`, banner
> verdict jadi blok alasan), Task 6 SELESAI (dots form W/D/L, integrity jadi strip + badge,
> planner terlipat default), Task 7 SELESAI (Kelly keluar `<details>`, grid tabel + simulator
> sticky), Task 8 SELESAI (fallback jujur, copy Anchor, bar model-vs-bursa, best-odds 2xl),
> Task 9 SELESAI (copy netral, `ModelAdvicePanel` satukan A/B), Task 10 SELESAI (supreme hero,
> border semantik persona, radius 18/12), Task 11 SELESAI (skip-link, `ChunkFallback` 11
> dynamic, `role=status/alert`, focus vonis/katalog), Task 12 SELESAI kecuali screenshot
> critique (tool screenshot tak tersedia di sesi ini — verifikasi manual di browser).

> Scope STRICT frontend: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`,
> `components/dashboard/*`, `components/icons.tsx`, `design-system/*`.
> DILARANG: `app/api/**`, `lib/**`, `scripts/**`, `data/**`. Kontrak props/`AnalysisView` beku.

## Temuan Audit (baseline, terverifikasi 19 Okt 2026)

**Visual (subagent frontend-architect):**
- Light `#f5f5f5/#fff` di `app/globals.css:5-9` + `app/layout.tsx:30` — kebalikan contoh dark.
- Semua card resep identik `bg-white + #e5e5e5 + r24 + p-5` (verdict `app/page.tsx:469`,
  quant `QuantEngineCard.tsx:49`, debat `SyndicateDebateCard.tsx:35`, shield kosong
  `DataIntegrityShield.tsx:16`) → tidak ada hierarchy, card-dalam-card 2–3 lapis.
- ±830 hex hardcoded, 0× `var(--…)` di komponen; 3 sumber token
  (`globals.css:5-36`, `design-system/theme.css`, `variables.css` yatim tak diimpor).
- Dead CSS: `.doppel-*/.flat-card/.flat-callout` (`globals.css:62-105`) 0× dipakai;
  `.flat-tag-green/blue` disamakan hitam/zinc (`globals.css:111-140`) → semantik hilang.
- Tidak ada angka hero: teks terbesar judul katalog 30px, probabilitas 24px, best odds
  18px; token display 48px tak pernah dipakai. `text-[11px]` 183×, `text-[13px]` 51×.
- `font-mono` jadi font container di 8+ komponen; warna semantik bocor non-token
  (emerald `QuantEngineCard.tsx:59,248`, sky `SidebarNav.tsx:138`, rose, amber) →
  +EV kadang hitam, kadang hijau.
- Radius liar: 24/20/18/16/14/12/10/6 tanpa sistem.

**QA/UX (subagent qa):**
- P0: katalog card `<article onClick>` tanpa keyboard (`MatchCatalogView.tsx:120-126`).
- P1: tanpa focus-visible/skip-link/ARIA tab/live-region; kontras `#737373` di `#f5f5f5`
  = 4.35:1 gagal AA; EV hijau di putih 2.54:1.
- P1 copy bohong: "TheStatsAPI Live Feed" (`page.tsx:329-333`) vs banner API mati;
  "Grounded 100%" tampil saat analisis belum selesai (`MatchHeaderCard.tsx:145-181`);
  fallback odds karangan "Aktif/Seimbang/Tersedia" (`OddsDislocationBar.tsx:48-53`).
- P1: 11× dynamic `ssr:false` tanpa `loading` fallback (`page.tsx:20-68`); tabel
  odds/Kelly tanpa `min-w` di 390px; sidebar mobile tab `min-w-[200px]` ×4.
- Lint taste-skill: **104 FAIL** (99× mono, 1 gradient `globals.css:170`, hairline tabel),
  20 WARN (glass `page.tsx:303`, ping/pulse, outlined-box).

## Task 1: Baseline visual + kontrak beku

**Description:** Tanpa edit kode: screenshot katalog + 4 tab analisis di 1440/768/390
(dev server), catat ukuran bundle first-load dari build terakhir, bekukan daftar props
tiap komponen dashboard sebagai kontrak. Simpan screenshot di `.taste-skill/baseline/`.

**Acceptance criteria:**
- [ ] Screenshot 3 viewport × (katalog + ringkasan) tersimpan dan dirujuk di plan
- [ ] Daftar kontrak props per komponen tercatat (nama prop + tipe, tanpa ubah shape)
- [ ] `git status` bersih dari perubahan kode setelah task ini

**Verification:**
- [ ] File screenshot ada; `npx.cmd tsc --noEmit` exit 0 sebagai baseline

**Dependencies:** None
**Files likely touched:** `.taste-skill/baseline/*` (baru), tasks frontend ini
**Estimated scope:** S (tanpa kode)

## Task 2: Konsolidasi token dark theme

**Description:** Jadikan `design-system/theme.css` satu-satunya sumber token dark
(`--bg/--panel/--panel-2/--border/--accent/--text/--muted/--success/--danger/--warn`,
radius 18/12/999, skala tipe). `globals.css`: impor token, hapus dead classes
`.doppel-*/.flat-card*/.flat-callout/.flat-tag-*` atau petakan ke token baru, loading bar
gradient → flat. `layout.tsx:30`: body pakai token, bukan hex.

**Acceptance criteria:**
- [ ] `variables.css` tergabung/dihapus — tinggal 1 file token terimpor
- [ ] Grep hex di `globals.css`+`layout.tsx` hanya di definisi token
- [ ] Semua view tampil dark tanpa elemen putih bocor; fungsi identik sebelum/sesudah

**Verification:**
- [ ] `npx.cmd tsc --noEmit` exit 0; lint taste-skill: FAIL mono/gradient turun tercatat
- [ ] Screenshot katalog dark 1440 + 390 dibandingkan baseline

**Dependencies:** Task 1
**Files likely touched:** `design-system/theme.css`, `design-system/variables.css`, `app/globals.css`, `app/layout.tsx`
**Estimated scope:** M (4 files)

### Checkpoint: Fondasi
- [ ] tsc hijau, katalog+analisis tampil dark tanpa regresi fungsi

## Task 3: App shell — sidebar gelap tetap + header 1 baris

**Description:** Sidebar 248px `#0a0a12` selalu tampil: brand **MENCARI UANG DARI PARLAY**
(keputusan user 19 Okt 2026; ganti "BOLA-ARANDISUPERR" `app/page.tsx:321` dan title
"Football Agent" `app/layout.tsx:16` sekalian di task ini untuk metadata), nav Katalog,
daftar liga + count (pindah dari `FilterToolbar.tsx:162-199`), telemetry lokal di bawah
("Katalog lokal s/d 29 Nov", bukan "Live Feed"). Saat analisis: sidebar memuat tombol
Kembali + 4 tab + kartu mini verdict (top pick + EV). Header menyusut 1 baris: search
(pindah dari toolbar), segmented jam, sort, refresh. Ticker: keluar dari sticky header
(keputusan Open Question; default plan: hapus, katalog sudah memuat datanya).
Perilaku `page.tsx` (fetch, race guard, abort) tidak berubah — hanya JSX shell.

**Acceptance criteria:**
- [ ] Header sticky maksimal 1 baris (±56px) di semua viewport
- [ ] Liga bisa dipilih dari sidebar di katalog DAN analisis tanpa kehilangan filter aktif
- [ ] Tab analisis di sidebar dengan state aktif lavender; di mobile jadi bar atas ringkas, bukan scroll 800px

**Verification:**
- [ ] Screenshot 1440/768/390 kedua view; klik semua nav manual lolos
- [ ] `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 2
**Files likely touched:** `app/page.tsx`, `components/dashboard/SidebarNav.tsx`, `components/dashboard/MatchTickerStrip.tsx`, `components/dashboard/FilterToolbar.tsx`
**Estimated scope:** M (4 files)

## Task 4: Katalog dark + live thing countdown

**Description:** `MatchCatalogView`: card `#12121e` r18 — baris liga + kickoff WIB,
nama tim 16px sans, footer chips kelengkapan data (odds/xG/form ada/tidak, apa adanya
dari `MatchItem`), panah aksi. Card jadi `<button>`/link semantik penuh (fix P0).
Intro panjang (`MatchCatalogView.tsx:38-49`) → subtitle 1 baris. `FilterToolbar`:
lepas pembungkus card putih (`:67`), segmented jam aktif lavender. Live thing:
countdown "kickoff berikutnya dalam HH:MM:SS" di header katalog + per-liga laga
terdekat saat liga dipilih; tanpa JS daftar tetap lengkap. Hover: border accent +
gambar/angka `group-hover:scale` halus (transform/opacity saja).

**Acceptance criteria:**
- [ ] Katalog bisa dibuka 100% via keyboard (Tab + Enter), focus ring terlihat
- [ ] Countdown jalan dari `utc_date` existing, tidak ada data baru dikarang
- [ ] Empty/error/offline state tetap jujur dengan copy sama, gaya dark

**Verification:**
- [ ] Keyboard-only walkthrough katalog → analisis lolos
- [ ] Screenshot 1440/390; `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 3
**Files likely touched:** `components/dashboard/MatchCatalogView.tsx`, `components/dashboard/FilterToolbar.tsx`, `app/page.tsx`
**Estimated scope:** M (3 files)

### Checkpoint: Katalog
- [ ] Screenshot 1440/768/390, katalog keyboard-accessible

## Task 5: Hero match + verdict hero menyatu

**Description:** Gabung visual `MatchHeaderCard` + blok verdict `page.tsx:469-510`
jadi 1 panel elevated: nama match 28–32px, verdict sebagai headline ≤2 baris,
strip 4 stat (prob terbaik / EV teratas / Kelly / confidence) angka 24–32px.
Hapus klaim fallback karangan ("Grounded 100%", "Aktif & Terkalibrasi",
`MatchHeaderCard.tsx:145-181`): sebelum data siap tampil "—"/status menganalisis.
Tombol Refresh Odds/Rerun tetap, hasil scan wajib memberi feedback di tab aktif
(bukan cuma di tab Odds).

**Acceptance criteria:**
- [ ] Saat `data === null` tidak ada angka/status karangan tampil
- [ ] Verdict terbaca ≤2 baris di 390px dan 1440px
- [ ] 4 stat memakai data existing (`ringkasan`, `kuantitatif`, `odds`) tanpa hitung ulang

**Verification:**
- [ ] Screenshot state loading + state selesai; `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 2 (paralel dengan 3–4 boleh, file beda)
**Files likely touched:** `components/dashboard/MatchHeaderCard.tsx`, `app/page.tsx`
**Estimated scope:** M (2 files)

## Task 6: Ringkasan — splits, integrity strip, planner, pick lavender

**Description:** `StatsAndSplitsCard`: form inline mono → dots W/D/L berwarna semantik;
klasemen/pemain kunci pisah hierarchy. `DataIntegrityShield`: card penuh → strip
1 baris (skor + jumlah gaps), detail gaps expand. `ThinkingPlannerCard`: timeline
terlipat default. Tambah panel accent lavender SOLID (bukan gradient) "Pick #1" dari
`LogicalPickCard` data teratas (EV terbesar) — satu-satunya panel accent besar;
bila tidak ada +EV tampil jujur "Tidak ada +EV" tanpa panel accent.

**Acceptance criteria:**
- [ ] Tidak ada card-dalam-card lebih dari 1 lapis di tab Ringkasan
- [ ] Panel lavender hanya muncul bila ada pick +EV nyata
- [ ] Integrity strip tetap menampilkan gaps apa adanya (tidak dipercantik jadi 100%)

**Verification:**
- [ ] Screenshot ringkasan 1440/390 (kasus ada +EV dan tidak ada +EV bila data memungkinkan)
- [ ] `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 5
**Files likely touched:** `components/dashboard/StatsAndSplitsCard.tsx`, `components/dashboard/DataIntegrityShield.tsx`, `components/dashboard/ThinkingPlannerCard.tsx`, `components/dashboard/LogicalPickCard.tsx`, `app/page.tsx`
**Estimated scope:** M (5 files)

## Task 7: Kuantitatif — asset card 1/X/2, prob bar, Kelly terbuka

**Description:** `QuantEngineCard`: 3 kotak 1/X/2 → asset card ala contoh (label,
probabilitas 32–40px putih, fair odds di bawah, delta vs konsensus % hijau/merah).
Segmented prob bar full-width di bawahnya (lavender/abu/putih, label segmen tidak
hilang <12% — pindah ke legenda). Parameter bukti: strip 5 kolom tanpa kotak dobel.
Tabel Kelly keluar dari `<details>` (`:151-268`), bento `grid-flow-dense` terverifikasi
penuh tanpa sel kosong; simulator bankroll jadi panel samping sticky. Tabel `min-w`
+ scroll horizontal di mobile.

**Acceptance criteria:**
- [ ] Probabilitas 1/X/2 adalah teks terbesar di tab ini, terbaca tanpa scroll di 1440px
- [ ] Grid bento matematis penuh (col/row-span dihitung, `grid-flow-dense`) — zero void
- [ ] Tabel Kelly scroll rapi di 390px, EV hijau kontras ≥4.5:1 di panel gelap

**Verification:**
- [ ] Screenshot 1440/390; hitung ulang prob+fair dari angka tampil cocok 1/prob
- [ ] `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 2
**Files likely touched:** `components/dashboard/QuantEngineCard.tsx`
**Estimated scope:** M (1 file besar)

### Checkpoint: Inti analisis
- [ ] Angka hero terbaca sekilas di 390px, tabel tidak overflow

## Task 8: Odds comparison dark + dislokasi visual

**Description:** `TheStatsOddsComparisonCard`: konvensi segmented diseragamkan
(aktif = lavender, samakan dengan toolbar), best-odds jadi angka hero 24px+, tabel
bookmaker dark dengan `min-w`, sel best = pill lavender, delta opening→last sebagai
slope 2 titik + panah (data `diff` existing, dilarang kurva multi-titik karangan).
Label "anchor, bukan closing" dipertahankan. `OddsDislocationBar`: 4 kotak string
mentah → stat terstruktur; fallback karangan ("Aktif/Seimbang/Tersedia",
`:48-53`) → state "data tidak tersedia" jujur; bar dislokasi horizontal model vs pasar.

**Acceptance criteria:**
- [ ] Tidak ada status pasar tampil bila datanya tidak ada
- [ ] Tabel scroll horizontal terkendali di 390px tanpa kolom remuk
- [ ] Delta hanya dari 2 titik data nyata (opening, last seen)

**Verification:**
- [ ] Screenshot tab Odds 1440/390 termasuk state odds kosong
- [ ] `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 2
**Files likely touched:** `components/dashboard/TheStatsOddsComparisonCard.tsx`, `components/dashboard/OddsDislocationBar.tsx`
**Estimated scope:** M (2 files)

## Task 9: Scanner 1xBet — picks featured + markets padat

**Description:** `OneXBetDeepMarketsCard` + `MarketsTable` + `BettingScannerCard`:
Logical Picks featured di atas (sudah ada datanya via `use-logical-picks.ts`, jangan
ubah logikanya), 500 pasar tetap grid padat tapi card `--panel-2` r12, odds box
kontras, baris +EV ter-highlight hijau. Duplikasi visual Model A/B di
`BettingScannerCard` (±100 baris identik) disatukan tampilannya tanpa ubah perilaku;
copy janji "500+" sebelum scan → netral ("scan manual, kuota terbatas"). Header
badge tanpa `flex` overflow di mobile.

**Acceptance criteria:**
- [ ] Pick +EV terlihat dalam 1 detik tanpa membaca tabel (highlight + EV besar)
- [ ] Grid markets tanpa sel kosong (`grid-flow-dense` bila bento dipakai)
- [ ] State belum scan / not_found (input manual) / empty tetap berfungsi identik

**Verification:**
- [ ] Screenshot tab Odds setelah scan manual 1 match; `npx.cmd tsc --noEmit` exit 0
- [ ] Klik scan 2× membuktikan tidak ada perubahan perilaku request (on-demand tetap)

**Dependencies:** Task 8
**Files likely touched:** `components/dashboard/OneXBetDeepMarketsCard.tsx`, `components/dashboard/MarketsTable.tsx`, `components/dashboard/BettingScannerCard.tsx`, `components/dashboard/LogicalPickCard.tsx`
**Estimated scope:** M (4 files)

## Task 10: Debat sindikat — consensus bar + persona semantik

**Description:** `SyndicateDebateCard`: supreme verdict hero (3 stat besar: pasar,
stake, confidence), consensus bar segmented bull/bear/neutral dari vote persona
existing (pengganti sparkline — data nyata), persona grid border-kiri semantik
(bull hijau / bear merah / netral abu), dual bench 2 kolom, argumen panjang tetap
collapsed. Radius diseragamkan 18/12, `font-mono` hanya angka.

**Acceptance criteria:**
- [ ] Peta suara sindikat terbaca tanpa membuka satu pun argumen
- [ ] Bull/bear terbedakan selain dari warna (label/ikon)
- [ ] Tidak ada teks debat hilang — hanya hierarchy berubah

**Verification:**
- [ ] Screenshot tab Debat 1440/390; `npx.cmd tsc --noEmit` exit 0

**Dependencies:** Task 2
**Files likely touched:** `components/dashboard/SyndicateDebateCard.tsx`
**Estimated scope:** S-M (1 file)

### Checkpoint: Semua tab
- [ ] 4 tab selesai dark, tidak ada card-dalam-card 3 lapis tersisa

## Task 11: Motion layer + accessibility hardening

**Description:** Motion CSS (tanpa GSAP): entrance stagger per section (heading→teks→
panel, 60–90ms, translateY 16–24px + opacity, sekali jalan), hover physics
`group-hover:scale-[1.02]` pada card bergambar/angka, feedback press semua tombol.
Hormati `prefers-reduced-motion` termasuk `scrollTo` behavior di `page.tsx:198`
(smooth → auto saat reduced). A11y: focus-visible global accent, skip-link di
`layout.tsx`, `role=tablist/tab/aria-selected` + panah keyboard di SidebarNav,
`aria-live` untuk loading/error/hasil analisis, focus management setelah pilih
match/kembali. Dynamic import: komponen kecil kembali eager, sisanya beri
`loading` skeleton.

**Acceptance criteria:**
- [ ] ≥8 elemen benar-benar bergerak saat load/scroll (dihitung manual dari screenshot/inspect)
- [ ] Reduced-motion: tidak ada animasi/scroll smooth tersisa, konten tetap tampil penuh
- [ ] Navigasi penuh keyboard: katalog → analisis → 4 tab → kembali tanpa mouse

**Verification:**
- [ ] Lint taste-skill FAIL = 0 di luar allow-list (mono angka `data-ui`, accent lavender)
- [ ] Keyboard walkthrough + screenshot reduced-motion (emulasi) lolos

**Dependencies:** Tasks 3–10
**Files likely touched:** `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `components/dashboard/SidebarNav.tsx`
**Estimated scope:** M (4 files)

## Task 12: States jujur + responsive final + verifikasi penuh

**Description:** Analyzing state: stage pipeline jujur (bukan progress karangan —
tahap aktif dari state existing), elapsed per detik (bukan 100ms, `page.tsx:109-119`),
tombol "Batalkan Analisis" eksplisit (memakai abort existing), skeleton hasil.
Audit copy menyeluruh: buang "Live Feed/Live Ticker/Bursa Real-Time/Grounded 100%/
500+" yang tidak terbukti; offline disebut offline, anchor disebut anchor, bahasa
Indonesia konsisten (metadata + header satu brand: **MENCARI UANG DARI PARLAY**). Final QA 3 viewport + critique
screenshot (rubrik taste-skill `critique.md`), perbaiki 3 masalah teratas.

**Acceptance criteria:**
- [ ] Grep `Live|Real-Time|Grounded 100` di komponen: hanya tersisa yang terbukti datanya
- [ ] Analisis bisa dibatalkan dari state analyzing dan UI kembali ke katalog bersih
- [ ] Tidak ada overflow horizontal / tabel remuk / header makan >25% viewport di 390px

**Verification:**
- [ ] `npx.cmd tsc --noEmit` exit 0 + `npm.cmd run build` sukses (jangan bareng `next dev`)
- [ ] Lint taste-skill + screenshot critique 1440/768/390 tercatat skornya di plan
- [ ] `git status`: hanya file frontend + tasks frontend yang berubah

**Dependencies:** Task 11
**Files likely touched:** `app/page.tsx`, `components/dashboard/MatchHeaderCard.tsx`, `components/dashboard/MatchCatalogView.tsx`, `components/dashboard/SidebarNav.tsx`
**Estimated scope:** M (4 files)

### Checkpoint: Final
- [ ] Lint taste-skill FAIL = 0 (di luar allow-list tercatat), tsc+build hijau, screenshot 3 viewport lolos critique
