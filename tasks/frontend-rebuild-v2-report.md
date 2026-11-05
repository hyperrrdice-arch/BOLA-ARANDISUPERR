# Frontend Rebuild v2 — Report (2026-11-05)

Owner verdict on v1: too boxy, AI-slop layout, bad fonts, tacky Indonesian
copy. This rebuild is presentation-only: `lib/web/data.ts` query logic and
`lib/web/parlay.ts` math are untouched (verified — no diff in those files),
no pipeline/quant code, DBs, or scripts were modified.

Locked standard: Apple/Meta product-page calm — one idea per screen,
enormous negative space, no boxes/cards/bordered panels/stamps/all-caps
anywhere, hairlines very faint and only where a table needs separation,
palette unchanged (ink #0D0C0A, bone #E9E4D8, amber #FFA02E, sage, brick).
All UI copy in minimal modern English, exactly per the approved deck;
routes keep their Indonesian paths, the name "Pilihan Aman" stays.

## Commits (branch safe-bet-parlay)

1. `524fac5` fondasi v2 — fonts, theme, top bar, atoms, English format
2. `01ddd22` bola data 3D — replaces the score-matrix bars object
3. `567b65f` landing v2
4. `d194ee7` terminal v2 — matches list + match detail
5. `92ac8e8` picks + record v2
6. this report

## Foundation

- Fonts: Archivo_Narrow/Geist/Geist_Mono removed. **Archivo** 400/500/600/700
  (display = 600, tracking −0.02em) + **IBM Plex Mono** 400/500/600 for all
  numbers, via `next/font/google`; CSS vars stay `--font-sans/--font-display/
  --font-mono` so component churn stayed small.
- Shell: sidebar deleted. One slim transparent top bar (wordmark left,
  Matches/Picks/Record right; active = bone + 2px amber underline,
  underline-offset-8), content column max-w-[76rem], px-6, py-14.
  `Nav.tsx` is now the server TopBar; the client nav moved to
  `NavClient.tsx` (same Suspense/static-fallback pattern as v1).
- Atoms (`components/ui.tsx`): MicroLabel is now quiet 13px sentence-case
  muted text; `GradeStamp` → **`GradeMark`**, a plain coloured letter
  (A sage, B amber, C brick, D faint), no border/background; GateStatus =
  dot + muted word; FormChips = 22px rounded-full W/D/L circles, no border;
  EmptyState and PageLoading are plain text, no panel; SectionHead =
  24px/600 title + optional muted sub, no rule. `.panel`, `.panel-flat`,
  `.micro-label` and the ticker CSS were deleted from globals.css.
- `lib/web/format.ts`: en-GB everywhere (74.2% not 74,2%; 163,008),
  GATE_LABEL/MARKET_LABEL/labelPilihan/labelHari in English per the deck.

## The data ball (components/landing/DataBall3D.tsx)

Replaces ScoreMatrix3D (file deleted; HeroScene wrapper kept, now lazy-loads
the ball). Construction:

- Input: the featured package's raw 6×6 score matrix (first calibrated
  upcoming package, else first with a matrix — same selection as v1).
- 36 anchor directions: home goals → polar angle (0.35 + i/5·1.5 rad),
  away goals → azimuth ((j/5 − 0.5)·1.9 rad). Temperature of any direction =
  Σ p·exp(−angle²/2σ²), σ = 0.28, normalised to the field maximum.
- 850 fibonacci-sphere cells (InstancedMesh boxes 0.085×0.085×0.05 at
  r = 1.03, oriented along their normals). Cold cells (t < 0.5): one mesh,
  per-instance colour lerped #171410 → #2A2115. Hot cells: three bucketed
  meshes by t ([.5,.68) / [.68,.85) / [.85,1]) with fixed emissiveIntensity
  0.5 / 1.0 / 1.6 (per-instance emissive does not exist in three).
- Inner sphere r = 1.0 with a canvas texture of very faint warm-grey
  lat/long grid lines (alpha ≈ 0.055) — the panel-seam suggestion from the
  approved ball mockup. Amber PointLight sits toward the hottest matrix
  cell; key + rim directionals; a radial-gradient canvas disc under the
  ball as a soft grounding shadow.
- Perf rules carried over unchanged: DPR ≤ 2 (1.5 mobile),
  IntersectionObserver + visibilitychange pause, prefers-reduced-motion =
  one static frame, full dispose on unmount, WebGL failure → 2D heat grid
  fallback with the deck's caption. aria-label per spec.

## Pages

- **Landing**: centered hero — "Know your odds." (clamp 2.5–4.5rem, 600),
  deck sub, two text CTAs with amber arrows, ball center stage (~52vh),
  quiet stats row (leagues calibrated / picks on record / match packages,
  all from `landingStats()`), full-bleed amber band "{labTotal} picks on
  record." (from data), "How it works" (the deck's three lines with the
  deck's supporting sentences; the graded-picks figure is dynamic),
  "The record" (Grade/Promised/Actual/Picks from `ledgerStats()`, honest
  line "Live picks are still being graded." while live_resolved = 0, link
  to /bukti), "Good to know" (the deck's two paragraphs verbatim), deck
  footer. The v1 ticker was dropped (not in the deck; calm standard).
- **Matches**: "Matches" + "Next 72 hours · Updated {date time} WIB"
  (newest package computed_at). Day groups (Today/Tomorrow/weekday + date),
  league header = gate dot + name + gate word. Open rows: time, teams,
  pick label + non-zero grade counts, right side 28px amber probability +
  plain grade letter + "{n} of 3 sources". "Finished": open rows, score,
  up to 3 picks with plain Hit/Miss words.
- **Match detail**: league line (dot + competition + gate word), teams at
  32px/600, meta line, finished state as a plain sentence. "Three sources"
  (16 rows, >10pp spread marks max/min in amber, disagreement count note,
  captured/panel captions), "Likely scores" (borderless 6×6 heat grid,
  rounded-[3px] cells, top-5 as a ranked text list), "About these numbers"
  (plain sentences — see derivations below), "Last six" (open columns,
  form circles, "Scored X · Conceded Y", per-match lines with xG), luck
  section as "Goals vs expected goals (xG)" with one plain line per team,
  "Picks from this package" table ending in Hit/Miss words.
- **Picks**: "Build your parlay." + deck sub. Filters as text toggles
  (A + B / A only / All, amber underline when active). Slip is a sticky
  right column separated by a faint left hairline — no box; "Your slip",
  "No picks yet.", combined probability in 40px mono amber, same-match
  group notes ("combined from the score matrix."), deck footer line,
  12 max enforced and labelled.
- **Record**: "The record" + deck intro. Quiet stat lines ("Lab picks
  {n} · all graded", "Live picks {n} · {r} graded"), By grade
  (Grade/Promised/Actual/Picks), By market, Recently graded with
  Promised % and Hit/Miss. While live_resolved = 0 the deck's sentence
  "No live picks have finished yet. The lab record above is the evidence
  for now." sits under the stats.

## Copy derivations (where the deck met stored data)

- The stored `calibrationGate` text is long Indonesian pipeline prose, so
  it is **not printed**; the gate sentence is chosen from `gate_status`
  using the deck's three English sentences verbatim.
- The stored `leagueResolution.note` is also Indonesian pipeline prose.
  The serving sentence is built from its structured fields instead
  (via = cup-offset, or fitSystem = sportmonks / legacy-div / special) —
  factual, no free-text translation invented.
- The stored `market_bias_warning` is a value-bet alert template
  ("VALUE REBOUND ALERT: … Potensi nilai positif …") — off-product since
  the 2026-11-04 direction correction. When present, the page renders a
  plain note derived from the two structured luck statuses instead.
- Luck `description` (Indonesian prose) is not printed; the line is built
  from `net_luck_rating` + the status code mapped to English labels.
- `feed_mode` exists in **zero** stored packages (checked all payloads),
  so the "Free data mode" meta item is wired but currently never renders.
- Competition country is not present in any payload (names are bare:
  "Bundesliga", "La Liga", …), so league headers show name + gate word
  only — no country was fabricated.
- `ledgerStats()` exposes no promised/claimed average per market, so the
  By market table is Market / Picks / Hits / Actual (the deck's Promised
  column exists only in By grade, where the data supports it).

## Verification (production build, port 3101)

- `npx tsc --noEmit`: clean. `npm run build`: clean; all five routes
  Partial Prerender (◐), same as v1.
- HTTP 200: `/`, `/pertandingan`, `/pertandingan/sm_19621742` (real id),
  `/pilihan`, `/bukti`.
- Spot checks in streamed HTML: "Know your odds.", the 45,866 sub,
  "163,008" twice on the landing (stats + band, both from data),
  "Next 72 hours · Updated Thu 5 Nov 04:29 WIB", "2 of 3 sources",
  real probabilities (87.2% / 89.1% on the list; 56.8% on the detail page),
  "Three sources", "Likely scores", "About these numbers", the partial
  gate sentence, the Sportmonks serving sentence, "Calculated Thursday
  5 November at 04:29 WIB.", "Build your parlay.", "Your slip",
  "The record", "Nothing gets edited.", "No live picks have finished yet".
- Transfer sizes (gzip, HTML): `/` 11,453 B · `/pertandingan` 43,379 B ·
  detail 13,736 B · `/pilihan` 37,498 B · `/bukti` 8,143 B — all at or
  below v1 (15.7K / 50.2K / — / 35.3K / —).
- three.js chunk: 551,273 B raw / 135,762 B gzip; referenced **0 times**
  in every route's HTML including the landing (it loads client-side via
  the landing page chunk, which references its filename — confirmed);
  terminal pages never load it.
- Server log after all checks: 0 TypeError, 0 errors.
- Grep sweeps: no `.panel`/bordered-box classes in the live surface
  (remaining "panel" hits are the `sm_panel` data field); no Indonesian
  UI strings in the live surface (remaining hits are URL paths, internal
  function names, and the product name — all by design). Legacy
  `components/dashboard/*` and `app/api/*` remain untouched and
  unreferenced, as in v1.

## Honest limitations

- **No visual verification.** This VM cannot screenshot (headless browser
  downloads fail through the egress proxy; the remote browser cannot
  reach VM localhost) — same limitation as v1, recorded in its audit.
  The ball's construction, DOM, build, and logs are verified; its pixels
  are not. First true visual check happens when the owner opens the
  preview bridge or the VPS deploy.
- The matches list still calls `getPackagePicks` per finished row
  (known, accepted N+1 from v1; local read-only SQLite).

## Addendum — Fix batch 2026-11-05 (post-preview)

Dua bug dari intipan visual owner, diperbaiki dan terverifikasi screenshot
(`~/workspace/tools/pwshot/shoot2.mjs` → `your_files/shots-v2/`):

1. **Record kosong → tabel lab.** `ledgerStats()` hanya menghitung populasi
   live-run (resolved = 0), jadi halaman Record + seksi "The record" di
   landing menampilkan grade A/B/C dengan Promised/Actual "—". Sekarang
   `LedgerStats` punya `lab_by_grade` + `lab_by_market` dari 163.008 pick lab
   (100% resolved). Catatan penting: kolom `grade` baris lab di DB ternyata
   NULL — grade diturunkan ulang dari `MARKET_GRADE_THRESHOLDS` milik engine
   (sumber kebenaran tunggal; CASE SQL dibangun dari konstanta itu, jadi
   kalibrasi ulang ambang otomatis mengalir). Kandidat di bawah lantai grade
   terendah (92.894) memang tidak pernah diterbitkan sebagai pick, jadi tabel
   per-grade menjumlah ke 70.114 pick ber-grade. Hasilnya: **A — dijanjikan
   81,0% / aktual 79,8% (n=24.670); B — 71,5% / 71,5% (n=32.217); C — 63,3% /
   61,3% (n=13.227)**. Halaman Record: tabel utama = lab ("By grade" +
   "By market" dengan kolom Promised/Actual/Picks), lalu seksi "Live picks"
   terpisah ("No live picks have finished yet." selama resolved masih 0).
   Catatan by-market: pasar berpasangan komplementer (1x2, DC, BTTS, OU)
   Promised≈Actual-nya memang terpaksa simetris oleh desain kandidat lab
   (probabilitas seleksi per laga menjumlah ke konstanta) — bukan bug query.
2. **Waktu menabrak nama tim di daftar pertandingan.** Kolom waktu baris
   fixture sekarang `w-[3.5rem] flex-none whitespace-nowrap` (tim tetap
   `min-w-0`). Terverifikasi di crop resolusi penuh 02-matches.png: "17:00"
   utuh, pisah bersih dari nama tim. (Spasi lebar di sekitar titik/koma pada
   angka = lebar sel monospace IBM Plex Mono, konsisten di seluruh desain —
   bukan bug.)

Verifikasi: tsc bersih, build bersih, 5 rute 200, log server 0 TypeError,
screenshot 02 + 05 dibaca langsung.
