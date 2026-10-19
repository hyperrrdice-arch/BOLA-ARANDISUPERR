# BOLA-ARANDISUPERR (Football Quantitative Intelligence & Syndicate Engine)

> **Next.js 15 App Router platform combining deterministic quantitative sports modeling, Shin vig-stripping, multi-model LLM syndicate debates, and local-first SQLite resilience.**

---

## Overview

**BOLA-ARANDISUPERR** is an autonomous pre-match football intelligence system designed to detect value betting opportunities and market dislocations across major European leagues. 

Unlike standard AI betting apps that rely on LLMs to predict scores or hallucinate statistics, this platform adheres to a strict principle:
> **Zero LLM calculation in quantitative metrics.** All probabilities, fair odds, expected values (EV), and Kelly stakes are computed deterministically by verified algorithms in `lib/quant/*`. LLMs are employed exclusively for natural language reasoning, tactical debate, and planning orchestration.

---

## Key Pillars & Architecture

```
User (Dashboard UI)
   │
   ▼
GET /api/agent?match_id=...
   │
   ▼
[1] Autonomous Thinking Planner (lib/agent/planner.ts)
   │  - Loop: Plan ➔ Act ➔ Evaluate ➔ Re-plan
   │  - Native tool-calling with machine-verifiable coverage checks
   │
   ├──► [2] Deterministic Quant Engine (lib/quant/*)
   │       - Dixon-Coles Bivariate Poisson (tau adjustment for low scores)
   │       - Empirical Bayesian Shrinkage (James-Stein rating shrinkage)
   │       - Shin (1993) Vig-Stripping (isolating true market probability)
   │       - Portfolio Kelly Criterion (fractional sizing & variance protection)
   │
   ├──► [3] Multi-Model Syndicate Debate (lib/syndicate-orchestrator.ts)
   │       - Stage 1: Bull vs. Neutral vs. Bear (heterogeneous models)
   │       - Stage 2: Dual Judgement cross-examination + Consensus Arbiter
   │
   └──► [4] Local-First Storage & Vault (lib/db/*)
           - SQLite master catalog, historical telemetry, odds anchor history
           - Upstream rate-limit shield with graceful offline fallback
   │
   ▼
[5] Backend-For-Frontend View Model (lib/view/analysis-view.ts)
   │  - Pure function mapping pipeline state ➔ AnalysisViewSchema (Zod)
   │  - Display-size verdict, capped evidence rows, keyboard-accessible details
   │
   ▼
Responsive Terminal Dashboard (app/page.tsx)
   - Tab 1: Ringkasan (Verdict, Key Drivers, Thinking Planner Trace)
   - Tab 2: Kuantitatif (Dixon-Coles, Kelly, Fair Odds, Special Markets)
   - Tab 3: Odds & Bookmakers (Dislocation Bar, Multi-Bookmaker Spreads)
   - Tab 4: Syndicate Debate (5-Persona Arguments & Consensus)
   - Tab 5: 1xBet Deep Markets (On-demand deep market scan)
```

---

## Mathematical Foundations

1. **Dixon-Coles Poisson Model** (`lib/quant/dixon-coles.ts`):
   $$\lambda = \text{league\_baseline} \times \alpha_i \times \beta_j \times \gamma_{\text{home}}$$
   $$\mu = \text{league\_baseline} \times \alpha_j \times \beta_i$$
   Adjusted via the parameter $\tau(\lambda, \mu, \rho)$ for low-scoring match states $(0-0, 1-0, 0-1, 1-1)$ to counter standard Poisson independence flaws.
2. **Shin Vig-Stripping** (`lib/quant/vig-stripping.ts`):
   Solves for insider-trading parameter $z$ via fixed-point iteration, extracting the true probability vector $p$ from bookmaker odds $(O_H, O_D, O_A)$ without assuming proportional margins.
3. **Kelly Criterion Staking** (`lib/quant/kelly.ts`):
   $$f^* = \frac{b \cdot p - q}{b} \times \text{fractional\_multiplier}$$
   Constrained by strict safety clamps: negative EV picks produce 0 stake, maximum exposure is capped, and odds from thin markets require volume guards.

---

## Directory Structure

```text
├── app/
│   ├── api/
│   │   ├── agent/route.tsx       # Core analysis pipeline & BFF endpoint
│   │   ├── matches/route.ts      # Fixture catalog (live or offline local DB)
│   │   ├── odds/route.ts         # Odds comparison & historical anchors
│   │   └── betting/route.ts      # Dual-model A/B tactical scanner
│   ├── layout.tsx                # App shell, fonts, meta
│   ├── page.tsx                  # Main reactive dashboard interface
│   └── globals.css               # Terminal typography & dark/light styling
├── components/
│   └── dashboard/                # Modular dashboard UI components
├── lib/
│   ├── agent/                    # Autonomous planner, tools, LLM interface
│   ├── quant/                    # Dixon-Coles, Shin vig, Kelly, ratings
│   ├── db/                       # SQLite clients (telemetry, catalog, vault)
│   ├── view/                     # BFF view-model & Zod schemas
│   └── syndicate-orchestrator.ts # Multi-agent debate orchestration
├── docs/
│   ├── db-snapshot.md            # Analysis snapshot database contract
│   ├── backtest-report.md        # Quant backtesting benchmarks
│   └── plans/                    # Engineering specifications & review docs
├── scripts/                      # Ingestion, calibration, and test suites
└── tasks/                        # Phase plans and progress tracking
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16 (App Router) + React 19 |
| **Language** | TypeScript 5 (Strict Mode) |
| **Styling** | Tailwind CSS 4 |
| **Data Validation** | Zod 4 |
| **Database** | SQLite via `node:sqlite` (Zero external daemon dependency) |
| **AI / LLM** | Gemini 3.8 Flash / 9Router API Client |
| **Quant Engine** | Pure deterministic TypeScript (`lib/quant/*`) |

---

## Getting Started

### 1. Prerequisites
- Node.js 20.x or higher
- npm / pnpm / yarn

### 2. Environment Setup
Copy the example environment configuration:
```bash
cp .env.example .env.local
```
Configure your keys in `.env.local`:
```env
THESTATS_API_KEY=your_thestats_key
ONEXBET_API_KEY=your_1xbet_key
ROUTER_API_KEY=your_llm_router_key
```

### 3. Installation & Run
```bash
# Install dependencies
npm install

# Start development server
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Available Commands & Scripts

### Development & Build
```bash
npm run dev              # Run Next.js local dev server
npm run build            # Production Next.js build
npm run start            # Start production server
npm run lint             # Run ESLint
npx tsc --noEmit         # Full TypeScript typecheck
```

### Data Synchronization & Operations
```bash
npm run sync:upcoming    # Sync upcoming match catalog to local SQLite
npm run sync:weekly      # Ingest weekly match telemetry and stats
npm run sync:outcomes    # Resolve match results and settle bets
npm run report:snapshot  # Generate database snapshot health report
```

### Quant Verification & Integrity Tests
```bash
npx tsx scripts/test-view-mapper.ts         # Verify BFF mapper contracts (53/53)
npx tsx scripts/test-value-bets.ts          # Guard value bets strictly on market odds
npx tsx scripts/test-odds-anchor.ts         # Validate local historical odds anchors
npx tsx scripts/test-offline-intel.ts       # Test graceful offline degradation
npx tsx scripts/verify-tier1-offline-quant.ts # Verify quant engine output offline
```

---

## Documentation

- **Architecture Deep-Dive**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Database Snapshot Contract**: [`docs/db-snapshot.md`](docs/db-snapshot.md)
- **Performance & Pacing Standards**: [`PERF.md`](PERF.md)
- **Change History**: [`CHANGELOG.md`](CHANGELOG.md)

---

## License & Disclaimer

This software is for sports analytical research and quantitative modeling demonstration purposes only. Past statistical edge does not guarantee future financial returns. Use responsible risk management.
