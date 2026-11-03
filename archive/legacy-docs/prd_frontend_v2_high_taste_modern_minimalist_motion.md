# PRODUCT REQUIREMENTS DOCUMENT (PRD) — FRONT-END SYSTEM V2
**Project Title:** BOLA-ARANDISUPERR (Quantitative Sports Analytics & Multi-Agent Syndicate Platform)  
**Target Agent Role:** `frontend-architect`  
**Mandatory Active Skills:** `taste`, `frontend-ui-engineering`, `ui-ux-pro-max` (`motion.csv`, `styles.csv`, `typography.csv`, `ui-reasoning.csv`), `design-system`, `ui-styling`, and `constraint-driven-development`.  
**Technology Stack:** Next.js (App Router), TypeScript, Tailwind CSS, Shadcn UI primitives, Framer Motion / CSS GPU-accelerated motion tokens.

---

## 1. Executive Summary & Product Objective
BOLA-ARANDISUPERR is an institutional-grade quantitative soccer analytics and market value discovery platform. It merges pure statistical probability modeling (**Dixon-Coles**, **Vig-Stripping**, and **Kelly Criterion**) with a real-time **5-Agent AI Syndicate Orchestrator**.

The Front-End front-facing application (`app/page.tsx`, `components/dashboard/*`) must function as a high-density, low-latency financial/quant terminal. It guides users from an initial high-level Match Explorer/Catalog to deep-dive match workspaces without cognitive clutter, visual noise, or artificial decorations.

---

## 2. Design Vision & Strict "Taste" Constraints (Anti-AI Slop Policy)

The platform must exude precision, mathematical rigor, and editorial restraint. The agent must enforce the following **Floor Guards** derived from `constraint-driven-development` and the `taste` skill:

### A. Strict Invariants & Prohibitions (Zero "AI Slop")
1. **NO FONT GLOW / TEXT SHADOW:** Never apply `text-shadow`, glowing neon aura, gradient-clipped text fills (`bg-clip-text text-transparent` neon gradients), or blurred text glow effects on numbers, badges, or headers.
2. **NO BOX GLOW / GLOWING DROPSHADOWS:** Strictly forbid colored ambient box shadows (e.g., `shadow-emerald-500/50`, `shadow-cyan-500/30`, colored glow rings). Cards must not emit glowing light.
3. **NO CLICHÉ AI SLOP ORNAMENTS:** Forbid psychedelic mesh gradients, oversized noisy radial gradients, bloated semi-opaque glassmorphism with heavy colored blur, decorative cyber grid lines, or fake futuristic badges.

### B. High-Taste Modern Minimalist Tenets
* **Crisp 1px Hairline Architecture:** Visual separation relies on solid matte surfaces (`bg-neutral-950`, `bg-neutral-900/60`, `bg-zinc-900/40`) bounded by razor-sharp hairline borders (`border border-neutral-800` or `border-zinc-200/10`).
* **Swiss-Grid & Monospace Alignment:** All odds, probabilities, expected goals ($\lambda$), bankroll figures, and timestamps must render with `font-mono tabular-nums tracking-tight` for unambiguous vertical column alignment. Body text and analytical reasoning use a clean, neutral sans-serif font.
* **Disciplined Semantic Restraint:** Accent colors serve functional semantics only:
  * **Emerald / Forest Green (`text-emerald-400`, `bg-emerald-950/40`, `border-emerald-800/50`):** Positive Expected Value (+EV) and favorable model discrepancies.
  * **Amber / Ochre (`text-amber-400`, `bg-amber-950/40`):** Cautionary data variance, wide spreads, or partial confidence.
  * **Coral / Crimson (`text-rose-400`, `bg-rose-950/40`):** Negative EV, severe market bias, or data integrity anomalies.
  * All accents must be flat, muted, and contained inside solid pill badges or minimal 2px status indicator bars—never glowing.

---

## 3. Motion Architecture & Modern Animation Specs

Interactions must feel instant, physical, and purposeful, following specifications from `ui-ux-pro-max/data/motion.csv`:

### A. Easing & Timing Parameters
* **Primary Curves:** Crisp exponential decelerate `cubic-bezier(0.16, 1, 0.3, 1)` or damped spring physics (`stiffness: 380, damping: 32, mass: 1`).
* **Micro-interactions (Hover, Toggle, Active Tab):** `140ms – 180ms`.
* **Container Expansion / Layout Transitions:** `220ms – 320ms`.
* **Hardware Acceleration:** Only animate compositor-friendly properties (`transform`, `opacity`). Never animate `height`, `width`, or `margin` directly without layout projection.

### B. Choreographed Motion Primitives
1. **Staggered Catalog Reveal:** Match cards entering the viewport from `/api/matches` animate with subtle vertical displacement: `opacity: 0 -> 1`, `translateY: 6px -> 0px` with an incremental stagger of `25ms` per item.
2. **Sliding Fluid Indicators:** Tab selectors in `FilterToolbar.tsx` and `SyndicateDebateCard.tsx` utilize layout projection (`layoutId="activeFilterPill"`) to smoothly glide the indicator between selections.
3. **Data Interpolation (Number Tickers):** Expected Goals ($\lambda$), Kelly stake %, and Model Win % update via smooth client-side counting interpolation (`0.3s` duration) when switching matches or adjusting bankroll sliders.
4. **Normalized Ratio Bar Unfolds:** Dual-bar comparative graphs (Model Probability vs. Market Implied Probability) expand horizontally via `scaleX: 0 -> 1` anchored at `origin-left`.
5. **Reduced Motion Accessibility:** Honor `@media (prefers-reduced-motion: reduce)`. If enabled, suppress all spatial translations and scale transforms, falling back to instantaneous opacity states.

---

## 4. Detailed Component & Surface Requirements

```
app/page.tsx (Unified Layout Orchestrator)
 ├── Top Telemetry & System Header
 ├── FilterToolbar.tsx (Sticky Search, League Filter, Sort)
 ├── MatchCatalogView.tsx (Responsive Match Matrix)
 └── [Selected Match Deep-Dive Workspace]
      ├── MatchHeaderCard.tsx (Team context, calibrated ratings)
      ├── DataIntegrityShield.tsx (Provenance & validation cache)
      ├── MarketOddsOverviewCard.tsx (Raw odds vs No-vig fair odds)
      ├── QuantEngineCard.tsx (Dixon-Coles λ, ρ, 1X2 distribution)
      ├── BettingScannerCard.tsx (+EV market opportunities)
      ├── KellyMatrixCard.tsx (Fractional Kelly bankroll allocation)
      ├── StatsAndSplitsCard.tsx (H2H, Home/Away splits)
      ├── TacticalPitchCard.tsx (SVG vector field mapping)
      └── SyndicateDebateCard.tsx (5-Agent consensus & Judge verdict)
```

### 4.1. Landing & Navigation Layer (`app/page.tsx` & `FilterToolbar.tsx`)
* **Hero Telemetry Strip:** Minimalist top bar showing system health, active leagues loaded (`lib/league-constants.ts`), database verification state (`lib/db/sqlite-master.ts`), and count of active +EV edges detected today.
* **FilterToolbar:**
  * Clean, compact search input supporting keyboard shortcuts (`/` or `⌘K`).
  * Horizontal scrollable league pill bar (EPL, La Liga, Serie A, Bundesliga, Ligue 1, etc.) mapped via `lib/league-mapping.ts`.
  * Multi-state sorting: By Kick-off Time, Edge (+EV) Magnitude, or Liquidity.
  * Debounced input dispatch (150ms) to eliminate redundant re-renders.

### 4.2. Catalog View (`components/dashboard/MatchCatalogView.tsx`)
* Display match cards in a clean, high-density grid.
* Card surfaces: Matte background (`bg-neutral-900/40`), crisp 1px border (`border-neutral-800`), hover state shifting cleanly to `border-neutral-700` and `bg-neutral-900/80` (no drop-shadow bloom).
* Display Kick-off time (localized), Home vs Away names (normalized via `lib/quant/team-normalizer.ts`), 1X2 primary bookmaker odds, and a discrete status tag if an edge exists.
* Elegant skeleton states using a soft neutral shimmer effect.

### 4.3. Analytical Workspace Components (`components/dashboard/*`)

1. **`MatchHeaderCard.tsx`:**
   * Prominent display of Home and Away clubs with league badge and match timing.
   * Visual comparison of calibrated team ratings loaded from `data/calibrated_ratings.json` and `lib/quant/ratings-loader.ts`.
   * Action buttons: Back to Catalog, Refresh Market Odds, Re-run AI Syndicate.

2. **`DataIntegrityShield.tsx`:**
   * Displays verification metrics from `lib/stats-validator.ts` and cache status from `lib/stats-cache.ts`.
   * Discloses data provenance: Historic SQLite DB sample size vs fallback scraped data. Clear warning tags if sample size is statistically thin.

3. **`MarketOddsOverviewCard.tsx`:**
   * Consumes bookmaker odds (`lib/1xbet.ts`).
   * Displays raw market odds alongside vig-stripped true implied probabilities calculated via `lib/quant/vig-stripping.ts`.
   * Covers 1X2, Over/Under (Totals), Asian Handicap, and BTTS with calculated bookmaker margin (overround %).

4. **`QuantEngineCard.tsx`:**
   * Renders the mathematical output of `lib/quant/dixon-coles.ts`.
   * Shows calculated Home Attack/Defense strength, Away Attack/Defense strength, expected goals ($\lambda_1, \lambda_2$), and low-score dependence correlation ($\rho$).
   * Dual-bar comparative display: **Model Probability vs Market Implied Probability** highlighting the delta edge.

5. **`BettingScannerCard.tsx`:**
   * Fetches analysis from `/api/betting`.
   * Filterable tabular view of positive EV (+EV) wagers.
   * Each entry contains: Market Name, Target Outcome, Bookmaker Odds, Fair Odds, Calculated Edge %, and a discrete priority badge.

6. **`KellyMatrixCard.tsx`:**
   * Powered by `lib/quant/kelly.ts`.
   * Presents dynamic sizing matrices: Full Kelly, Half Kelly ($0.5f^*$), and Quarter Kelly ($0.25f^*$).
   * Interactive bankroll input/slider with instantaneous real-time recalculation of recommended currency units and risk caps.

7. **`StatsAndSplitsCard.tsx`:**
   * Ingests verified team metrics from `lib/stats-fetcher-agent.ts` and SQLite historical stores.
   * Renders Home/Away splits, rolling 5-match form, goal frequency curves, and Head-to-Head history using clean comparative ratio bars.

8. **`TacticalPitchCard.tsx`:**
   * Vector-based SVG pitch diagram using clean architectural stroke lines (`stroke-neutral-800` on `bg-neutral-950`).
   * Renders tactical territory control, pressing lines, and high-danger attacking zones with flat, semi-opaque geometric fills.

9. **`SyndicateDebateCard.tsx`:**
   * Consumes `/api/agent` and `lib/syndicate-orchestrator.ts` running the 5-Agent debate workflow.
   * **Multi-Step Streaming/Progress State:** Minimal horizontal stepper detailing the progress of each agent: Data Specialist, Quant Auditor, Tactical Modeler, Market Risk Assessor, and Presiding Judge/Hakim (`scripts/test-qwen-hakim2.mjs`).
   * **Debate Stream Interface:** Structured cards detailing each agent's individual thesis, counter-arguments, and risk cautions.
   * **Final Consensus Verdict:** Executive decision panel showing the consolidated recommendation, final confidence score (0–100%), and reasoning narrative.

---

## 5. Technical Contracts, Data Flow & State Management

### A. Progressive API Orchestration
To prevent blocking UI states, the front-end loads data progressively:
```
Step 1: GET /api/matches
        └── Populate FilterToolbar & MatchCatalogView immediately.

Step 2: User selects match
        └── Mount MatchHeaderCard with initial catalog snapshot.
        └── Trigger GET /api/betting (fetches Dixon-Coles, Vig-Stripping, Kelly).
        └── Skeletons for QuantEngineCard, MarketOdds, KellyMatrix, and StatsCard resolve.

Step 3: Trigger POST /api/agent (if user requests AI Syndicate analysis)
        └── SyndicateDebateCard enters isolated stepping state.
        └── Rest of dashboard remains fully interactive and functional.
```

### B. Strict Type Integrity
* All components must import and strictly implement the interfaces defined in `components/dashboard/types.ts`.
* Zero usage of `any` or untyped response parsing.
* Error boundaries must be implemented at the individual card level (`components/dashboard/DataIntegrityShield.tsx`, `SyndicateDebateCard.tsx`) to prevent single-endpoint failures from breaking the entire page.

---

## 6. Implementation Checklist for Frontend Architect

1. [ ] **Token & Style Audit:** Clean `app/globals.css` of any `text-shadow` or glowing `box-shadow` classes. Standardize neutral palettes (`neutral-950`, `neutral-900`, `neutral-800`).
2. [ ] **Typography Refactor:** Ensure all numerical figures across dashboard cards apply `font-mono tabular-nums`.
3. [ ] **Animation Integration:** Configure hardware-accelerated Framer Motion / CSS transitions for catalog item staggering, sliding filter pills, and probability bar reveals.
4. [ ] **Component Polish:** Refactor each of the 9 dashboard cards to adhere to the matte hairline 1px border aesthetic with zero glowing boxes.
5. [ ] **Interactive Kelly Simulator:** Verify instant client-side calculation and number ticker transitions when bankroll inputs change.
6. [ ] **Syndicate Debate UI:** Implement clean sequential progress state and collapsible debate rounds for the 5-Agent Syndicate.
7. [ ] **Accessibility & Responsiveness:** Test responsive layout breakpoints (mobile, tablet, desktop wide) and verify `prefers-reduced-motion` compliance.