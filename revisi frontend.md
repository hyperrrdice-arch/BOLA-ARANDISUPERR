# REVISI FRONTEND — BFF Data Bersih + Thinking Panel + Anti-Tumpuk

Status: draft final menunggu GO eksekusi. Supersede `tasks/plan.md` v2 (todo lama tetap di `tasks/`).
Lokasi: root repo, sesuai permintaan. Audit pendukung: `.taste-skill/inspect/` (report.json + screenshot).

---

## 1. Kenapa API lokal view-model (jawaban: ya, harusnya gitu)

Masalah sekarang: `/api/agent` melempar payload mentah pipeline (`analisis`, `rawLineups`, `audit`, `cacheMetrics`, `plannerTrace`) dan frontend menggalinya lewat key path dalam (`quant_engine.dixon_coles.*`, `syndicate_debate.dual_judgement.*`) di 12+ kartu. Akibatnya: (a) frontend tahu terlalu banyak detail internal, (b) data dobel dirender 3×, (c) payload penuh dikirim padahal 0 dibaca (`rawLineups`), (d) tiap evolusi pipeline = rombak banyak kartu.

Solusi: **lapisan view-model lokal** (BFF) — mapper murni yang mengubah response pipeline → JSON yang bentuknya PERSIS seperti yang dirender UI.

```
pipeline (planner loop) ──► /api/agent (shell)
                              │
                              ▼
                    lib/view/analysis-view.ts
                    mapPipelineToView() — pure function
                    AnalysisViewSchema (Zod) validasi output
                              │
                              ▼
                    frontend nerima data bersih per section
                    (ringkasan / kuantitatif / odds / debat / thinking)
```

Keuntungan konkret:
1. **Frontend jadi dumb renderer** — tiap section render field-nya 1:1, nol penggalian path dalam
2. **Anti-tumpuk diatur server** — view model sudah memisahkan `hero` / `bukti[]` (maks 5) / `detail{}` (terlipat); frontend tinggal render bentuknya
3. **Payload minimal** — hanya yang dirender dikirim; `rawLineups`/`audit` mentah tidak pernah ke client (debug via `?debug=1`)
4. **Satu titik adaptasi** — pipeline berubah? rombak 1 mapper, bukan 12 kartu
5. **Terdeterministik & bisa diuji** — mapper pure function + `scripts/test-view-mapper.ts` (assert field UI terpetakan semua, nol kebocoran field mentah)

Opsi yang lebih malas (mapping di frontend, biarkan `/api/agent` mentah) = kondisi sekarang, ditolak.

---

## 2. Kontrak view-model (`AnalysisViewSchema`)

```jsonc
// GET /api/agent?match_id=...  →  AnalysisView   (?debug=1 → payload mentah pipeline)
{
  "match":   { "id", "home", "away", "kickoff_wib", "competition" },
  "ringkasan": {
    "verdict": "PASS_NO_BET",          // display-size, elemen dominan view ini
    "prediksi": "1-1", "keyakinan": "Rendah",
    "alasan": "ringkasan_perencanaan planner",
    "faktor_kunci": ["..."],
    "integrity": { "gaps": [], "status_estimasi": [] }
  },
  "kuantitatif": {
    "hero":  { "prob": {...}, "fair_odds": {...}, "ev_teratas": {...} },   // 1 bintang
    "bukti": [ { "label", "value" } ],          // maks 5 baris
    "detail": {                                  // default terlipat
      "kelly": { "simulator": {...}, "tabel": [...] },
      "metode": { "baseline", "shrinkage", "dixon_coles", "shin_kelly", "calibration_metadata" },
      "splits": { ... }, "pasar_lain": [...]
    }
  },
  "odds":   { "bookmakers": [...], "dislocation": {...}, "smart_money": "..." },
  "debat":  { "consensus": "...", "supreme": {...},
              "persona": [ { "role", "model", "ringkasan", "argumen" } ],   // terlipat per persona
              "dual_bench": {...} },
  "thinking": {                                    // SECTION THINKING PLANNER (§3)
    "steps": [ { "step", "tool", "alasan", "trigger", "coverage" } ],
    "stop_reason": "verdict", "durasi_ms": 229900
  },
  "markets": null                                   // on-demand (scan 1xBet)
}
```

Aturan mapper: (a) semua angka tetap berasal dari `lib/quant/*` apa adanya, mapper TIDAK menghitung ulang; (b) output divalidasi `AnalysisViewSchema` sebelum dikirim (fail-fast 500 + debug info); (c) `marketInsights`/`humanReport`/`narrativePrediction` dipetakan ke `debat`/`ringkasan`, bukan ditampilkan mentah.

---

## 3. Section Thinking Planner (baru, permintaan user)

Satu section penuh di tab Ringkasan: **"Cara agen menyusun analisis ini"** — menampilkan loop `plan → act → evaluate → re-plan` apa adanya dari `plannerTrace`:

- **Timeline per step**: nomor → tool yang dipanggil → **alasan planner** (ini "thinking"-nya: kenapa langkah itu dipilih)
- **Jejak re-plan**: trigger machine-verifiable yang memicu perubahan rencana (`FIELD_KOSONG`, `CONSENSUS_LEMAH`, `ODDS_DISLOCATION`) + hasil `coverage_check` evaluator
- **Penutup**: `stop_reason`, `ringkasan_perencanaan`, durasi

Bentuk: ringkasan timeline terbuka (cukup terlihat di 1 layar), tiap step bisa dikembangkan untuk lihat alasan penuh. Default: 2 step pertama + step yang memicu re-plan terbuka, sisanya terlipat. Data 100% dari `thinking.steps` view-model — frontend tidak mengarang apa pun.

---

## 4. Aturan Anti-Tumpuk (berlaku semua view)

1. Satu elemen dominan per view (angka keputusan display-size)
2. Terbuka default: ringkasan + maks 5 baris bukti. Sisanya terlipat, judul informatif ("Cara angka ini dihitung", "Lihat 14 pasar lainnya")
3. Hierarki angka: keputusan display → bukti 14–16px → turunan (λ/μ, margin, sample) ≥12px
4. `<details>` native untuk semua lipatan (nol JS state, keyboard-accessible)
5. Brand terminal dipertahankan: mono untuk angka/ID/tabel saja (tabular figures), prose & label pakai text face, body 14–16px (deviation skill dicatat, `--allow mono` di inspector)

---

## 5. Task List

### Phase 1 — Data Bersih (BFF)
- [ ] **T1** `lib/view/analysis-view.ts`**: mapper `mapPipelineToView()` + `AnalysisViewSchema` (Zod) — pure function, nol I/O. Mapping 1:1 ke bentuk §2.
- [ ] **T2** `/api/agent` kirim `AnalysisView`** (`?debug=1` = payload mentah; `rawLineups`/`audit`/`cacheMetrics` tidak pernah ke client default). `plannerTrace` → `thinking`.
- [ ] **T3** `scripts/test-view-mapper.ts`**: runnable check — fixture response pipeline nyata → assert: semua field yang dirender UI ada, nol field mentah bocor, angka identik dengan sumber.

### ✅ Checkpoint 1: tsc + build + test-view-mapper lulus · response client = bentuk §2 persis

### Phase 2 — Buang Redundansi (adaptif ke view-model)
- [ ] **T4** CUT `MarketOddsOverviewCard` → `archive/legacy-components/`; `smart_money` ke view `odds`
- [ ] **T5** MERGE `DualThinkingConclusionCard` → `SyndicateDebateCard` (dual bench + supreme tampil 1×, sumber `debat.*`)
- [ ] **T6** MERGE `KellyMatrixCard` → `QuantEngineCard` (seksi `kuantitatif.detail.kelly`) + pangkas `DeepMathEvidenceCard` → panel metode `detail.metode` (≤150 baris)
- [ ] **T7** `faktor_kunci` dirender 1× (komponen kecil dari `ringkasan.faktor_kunci`)

### ✅ Checkpoint 2: nol duplikat · semua info lama tercapai (diff screenshot)

### Phase 3 — UI Verdict-First + Anti-Tumpuk
- [ ] **T8** Tab 5→4: **Ringkasan** (default) · **Kuantitatif** · **Odds** · **Debat**; markets 1xBet/Scanner on-demand (1 klik dari Ringkasan)
- [ ] **T9** Restack Kuantitatif: `hero` display-size, `bukti[]` ≤5 baris, `detail{}` terlipat (`<details>`)
- [ ] **T10** Restack Debat: `supreme`/`consensus` di atas, argumen persona terlipat per persona (judul: persona + kesimpulan 1 kalimat)
- [ ] **T11** **Section Thinking Planner** (§3): timeline loop + alasan + trigger + coverage + stop_reason, dari `thinking.steps`
- [ ] **T12** Loading jujur: elapsed timer + estimasi 2–7 menit; hapus checklist statis palsu ("✓ Fase 1")

### ✅ Checkpoint 3: run match nyata end-to-end · thinking panel tampil · verdict ≤1 layar · 1 elemen dominan/view

### Phase 4 — Enteng + Visual
- [ ] **T13** Lazy & fetch: `next/dynamic` tab berat (OneXBet 853ln), cache hasil `/api/odds` (stop re-fetch tiap tab), opsi horizon 72h di FilterToolbar
- [ ] **T14** Tokens & tipografi: radius 2 nilai, padding 1 nilai, error tone 1 resep; hapus 101 shadow statis + 204 hairline dekoratif (tabel asli boleh bergaris); body 12→14/16px; micro-label → sentence case; mono data-only; buang noise operator ("SISTEM SIAP TEMPUR", cache stats) dari first screen; fix wrap header mobile
- [ ] **T15** Gate: `lint.mjs` + `inspect.mjs` (1440/768/390) + critique, maks 3 ronde, `--allow mono`

### ✅ Final: build+tsc hijau · test-planner + test-view-mapper lulus · inspect tanpa FAIL · user review

---

## 6. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Mapper salah petakan angka | Tinggi | Angka di-copy apa adanya (nol kalkulasi) + assert identik di test-view-mapper |
| Info terasa "tersembunyi" setelah disclosure | Sedang | Judul lipatan informatif; audit: semua field hari ini tercapai ≤1 klik |
| Kontrak berubah untuk konsumen lain | Rendah | `/api/agent` cuma dikonsumsi dashboard; `?debug=1` menyediakan bentuk lama |
| page.tsx raksasa saat dirombak | Sedang | Slice per task, build check tiap task |

## 7. Out of scope (ponytail)
- Riwayat analisis per match (simpan `AnalysisView` ke SQLite + endpoint baca) — add when user butuh track record
- Streaming progress real-time (SSE per stage) — add when latensi 2–7 menit jadi keluhan
- Outcome tracker prediksi-vs-hasil (masih di roadmap ARCHITECTURE.md)
