# PR 2 — Bukti ukur pada salinan produksi

Salinan: `.backup` read-only dari DB produksi VM (picks.db, analysis_snapshots.db,
thestats_dataset.db) + `league-canonical.json` produksi, dibuat 2026-11-24 ±15:50 WIB,
disimpan di luar repo di `~/workspace/coding/pr2-staging-data/` (integrity_check ok;
live-run = 9.367 baris, cocok dengan hitungan langsung produksi). Jam beku probe:
2026-11-24T08:45:00Z. Probe: `tasks/pr2/probe-ukur.ts` (kode master untuk
`before.json`, kode PR 2 untuk `after.json`).

## Settlement (filter baku /bukti, seri live-run)

| Ukuran | Sebelum | Sesudah |
|---|---:|---:|
| Terbit (issued) | 9.367 | 9.367 |
| Dinilai (settled) | 3.021 | 3.021 |
| Jatuh tempo dinilai (due) | 8.519 | **4.763** |
| Cakupan | 35,5% | **63,4%** |
| Jatuh tempo masih pending (bisa dinilai) | 5.498 | **1.742** |
| Tidak dapat dinilai (terminal, tanpa feed) | — (menyatu di pending) | **3.756** |
| Belum mulai / menunggu jendela / batal | 840 / 8 / 0 | 840 / 8 / 0 |

Rekonsiliasi sesudah: 9.367 = 3.021 + 0 + 840 + 8 + 1.742 + 3.756 ✓.
Alasan jatuh tempo sesudah: `unspecified` 1.742 (kompetisi berfeed — lag publikasi
sumber, skornya akan masuk) + `tanpa_feed` 3.756. Antrean konflik identitas (547)
tidak beririsan dengan populasi jatuh tempo (0 baris) — preseden alasan konflik
tetap dijaga di kode + suite.
Tab /bukti: menunggu 6.346 → 2.590; ember baru `tak_dinilai` = 3.756 baris.

## Basis akurasi (ledgerStats per kelas → cohortStats prob_slice)

| Kelas | claimed sebelum (basis model, semua settled) | claimed sesudah (basis terbit, irisan resmi) | prob_n | gap sebelum | gap sesudah |
|---|---|---|---:|---:|---:|
| A | 0,8193 | **0,8127** | 217 | +0,4pp | **−2,0pp** |
| B | 0,7280 | **0,7205** | 212 | +1,5pp | +1,5pp |
| C | 0,6374 | **0,6237** | 103 | −2,8pp | **−7,0pp** |

`claimed` sesudah sama persis (selisih < 1e-12) dengan `avg_published_prob`
prob_slice cohortStats per kelas, dan gap sesudah sama dengan
`avg_hit − avg_published_prob` irisan yang sama (A 0,7926; B 0,7358; C 0,5534) —
persis angka basis-terbit PR 1A F3. Populasi hit_rate keseluruhan tidak berubah
(A 890/1.081; B 993/1.336; C 368/604).
