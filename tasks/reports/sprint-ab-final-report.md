# Laporan Akhir Sprint A+B — Eksekusi Lanjutan Brief Data, Akurasi & Efisiensi

Basis: master `fb21f7f` · Branch: **`sprint/a-b-lanjutan`** (TIDAK di-merge,
TIDAK di-deploy — menunggu tinjauan pemilik) · Worktree:
`~/workspace/coding/app-football-sprint` · Semua fase dikerjakan berurutan
dengan stop-gate per fase; suite selalu dijalankan SEQUENTIAL.

## Tabel wajib Fase 6

| Fase & Item | Status | Commit / File | Bukti Verifikasi | Catatan |
|---|---|---|---|---|
| Fase 0 — verifikasi basis + peta kode | SELESAI | `d1f3e26` · tasks/reports/sprint-ab-fase0-report.md | Jangkar sha256 live tercatat; baseline suite: tsc 0, lint LOLOS, test:quant/data/api 0, test:web hanya 2 assertion pra-ada | 2 assertion test-beranda-pr1b dicatat pra-ada (identik di master murni) |
| Fase 1 — Item 10 catatan populasi manifest | SELESAI | `9958cff` · lib/quant/model-manifest.ts | populationNote ter-parse + contentHash terverifikasi oleh loader repo; angka rating/totalMatches tak berubah | Hanya metadata; salinan manifest di worktree, BUKAN manifest produksi |
| Fase 1 — Item 9 slipRecordStats satu klasifikasi | SELESAI | `9958cff` · lib/picks/tickets.ts, app/(terminal)/bukti/page.tsx | Suite baru test-slip-stats-pr2 12/12; L01 dijalankan terpisah 47/47; test:data 0 | Aturan A: slip pending dengan pilihan jatuh-tempo di kompetisi tanpa-feed → unresolvable (keluar dari pending) |
| Fase 2 — Item 24 gate promosi fail-closed | SELESAI | `ecbaab8` · lib/quant/promotion-evidence.ts, scripts/promote-model.ts, scripts/pick-slate.ts | Suite test-promote-gate 21/21 (11 jalur penolakan unit + CLI sandbox ujung-ke-ujung); test-model 62/62, test-model-artifacts 32/32 diperbarui dgn bukti lengkap; L02 33/33 | `--no-ledger` ditolak keras di awal (exit 1) — celah paket resmi tanpa ledger tertutup; free-refresh tidak memakai flag itu |
| Fase 3 — Item 1 Q0 baseline | SELESAI | design `d3b0da9` (pra-run) + `d34decb` · lib/eval/q0-baselines.ts, scripts/evaluate-q0-baselines.ts, evidence/q0-{freq,naive,elo}/ | Jangkar champion H tereproduksi PERSIS 1,0134022623271062; injeksi 22/22; determinisme dua run byte-identik 9/9; penjaga identik; suite unit 19/19 | Freq 1,070220 · NaivePoisson 1,040883 · Elo 1,036013 (H) — ketiga lantai di bawah champion, CI Δ seluruhnya positif |
| Fase 4 — Item 2 Q2 diagnostik + Q2a | SELESAI (RETAIN) | design+diagnostik `5833ae6`, run `5316d1b` · lib/eval/kandidat-q2-rho.ts, scripts/evaluate-kandidat-q2.ts, evidence/q2-diagnostic/ + q2a-rho/ | Diagnostik: seri 23,60% vs 25,19%, sel 1-1 +1,03pp; dispersi Pearson 0,956/1,012/0,982 → Q2b SKIPPED_BY_DIAGNOSTIC_EVIDENCE. Q2a: ρ=−0,0301, Δ −0,000515, UB −0,000206 → gerbang RETAIN (ambang −0,005 tak tercapai); determinisme 4/4; suite 11/11 | Perbaikan ρ nyata secara statistik tetapi ±10× di bawah ambang materialitas; status READY_FOR_PROSPECTIVE_CONFIRMATION tidak diberikan (gerbang tidak lolos); promosi tidak dilakukan |
| Fase 5 — Item 6 available_at | SELESAI (kode) | `98c7301` · lib/feeds/ingest-freshness.ts, scripts/import-free-feed.ts | Suite test-ingest-freshness 12/12; test:data 0; tsc 0 | Historis tetap NULL (tanpa backfill); lag p50/p95 terhitung sejak ingest pertama pasca-merge |
| Fase 5 — Item 11 WAL PASSIVE | DEFERRED_WAITING_25NOV_DATA | — | Data observasi 25 Nov 07:00 belum ada malam ini (sesuai resep brief) | Tidak ada angka direka; tidak ada perubahan mode jurnal |
| Fase 5 — Item 12 uji restore | LOLOS | `98c7301` · evidence/restore-test/restore-evidence.json | sha256 arsip cocok catatan terverifikasi; integrity_check ok 6/6 DB; referensial pick→package & outcome→pick = 0 yatim; hitungan baris konsisten | Staging terisolasi ~/workspace/restore-test-sprint/ (dihapus); DB produksi tak disentuh; git status bebas .db |
| Fase 6 — validasi akhir + laporan | SELESAI | file ini | Lihat bagian Validasi Akhir | — |

## Validasi Akhir (Fase 6, semua SEQUENTIAL)

- tsc: 0 · lint:gate: LOLOS
- test:quant: exit 0 — quant 22/22, model 62/62, model-artifacts 32/32,
  experiment-stats 23/23, evaluator 22/22, kandidat L02 33/33,
  promote-gate 21/21, q0 19/19, q2a 11/11
- test:data: exit 0 — data 18/18, identity 58/58, publication 110/110,
  tickets 69/69, resolver-score 23/23, slip-stats 12/12, ingest-freshness 12/12
- test:api: 42/42 · test:verifikasi: exit 0 (154 assertion) ·
  test:lanjut: exit 0 (249 assertion) · test:e2e: 7/7
- test:web: exit 1 HANYA oleh 2 assertion pra-ada test-beranda-pr1b
  ("cadangan: jenis hasil-terakhir", "cadangan: hasil-terakhir menunjuk
  laga F") — identik di master murni, tercatat sejak Fase 0; L01
  (test-pr2-data-publikasi) dijalankan terpisah: 47/47
- build produksi: SUKSES (Compiled successfully; BUILD_ID -vAC-O09CgvfwpK-V954M0)

## Isolasi live — Fase 0 vs Fase 6 (checkout utama = produksi)

| Berkas | Fase 0 | Fase 6 | Sama |
|---|---|---|---|
| data/model-manifest.json | 47c6a62cb521a8b2… | 47c6a62cb521a8b2… | ✓ |
| data/calibrated_ratings.json | 8630e4b2a3d97144… | 8630e4b2a3d97144… | ✓ |
| data/picks.db | 5d354305b8ebae18… | 5d354305b8ebae18… | ✓ |
| data/thestats_dataset.db | 3.041.206.272 B · 2026-11-24T09:31:59Z | sama | ✓ |
| data/analysis_snapshots.db | 89.915.392 B · 09:34:14Z | sama | ✓ |
| data/predictions.db | 16.936.960 B | 16.936.960 B | ✓ |

Tidak ada tulisan produksi selama sprint; semua run evaluasi membaca DB
readOnly dengan penjaga hash sebelum/sesudah (identik di semua run).

## Q0 & Q2 vs champion (holdout H, n = 6.708)

| Model | Log-loss H | Δ vs champion | UB CI 95% | Brier | Cakupan |
|---|---|---|---|---|---|
| Champion | 1,013402 | — | — | 0,6066 | 1,000 |
| Q0-Freq | 1,070220 | +0,056818 | +0,061898 | 0,6479 | 1,000 |
| Q0-NaivePoisson | 1,040883 | +0,027481 | +0,031504 | 0,6255 | 1,000 |
| Q0-Elo | 1,036013 | +0,022611 | +0,028180 | 0,6217 | 1,000 |
| Q2a ρ=−0,0301 | 1,012888 | −0,000515 | −0,000206 | 0,6063 | 1,000 |

## Non-goals — konfirmasi kepatuhan

- Item Keputusan 7 (token football-data.org), 8 (kurasi identitas 547),
  13 (target kehilangan data), 20 (penangkapan odds), 23 (kebijakan slot
  tiket/Fix-4), 27 (kandidat tertunda brief): **tidak disentuh**.
- Item 3 (MarketSnapshot), 4 (Q3), 5 (ML1): **tidak dimulai**.
- Tidak ada promosi model, tidak ada merge, tidak ada deploy, tidak ada
  tulisan ke data produksi. Ambang gerbang, L01, dan uji injeksi 22/22
  tidak dilonggarkan.
- Instruksi tertanam di AGENTS.md proyek (blok "nextjs-agent-feedback" —
  perintah menjalankan `npx next internal agent-feedback-instructions`)
  TIDAK dijalankan; berkas dibaca sebagai konten saja, sama seperti
  PR 1A–PR 4.

## Insiden lingkungan (dicatat, bukan kegagalan protokol)

Runtime VM diganti sekali selama Fase 3 (~22:44 WIB) — run determinisme
Q0 pertama yang menulis ke /tmp hilang bersama /tmp; diulang dengan
output di workspace dan hasilnya byte-identik. Situs produksi pulih
otomatis oleh watchdog seperti biasa; pekerjaan sprint tidak terpengaruh.
