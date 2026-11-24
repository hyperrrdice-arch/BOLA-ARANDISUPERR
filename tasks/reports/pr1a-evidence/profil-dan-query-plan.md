# Bukti PR 1A — hitung ulang K5, query plan, profil Beranda (staging)

Semua angka di file ini dihasilkan skrip di `tasks/pr1a/` pada 2026-11-24
(pagi WIB) dari checkout `e648404` + salinan konsisten DB produksi
(sqlite `.backup`, mode read-only untuk query langsung).

## Hitung ulang K5 (`node tasks/pr1a/k5-recompute.mjs`)

Sumber: `tasks/experiments/k5-kappa/predictions-h.jsonl` (6.708 baris =
6.708 laga unik, 33 pekan unik; outcome = indeks H/D/A dari `hs`/`as`;
tanpa clamp — 0 probabilitas ≤ 0).

| Permukaan | κ-fit | Log-loss hitung ulang | Brier | Klaim brief | Cocok |
|---|---|---|---|---|---|
| Level B | 10 (champion) | **1,0134022623271062** | 0,6065786004794814 | 1,013402 | persis |
| Level B | 20 (challenger) | **1,014223498439091** | 0,6071375472222502 | 1,014223 | persis |
| Level A | 10 | 1,0227400451927073 | 0,6124985586617931 | (summary.json 1,0227) | persis |
| Level A | 20 | 1,0224675701767554 | 0,6127650787693035 | (summary.json 1,0225) | persis |

Diagnostik seri (brief hal. 6): rerata prediksi seri Level B κ10 =
**23,597%** vs frekuensi seri aktual **25,194%** (selisih 1,59 pp —
persis klaim brief 23,60% vs 25,19%).

## Query plan — pola latest-per-match Beranda (analysis_snapshots.db produksi, ro)

Query berjalan (`lib/web/data.ts` `LATEST_PER_MATCH`, dipakai
`listUpcomingPada`):

```sql
SELECT p.* FROM packages p
JOIN (SELECT match_id, MAX(id) AS mid FROM packages GROUP BY match_id) t
  ON t.mid = p.id
WHERE p.kickoff_utc >= ? AND p.kickoff_utc <= ? ORDER BY p.kickoff_utc ASC
```

```
|--CO-ROUTINE t
|  `--SCAN packages USING COVERING INDEX idx_packages_match   <- grup atas SELURUH 8.981 paket
|--SCAN t
|--SEARCH p USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR ORDER BY
```

Bentuk usulan brief hal. 8 (filter jendela kickoff lebih dulu):

```
|--SEARCH p USING INDEX idx_packages_kickoff (kickoff_utc>? AND kickoff_utc<?)
`--CORRELATED SCALAR SUBQUERY 1
   `--SEARCH q USING COVERING INDEX idx_packages_match (match_id=?)
```

Hasil kedua bentuk identik pada jendela uji 24–27 Nov 2026:
**127 baris, 1.173.692 byte payload_json**. Seluruh tabel packages:
8.981 baris, 79.510.519 byte payload (rerata 8.853 byte/paket — payload
memuat `score_matrix` penuh).

## Profil Beranda — staging (worktree audit1a, port 3199, salinan DB produksi)

TTFB/total via curl, 25 request ke `/` (1 dingin + 24 hangat), semua 200,
dokumen 48.505 byte:

| Ukuran | Dingin (pertama) | Hangat p50 | Hangat p95 | Hangat maks |
|---|---|---|---|---|
| TTFB (shell statis) | 0,052 dtk | 0,004 dtk | 0,007 dtk | 0,008 dtk |
| Total dokumen | **6,849 dtk** | **1,073 dtk** | **1,205 dtk** | 1,221 dtk |

Log server staging: `[timing] route=/ status=200 dur_ms=6733` untuk
request dingin; ringkasan event-loop 30 dtk: `mean_ms=42.2 max_ms=6761.2`
— render dingin memblokir event loop ±6,8 dtk. RSS server staging saat
diukur ±147.520 kB.

Pecahan per pembaca (`npx tsx tasks/pr1a/profile-readers.ts`, 5 repetisi,
median hangat):

| Pembaca | Dingin | Median hangat | Hasil |
|---|---|---|---|
| `listUpcoming(72)` | 217,8 ms | 39,5 ms | 129 laga (decode ±1,17 MB payload) |
| `sorotanBeranda(now)` | 33,2 ms | 45,3 ms | memanggil `listUpcomingPada` sendiri |
| `jadwalBerikutnya(sorotan, now)` | 36,6 ms | 60,4 ms | memanggil `listUpcomingPada` KEDUA kalinya |
| `ambilRekam(parseFilterRekam({}))` | 1.385,5 ms | **1.024,9 ms** | agregat Rekam hasil penuh |
| Total 3 pembaca Beranda | 1.016,9 ms | **1.051,0 ms** | ≈97% dari `ambilRekam` |

Kesimpulan profil: biaya Beranda didominasi agregat Rekam hasil
(`ambilRekam` membaca riwayat picks + outcome + nama dari paket untuk
ringkasan), bukan dua pembaca 72 jam (±100 ms gabungan). Keduanya tetap
duplikasi nyata: `listUpcomingPada` dieksekusi dua kali per render
(sorotan + jadwal) dengan decode payload yang sama.
