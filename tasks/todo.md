# TODO — Offline Survival + 1xBet 500/mo (lihat tasks/plan.md)

> Prinsip: jalur render = SQLite/vault only. 1xBet = on-demand + persistent cache. Nol angka karangan.

## Task 1: Inventaris + tanggal kedaluwarsa

**Description:** Hitung stok hidup tanpa API: counts `upcoming_fixtures` + `max(utc_date)`, `competition_catalog`, `match_odds_history` (total/terisi), `matches`/`team_match_logs`, freshness `data/1xbet_leagues.json` + vault. Tulis angka ke ARCH §9.3 / plan sebagai baseline kuota.

**Acceptance criteria:**
- [x] Angka tercatat (verified 19 Okt 2026, read-only, 0 request keluar): fixture 378, max `2026-11-29T19:45:00.000Z`, min `2026-10-18T10:15:00.000Z`, catalog 208, odds 378 (112 terisi), matches 1174, logs 2348, teams 195, snapshots 5 (append-only, tak disentuh), `1xbet_leagues.json` 25KB/283 liga/mtime 11 Okt, vault 1 tabel `raw_api_vault`
- [x] Sisa hari katalog dari hari ini terhitung (41 hari per 19 Okt; 1 hari fixture sudah lewat → perlu promote/cleanup di Task 6)
- [x] Nol request keluar selama inventaris (query lokal only)

**Verification:**
- [x] `node inventory-task1.cjs` (node:sqlite read-only) counts cocok dengan laporan data-coverage + file temp dihapus (`git status` bersih kecuali plan/todo)
- [x] `npx.cmd tsc --noEmit` bersih (exit 0, 19 Okt 2026)

**Dependencies:** None

**Files likely touched:** (read-only) `data/*.db`, `data/1xbet_leagues.json`, `ARCHITECTURE.md`

**Estimated scope:** S (read-only)

## Task 2: Wire /api/odds ke match_odds_history

**Description:** Route saat ini online-only (`app/api/odds/route.ts:91-95` langsung `cachedStatsGet`). Ubah: baca lokal dulu via helper di `lib/db/thestats-dataset.ts` (`has_odds`/`payload`), serve `{is_available, captured_utc, bookmakers/best_odds}` dari anchor. Upstream jadi fallback yang saat 403 → degradasi jujur. Label UI "anchor, bukan closing".

**Acceptance criteria:**
- [x] 112 fixture terisi tampil dari lokal tanpa API — terbukti: `source: local_anchor` + `captured_utc` + 0 upstream fetch (functional test 19 Okt)
- [x] 266 flag kosong → `is_available:false` jujur (`local_anchor_empty`, tanpa buang request upstream)
- [x] Response bawa `captured_utc` + sumber `local_anchor` + label "anchor, bukan closing" (route message + caption kartu)

**Verification:**
- [x] Functional test throwaway 13/13: filled→200+data lokal, empty→false, missing→degradasi jujur, tanpa match_id→400 (file dihapus setelah lulus)
- [x] `npx tsx scripts/test-odds-anchor.ts` hijau (8/8, DB tak tersentuh)
- [x] `npx.cmd tsc --noEmit` exit 0 + `npm.cmd run build` sukses (Next 16.4, 8/8 static)

**Dependencies:** Task 1

**Files likely touched:**
- `app/api/odds/route.ts`
- `lib/db/thestats-dataset.ts`
- `components/dashboard/TheStatsOddsComparisonCard.tsx` (label anchor)

**Estimated scope:** M (3 files)

### Checkpoint: Offline dasar
- [x] Odds tersaji dengan 0 call TheStatsAPI (functional test: 0 upstream fetch; katalog menyusul Task 4)
- [x] tsc + build hijau (Task 2)

## Task 3: 1xBet degradasi ringan (tanpa cache persisten)

**Description:** API kemungkinan diganti — JANGAN bangun cache persisten/counter. Cukup 2 hal: (a) `requireEnv` top-level di `lib/1xbet.ts:30-31` bikin crash tanpa key → lazy load (tanpa key → degradasi jujur). (b) Audit grep: pastikan tidak ada pemanggilan 1xBet di jalur katalog/list (hanya detail on-demand via klik). In-memory cache apa adanya, tidak disentuh.

**Acceptance criteria:**
- [x] Tanpa `RAPIDAPI_1XBET_KEY` → 503 `{status:"unavailable"}` + pesan, bukan crash (functional test 19 Okt: GET+POST 503)
- [x] Grep membuktikan `find1xBetMatch`/`get1xBetMarketsV2` hanya dari `app/api/betting/route.ts` (POST+GET on-demand) + 1 script archive mati — nol di katalog/list
- [x] Nol tabel/cache/counter baru (sengaja — API mau diganti)

**Verification:**
- [x] Throwaway 5/5: import tanpa key tidak throw (sebelum fix = FATAL di import), GET/POST → 503 unavailable (file dihapus)
- [x] tsc exit 0 + build sukses

**Dependencies:** Task 1

**Files likely touched:**
- `lib/1xbet.ts` (lazy env saja)
- `app/api/betting/route.ts` (pesan degradasi bila perlu)

**Estimated scope:** XS (1-2 files, <20 baris)

## Task 4: Matches anti-API + empty-after-expiry UX

**Description:** `/api/matches` sudah tier-1 lokal (`getUpcomingInWindow`), tapi fallback masih fan-out 5 call upstream yang saat 403 = latency sia-sia. Ubah: saat upstream 401/403 → langsung serve local + flag `offline:true`, tanpa retry. Tambah banner tanggal-batas (max fixture 2026-11-29, sisa N hari) + empty state jujur saat window kosong ("katalog habis, bukan error"). Horizon 72h tetap clamp 48 sampai diputuskan (jangan diam-diam).

**Acceptance criteria:**
- [x] Local hit → 200 dari `local_sqlite`, 0 upstream call, `offline:true` + `catalog_max_utc` katalog (functional test 19 Okt)
- [x] Banner tampil: "Data offline s/d 29 Nov — sisa N hari" (`MatchCatalogView`, max dari seluruh DB via `getUpcomingMaxDate`, bukan window — bug window-max ketangkap test + sudah fix)
- [x] Window kosong / local miss + 403 → 200 kosong jujur "AKSES API MATI", bukan 500; error non-auth tetap 500

**Verification:**
- [x] Functional test throwaway 10/10: local-hit 0 fetch + max 29 Nov; simulasi 403 KEY_REVOKED → 200 kosong + pesan AKSES API MATI (file dihapus setelah lulus)
- [x] `npx.cmd tsc --noEmit` exit 0 + `npm.cmd run build` sukses (8/8 pages)
- [ ] Screenshot banner 1440px + 390px (tunda — butuh dev server + browser; banner logic tercover test, visual belum)

**Dependencies:** Task 1

**Files likely touched:**
- `app/api/matches/route.ts`
- `app/page.tsx` / `MatchCatalogView.tsx` (banner + empty state)
- `lib/stats-cache.ts` (pesan "AKSES API MATI" konsisten render vs scripts)

**Estimated scope:** M (3 files)

### Checkpoint: Kuota aman
- [ ] Tanpa key = jujur, tidak crash · tidak ada preload/scan 1xBet di jalur katalog/list
- [ ] Katalog + odds p95 <200ms offline

## Task 5: P0 integrity offline

**Description:** Dua bug finansial tetap hidup walau offline. (a) `app/api/agent/route.tsx:85-87` `topEv = find(+EV) || valueBets[0]` → rekomendasi minus-EV; fix `?? null`, `recommended_*` NULL + UI "Tidak ada +EV". (b) `lib/agent/planner.ts:127-132` fallback `overround 1.055/margin 5.5%` → fix `null` + `model_only:true`, sindikat tampil "Odds pasar absen — fair murni model". Keduanya <50 baris.

**Acceptance criteria:**
- [x] Semua EV negatif → `recommended_*` NULL di snapshot + hero "Tidak ada +EV" (route + view pakai `?? null`; downstream sudah null-safe)
- [x] Odds pasar absen/rusak → `vig_stripping` NULL (planner + schema nullable), tidak ada "Margin Bandar 5.5%" di prompt/UI (sindikat render string kosong; dead branch `shin_vig` dihapus)
- [x] Tidak ada `?? 0` / default karangan baru (guard `vigOutput` ditambah di 3 situs crash-prone: route fallback, prompt editorial, paket planner)

**Verification:**
- [x] Throwaway 8/8: vig null + value kosong saat odds absen; tidak crash saat odds rusak; schema terima null; hero + shin_kelly null (file dihapus)
- [x] Regresi lama hijau: `test-value-bets` 7/7, `test-view-mapper` 53/53, `test-quant-scale` OK, `test-odds-anchor` 8/8 (akumulasi Tasks 2-5)
- [x] tsc exit 0 (1 error ketangkap saat kerja: type `vig_stripping` belum nullable → fix) + build sukses
- [ ] `test-planner-loop` butuh gateway LLM live (9Router localhost:20128 mati — connection refused, limitasi environment, bukan regresi; gagal di API call sebelum menyentuh code Task 5)

**Dependencies:** Task 2 (butuh odds lokal jujur dulu)

**Files likely touched:**
- `app/api/agent/route.tsx`
- `lib/agent/planner.ts`
- `lib/view/analysis-view.ts` (+ helper `pickTopEv` di `lib/quant/kelly.ts`)
- `lib/syndicate-orchestrator.ts` (guard `model_only`)

**Estimated scope:** S-M (3-4 files, <50 baris)

## Task 6: Lifecycle promote + spike API alternatif (read-only)

**Description:** (a) Pastikan lifecycle jalan manual: `sync:upcoming` isi → `promote-upcoming-to-telemetry.ts` (selesai → telemetry → hapus baris) → `sync:outcomes`. Dokumenkan perintah + jadwal. (b) Spike 1-2 kandidat pengganti fixture/odds (bukan implementasi): catat coverage, harga, limit, format. Output: tabel keputusan di plan, tanpa code adapter.

**Acceptance criteria:**
- [ ] Perintah lifecycle terdokumentasi + 1 run promote kering berhasil (atau dinyatakan tidak ada yang bisa dipromote)
- [ ] Tabel kandidat: nama, gratis/berbayar, limit, cocok untuk fixture? odds? (minimal 2 kandidat)
- [ ] Rekomendasi next-step eksplisit (tetap offline / eksekusi kandidat X)

**Verification:**
- [ ] Log run promote / dry-run terlampir
- [ ] Tidak ada file `lib/`/`app/` berubah di Task 6 (spike only — cek `git status`)
- [ ] `verify-tier1` + `verify-foundation` hijau (tidak regresi)

**Dependencies:** Task 1

**Files likely touched:** (docs + CLI only) `tasks/plan.md`, `scripts/promote-upcoming-to-telemetry.ts` (run, bukan edit), `scripts/sync-match-outcomes.ts` (run)

**Estimated scope:** S

### Checkpoint: Final
- [x] tsc + build hijau · runnable checks hijau (odds-anchor 8/8, value-bets 7/7, view-mapper 53/53, upcoming-guard 10/10, stats-mapper 19/19, snapshot-db 48/48, cache 11/11, http-json 12/12, tier1 15/15, foundation 47/47, quant-scale, offline-intel 10/10, tool-calling NATIVE_OK, planner-loop live OK)
- [x] Banner 29 Nov tampil (logic ter-test; screenshot browser tunda) · 1xBet degradasi ringan · 0 call TheStatsAPI di render
- [x] Live /api/agent 200 Parma-Torino: angka→analisis end-to-end teraudit (203s, snapshot #115)
- [ ] Review user sebelum eksekusi kandidat API baru (Task 6 spike belum jalan)

## Task 7: Offline intel minimal (/api/agent hidup tanpa API)

**Description:** Live run 19 Okt membuktikan `/api/agent` 500 untuk SEMUA match: `fetchAndValidateMatchIntelligence` fetch match dasar live-only (`stats-fetcher-agent.ts:184`), Tier-1 lokal (H2H/form/cedera) ke-gate di belakangnya. Versi minimal (disetujui user): saat live gagal 401/403, rakit intel dari (a) baris `upcoming_fixtures` (fixture/venue/tim), (b) `match_odds_history` anchor (odds — payloadVault-shape, validator baca `data.bookmakers[0]` langsung), (c) Tier-1 lokal yang sudah ada. Lineup/wasit/cedera-live = kosong jujur (validator path `unavailable` sudah ada). BUKAN full offline: tanpa baris fixture/odds → tetap 500 jujur.

**Acceptance criteria:**
- [x] `GET /api/agent?match_id=mt_988230396` (Parma-Torino) 200 + verdict Torino + prob sum 1.0000 + fair=1/prob + EV +7.6% konsisten (live 19 Okt, 203s)
- [x] Fixture tanpa odds anchor → mode model-only (vig null — terbukti unit test P0; live path sama)
- [x] Match tak dikenal → 500 jujur "tidak ditemukan di sumber live maupun lokal" (test-offline-intel)
- [x] Nol karangan: margin 5.1% terukur (bukan 5.5%), nama bandar asli, gaps wasit/lineup jujur, `is_strictly_grounded:true` + snapshot `grounded=1/fallback=0`

**Verification:**
- [x] `scripts/test-offline-intel.ts` (permanen) 10/10: tim + odds anchor + form lokal, lineup/wasit null jujur, match-detail live 0 hit, unknown throw
- [x] Live audit angka: prob sum 1.0000, fair 3.92≈1/0.2554, EV 0.4679×2.3-1=+7.6% ✓, konsensus pasar 28/31/42 konsisten vig, debate R2 terpicu SPLIT sesuai desain
- [x] Regresi: mapper 19/19, guard 10/10, value-bets 7/7, tsc 0, build sukses
- [ ] Nama cedera di verdict (Almqvist dkk dari snapshot skuad lokal 11 Okt — stale 8 hari, belum di-spot-check per nama)

**Dependencies:** Task 2 (odds anchor), Task 5 (vig null)

**Files likely touched:**
- `lib/db/upcoming-fixtures.ts` (`getUpcomingByMatchId`)
- `lib/stats-fetcher-agent.ts` (fallback offline)
- `scripts/test-offline-intel.ts` (baru, kecil — permanen, bukan throwaway)

**Estimated scope:** M (2-3 files)
