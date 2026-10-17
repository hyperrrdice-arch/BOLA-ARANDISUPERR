# TODO — Dashboard Overhaul v2 (anti-tumpuk; lihat tasks/plan.md)

> Prinsip revisi: tiap view = 1 elemen dominan. Yang terbuka: ringkasan + ≤5 baris bukti.
> Sisanya (metode, turunan, tabel panjang, argumen) → terlipat, judulnya informatif.

## Task 1: CUT MarketOddsOverviewCard
**Description:** Hapus kartu bursa yang duplikat OddsDislocationBar, sering kosong (fallback hardcoded), dan satu-satunya kartu gelap nyasar. `pergerakan_smart_money` pindah ke OddsDislocationBar.
**Acceptance criteria:**
- [x] File pindah `archive/legacy-components/`, tak di-import siapapun
- [x] `pergerakan_smart_money` tampil di OddsDislocationBar
**Verification:** tsc + build hijau · screenshot tab Odds: info identik
**Dependencies:** None · **Files:** app/page.tsx, OddsDislocationBar.tsx, MarketOddsOverviewCard.tsx (→archive) · **Size:** S

## Task 2: MERGE DualThinkingConclusionCard ke SyndicateDebateCard
**Description:** Dual bench + arbiter_verdict dirender 2× (SyndicateDebateCard Stage 2 vs DualThinkingConclusionCard). Satu renderan saja. Konten conclusion card yang unik (3 metrik sizing) pindah ke Ringkasan bila relevan.
**Acceptance criteria:**
- [x] Dual bench + supreme tampil tepat 1×
- [x] File ke archive; fallback "Mode Arbiter Tunggal" tetap jalan
**Verification:** tsc + build hijau · run nyata: debat lengkap
**Dependencies:** None · **Files:** SyndicateDebateCard.tsx, DualThinkingConclusionCard.tsx (→archive), app/page.tsx · **Size:** M

## Task 3: MERGE Kelly ke QuantEngine + pangkas DeepMath
**Description:** Simulator bankroll + tabel EV/stake jadi section "Alokasi Kelly" di QuantEngineCard (default terlipat, kecuali ringkasan stake). DeepMath → panel metode terlipat ("Cara angka ini dihitung": baseline, shrinkage, DC, Shin/Kelly + calibration_metadata), ≤150 baris, tanpa angka yang mengulang QuantEngine.
**Acceptance criteria:**
- [x] EV/stake tampil 1× (ringkas di hero, detail di lipatan Kelly)
- [x] DeepMath tanpa duplikat scorelines/vig/EV
**Verification:** tsc + build hijau · nilai EV/stake sama dgn sebelum merge
**Dependencies:** None · **Files:** QuantEngineCard.tsx, KellyMatrixCard.tsx (→archive), DeepMathEvidenceCard.tsx, app/page.tsx · **Size:** M

## Task 4: faktor_kunci dirender 1×
**Description:** Blok identik di page.tsx:515 & :609 → satu `FaktorKunciList` di Ringkasan.
**Acceptance criteria:** [x] Satu komponen, dirender 1× · [x] Nol duplikasi JSX
**Verification:** tsc + build hijau
**Dependencies:** None · **Files:** app/page.tsx · **Size:** XS

### ✅ Checkpoint Phase 1: build+tsc hijau · nol duplikat · info identik

## Task 5: Tab 5→4 + Ringkasan verdict-first
**Description:** Tab: **Ringkasan** (default: verdict display-size + prediksi + keyakinan + faktor_kunci + DataIntegrityShield + entry on-demand markets) · **Kuantitatif** · **Odds** (TheStatsOddsComparison + OddsDislocation) · **Debat**. SidebarNav 4 tab.
**Acceptance criteria:**
- [x] PASS/NO BET + skor + keyakinan terbaca ≤1 layar di 1440px tanpa scroll
- [x] Semua konten lama tercapai (≤1 klik)
**Verification:** tsc + build hijau · run nyata: katalog → keputusan = 1 klik
**Dependencies:** Task 2, 3, 4 · **Files:** app/page.tsx, SidebarNav.tsx, MatchHeaderCard.tsx · **Size:** M

## Task 6: Restack Kuantitatif (anti-tumpuk)
**Description:** Satu bintang per layar: probabilitas 1X2 + fair odds + EV teratas display-size; baris bukti ≤5 (top scorelines ringkas, margin vig, λ/μ); SISANYA terlipat: "Alokasi Kelly (simulator)" , "Cara angka ini dihitung" (DeepMath), tabel panjang ("Lihat semua pasar"). StatsAndSplitsCard → 6 blok jadi baris ringkas per blok, expandable per blok.
**Acceptance criteria:**
- [ ] Tab Kuantitatif: ≤1 elemen dominan + ≤5 baris bukti terbuka, sisanya accordion
- [ ] Semua field yang tampil hari ini masih tercapai ≤1 klik dari tab ini
- [ ] Nol informasi hilang
**Verification:** tsc + build hijau · screenshot tab: jauh lebih lapang vs baseline `.taste-skill/inspect/` · semua lipatan terbuka benar
**Dependencies:** Task 3 · **Files:** QuantEngineCard.tsx, DeepMathEvidenceCard.tsx, StatsAndSplitsCard.tsx · **Size:** M

## Task 7: Restack Debat verdict-first
**Description:** Supreme verdict + consensus besar di atas; argumen Bull/Neutral/Bear + dual bench dalam accordion per persona (judul: persona + kesimpulan 1 kalimat). Tanpa accordion, halaman debat = tembok teks.
**Acceptance criteria:**
- [ ] Verdict/consensus terbaca tanpa scroll; argumen terlipat per persona
- [ ] Semua argumen tetap terbaca ≤1 klik
**Verification:** tsc + build hijau · run nyata: debat tampil ringkas + detail terbuka
**Dependencies:** Task 2 · **Files:** SyndicateDebateCard.tsx · **Size:** M

## Task 8: Loading jujur + receipt plannerTrace
**Description:** Ganti checklist statis palsu ("✓ Fase 1" selalu centang) dgn status jujur + elapsed timer + estimasi 2–7 menit. Setelah selesai: render `plannerTrace` (steps, alasan, trigger, stop_reason) sebagai kuitansi di Ringkasan (bisa terlipat per step).
**Acceptance criteria:**
- [ ] Nol klaim palsu saat loading · [ ] Elapsed timer jalan
- [ ] plannerTrace tampil, trigger re-plan (FIELD_KOSONG/CONSENSUS_LEMAH/ODDS_DISLOCATION) kelihatan
**Verification:** tsc + build hijau · run nyata: trace cocok dgn response
**Dependencies:** Task 5 · **Files:** app/page.tsx, (baru) components/dashboard/PlannerTraceCard.tsx · **Size:** M

## Task 9: Payload & fetch enteng
**Description:** (a) `/api/agent` tanpa `rawLineups` kecuali `?debug=1`; (b) cache `/api/odds` (stop re-fetch tiap tab); (c) `next/dynamic` OneXBetDeepMarketsCard (853ln).
**Acceptance criteria:**
- [ ] Payload default tanpa rawLineups; `?debug=1` kembali penuh
- [ ] Buka-tutup tab Odds tanpa fetch ulang · [ ] Tab markets lazy
**Verification:** tsc + build hijau · bandingkan ukuran response · test-planner-loop lulus
**Dependencies:** None · **Files:** app/api/agent/route.tsx, app/page.tsx, TheStatsOddsComparisonCard.tsx, OneXBetDeepMarketsCard.tsx · **Size:** M

## Task 10: Horizon 72h
**Description:** API support `hours=72`, UI hanya 12/24/48. Tambah opsi 72h (default tetap 12).
**Acceptance criteria:** [ ] Opsi 72h berfungsi
**Verification:** tsc + build hijau · klik 72h di UI
**Dependencies:** None · **Files:** FilterToolbar.tsx, app/page.tsx · **Size:** XS

### ✅ Checkpoint Phase 2: run nyata · 1 elemen dominan per view · accordion OK · keputusan ≤1 layar

## Task 11: Tokens & konsistensi
**Description:** Draw direction (`--keep palette,type`). globals.css + kartu: radius 2 nilai (outer/inner), padding 1 nilai, error tone 1 resep, hapus 101 shadow statis + 204 hairline dekoratif (tabel/field asli boleh bergaris).
**Acceptance criteria:** [ ] Shadow statis nol · [ ] Hairline hanya tabel/field · [ ] Radius/padding seragam · [ ] Deviation skill tercatat
**Verification:** lint.mjs kategori shadow/hairline bersih · tsc + build hijau
**Dependencies:** Task 1–7 · **Files:** app/globals.css, components/dashboard/*.tsx tersisa · **Size:** M

## Task 12: Katalog, header & tipografi
**Description:** First screen milik katalog: buang noise operator (bar status + cache stats → footer/tooltip), fix wrap header mobile, heading display-size, body 12→14/16px, micro-label uppercase (201×) → sentence case, prose lepas Geist Mono (mono data-only).
**Acceptance criteria:**
- [ ] 390px: header rapi, judul app tak terpotong
- [ ] Body ≥14px · label sentence case · prose sans
- [ ] 1440px fold: satu elemen dominan + katalog terlihat
**Verification:** inspect.mjs ulang: body-size/small-text/micro-label/mono (data di-allow) bersih · screenshot fold direview
**Dependencies:** Task 11 · **Files:** app/page.tsx, MatchTickerStrip.tsx, FilterToolbar.tsx, MatchCatalogView.tsx, MatchHeaderCard.tsx, globals.css · **Size:** M

## Task 13: Gate + critique
**Description:** lint + inspect final (1440/768/390), critique (references/critique.md), fix 3 masalah teratas, ulang — maks 3 ronde.
**Acceptance criteria:** [ ] inspect tanpa FAIL (mono-data `--allow mono`) · [ ] Critique terakhir tercatat
**Verification:** output inspect bersih · semua screenshot dilihat manual
**Dependencies:** Task 11, 12 · **Files:** sesuai temuan · **Size:** S

### ✅ Checkpoint Final: build+tsc hijau · test-planner lulus · inspect bersih · user review
