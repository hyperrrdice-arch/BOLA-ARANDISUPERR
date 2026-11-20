# Football Pre-Match Analyst — Safe-Bet Parlay Finder

> Find the **highest-probability outcomes** in football, grade them honestly,
> and build parlays out of the selections most likely to land.

[![Live](https://img.shields.io/badge/live-bola.mhmdarandi.biz.id-FF6935)](https://bola.mhmdarandi.biz.id)
![Next.js](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![Data](https://img.shields.io/badge/data-free%20feeds%20only-success)

A pre-match football analytics app with one job: **safe bets for parlays**.
It is deliberately *not* a value-bet hunter and *not* a beat-the-market tool.
Selections are ranked by model probability plus cross-source agreement
(model × market × archived prediction panel) as a safety signal.
Expected value and Kelly sizing exist only as secondary notes — they never
gate a decision.

**The golden rule:** every number comes from deterministic quantitative code
(`lib/quant/*`). No LLM ever computes or invents a figure; the language model
layer only narrates a verdict on top of the finished quant package.

**Live:** https://bola.mhmdarandi.biz.id

---

## What it does

- **Rates upcoming fixtures** across ~250 canonical leagues with calibrated
  team ratings (Dixon–Coles score matrices, James–Stein shrinkage,
  Shin method for stripping the bookmaker's margin).
- **Grades every market selection A / B / C** by empirical hit-rate bands
  measured on 163,008 fully resolved historical picks — e.g. double-chance
  reaches grade A at ≥ 75%, over 1.5 at ≥ 85%, while BTTS is capped at C
  (measured as the least honest market).
- **Labels calibration honestly.** Each league carries a gate status —
  `calibrated`, `partial`, or `not calibrated` — earned through a
  pre-registered out-of-sample gate that is never loosened. The gate is a
  **label, not a limiter**: picks from uncalibrated leagues are published
  with their status attached, never hidden and never silently upgraded.
- **Builds parlay suggestions** (a safer 3-selection slip and a standard
  4-selection slip) and always shows the combined probability as an honest
  range — the independence product is labelled an upper bound, because the
  lab measured it overstating survival by ~1.5–4 points.
- **Keeps a public proof ledger.** Every live pick is written to a ledger
  and resolved against real results; the record page shows hit-rates split
  by grade *and* by gate segment, so a blended headline can never flatter
  the weak segments.
- **One fixture, one identity.** Fixtures arriving from several sources
  are resolved to a single canonical fixture with a full alias trail, so
  the same match can never be counted twice under two spellings — in the
  schedule, the pick builder, or the ledger.
- **Official picks are frozen at publication.** A two-phase publish path
  stamps each official pick with the probability in force at decision
  time (validated against the kickoff cutoff inside the commit itself);
  later re-analysis never rewrites a published number. Official slips are
  assembled from those frozen picks by a dedicated slip library, with
  joint probabilities taken from the score matrix where one exists.
- **The served model is a versioned manifest.** Lab and production load
  the same immutable, content-addressed ratings artifact; promotion is an
  explicit, gated step — a refresh can produce a candidate, never a
  silent swap. The shrinkage setting (κ-fit 10) was kept after a sealed
  held-out experiment failed to justify changing it.
- **Reads like a sports paper.** The November 2026 redesign rebuilt all
  five pages on a light editorial system (paper surface, green-black ink,
  orange accent): the nearest predicted match headlines the home page,
  kickoff times sit in their own scannable column, drafts on the pick page
  survive a reload and are revalidated, results open on what has actually
  been graded — and every match detail carries a 2D score map with an
  optional on-demand 3D view (Three.js loads only when a reader asks).

## How it works

```
free data feeds ──► 12-hour refresh chain ──► canonical registries
                                                    │
                              calibrated ratings + cup offsets
                                                    │
                                          quant package per fixture
                                                    │
                              pick engine (grades, gate labels, dedup)
                                                    │
                                    ledger ──► web app ──► resolver
                                      ▲                         │
                                      └──── real results ───────┘
```

1. **Ingest (every 12 hours, fully offline-capable).** Results, closing
   odds and fixtures are imported from free feeds (football-data.co.uk,
   22 divisions, plus fixture catalogues). No paid API is required to run
   the app; the render path calls no external API at all.
2. **Canonical identity.** Teams and leagues from every source are merged
   into single canonical registries (~6,600 teams, 250 leagues), so a club
   is never double-counted under two spellings or two source IDs — and
   fixtures themselves are resolved across sources into one canonical
   fixture (with score revisions kept on a stated 90-minute regulation
   basis), so overlapping catalogues can never double-record a match in
   the ledger.
3. **Modelling.** Domestic leagues get per-league calibrated ratings;
   cup ties are handled by a global cross-league offset model instead of
   pretending a cup is a league. Model quality is reported out-of-sample
   (log-loss 1.0092 on 6,317 held-out matches) — including where the model
   provably loses to the closing market line.
4. **Pick engine.** Selections are graded, gate-labelled per pick, and
   combined into parlay suggestions with the combined probability shown
   up front.
5. **Resolution loop.** After matches finish, the resolver scores every
   ledger pick against the real result. Picks whose competitions have no
   free results source stay *unresolved* — they are never guessed.

Full detail: [`ARCHITECTURE.md`](ARCHITECTURE.md) ·
Repo map: [`STRUCTURE.md`](STRUCTURE.md)

## Data sources

| Source | Role | Status |
| --- | --- | --- |
| football-data.co.uk | Results + closing odds, 22 divisions | Active — main feed |
| Fixture catalogues (TheStats) | Upcoming fixtures | Active |
| Sportmonks | Historical predictions archive (panel comparison only) | Trial ended 10 Nov 2026 — never in the odds path |
| football-data.org | Extra fixtures (12 competitions) | Importer ready, dormant |

## Tech stack

- **Next.js 16 + React + TypeScript** (App Router); Three.js serves only
  the on-demand 3D score map on match detail — lazy-imported when a
  reader chooses it, never shipped to the other routes
- **SQLite** stores for dataset, fixtures, quant packages and the pick ledger
- **Quant core:** Dixon–Coles, iterative proportional fitting with
  shrinkage, James–Stein blending, Shin margin removal — all hand-rolled,
  no ML framework
- **Automation:** a single idempotent refresh script on a 12-hour cron;
  the whole pipeline runs on one small server

## Project status

- **Live and in free mode** since 10 Nov 2026 — no paid data dependency.
- Canonical registries: 250 leagues, all source identities mapped.
- Domestic recalibration complete; cup offset model complete
  (0 calibrated / 4 partial / 13 not calibrated — the gate was not loosened).
- Data-path audit (16 Nov 2026) closed its urgent chain: proof page
  segmented by gate, per-pick gate labels, duplicate-fixture filter.
- **November 2026 improvement programme merged to `main`:** the PRD
  K0–K8 series (reproducible CI, canonical fixture identity, official
  publication, slip library, model-manifest parity, the sealed κ
  experiment, UI and record rebuilds, release acceptance), the K8
  owner-review fixes, and the full five-page redesign — verified on
  `main` itself with the complete regression suite green
  (831 assertions, typecheck and production build included).
- Live ledger at its last full verification (16 Nov 2026): 1,321 live
  picks resolved — grade A 81.1%, B 76.6%, C 61.0%.
- **Current objective:** the live ledger must prove the app produces
  winning tickets by **5 January 2027**, when the fixture catalogue ends.
  Progress is public on the [/bukti](https://bola.mhmdarandi.biz.id/bukti)
  page — wins and losses alike.

## Run it locally

```bash
npm install
npm run dev   # dashboard at http://localhost:3101
```

The refresh chain and slate builder live in `scripts/`; see
[`STRUCTURE.md`](STRUCTURE.md) for the annotated map.
