# PR 1B — Bukti pengukuran (staging)

Lingkungan: worktree `app-football-pr1b`, instance terpisah port 3199,
data = salinan konsisten produksi via sqlite `.backup` (analysis_snapshots
8.981 paket, picks 172.375 baris, dataset 3,0 GB). Produksi 3101 tidak
disentuh. Semua angka adalah ukuran STAGING pada VM bersama (host IO
berisik) — pola & rasio yang dibandingkan, bukan janji produksi.

## Profil per pembaca (tasks/pr1b/profile-readers.ts, 7 repetisi, median hangat)

| Pembaca | Sebelum (master) | Sesudah |
|---|---|---|
| listUpcoming(72) | 50,5 ms (dingin 236,6) | 29,7 ms (dingin 80,3) |
| sorotanBeranda | 44,0 ms | 26,8 ms |
| jadwalBerikutnya | 37,2 ms | 31,1 ms |
| berandaSorotanDanJadwal (baru; menggantikan sorotan+jadwal = 81,2 ms) | — | 29,0–31,4 ms |
| ambilRekam (default) | 1.066,7 ms (dingin 7.574,3) | tetap untuk /bukti: 1.031,3 ms |
| ambilRingkasanRekam (baru) | — | 60,8 ms |
| Total 3 pembaca lama Beranda | 1.061,1 ms | — |
| Total 2 pembaca baru Beranda | — | ±92 ms (−91%) |

Komposisi ambilRingkasanRekam (tasks/pr1b/diag-ringkasan.ts): cohortStats
±34 ms (termasuk cek tanda-tangan keadaan), kueri pending sempit ±10–13 ms,
kueri settled bentuk EXISTS ±13 ms. Bentuk LEFT JOIN polos untuk kueri
settled terukur 195 ms — perencana SQLite menggerakkannya dari
idx_pick_outcomes_agg atas semua seri (±160 rb baris) sebelum filter cohort.

## HTTP (curl, dokumen penuh; Beranda 1 dingin + 24 hangat, kontrol 1 + 10)

| Rute | Dingin sebelum | p50 sebelum | p95 sebelum | Dingin sesudah | p50 sesudah | p95 sesudah | Byte sebelum → sesudah |
|---|---|---|---|---|---|---|---|
| `/` | 10,95 dtk | 1,072 | 1,147 | 1,76 | 0,117 | 0,134 | 48.505 → 48.505 |
| `/pertandingan` (kontrol) | 0,457 | 0,052 | 0,066 | 2,10* | 0,053 | 0,080 | 199.228 → 199.228 |
| `/pertandingan/sm_19867091` (kontrol) | 0,563 | 0,040 | 0,056 | 0,239 | 0,036 | 0,044 | 117.632 → 117.632 |

Target brief: p95 Beranda turun ≥30% → tercapai −88,3% (1,147 → 0,134 dtk).
Byte dokumen identik di ketiga rute — sinyal parity render yang kuat.
*Dingin kontrol Jadwal pada run final terkena beban IO host (log [timing]
server: 2.082 ms untuk request dingin itu); angka hangat adalah metrik
kontrak. p95 hangat Jadwal pada dua run sesudah: 0,062 dan 0,080 — pita
noise baseline (0,066); tidak ada kode jalur Jadwal yang diubah.

## Query plan packages (jendela mendatang staging)

Sebelum:
```
|--CO-ROUTINE t
|  `--SCAN packages USING COVERING INDEX idx_packages_match
|--SCAN t
|--SEARCH p USING INTEGER PRIMARY KEY (rowid=?)
`--USE TEMP B-TREE FOR ORDER BY
```
Sesudah:
```
|--SEARCH p USING INDEX idx_packages_kickoff (kickoff_utc>? AND kickoff_utc<?)
`--CORRELATED SCALAR SUBQUERY 1
   `--SEARCH q USING COVERING INDEX idx_packages_match (match_id=?)
```
Indeks baru: TIDAK dibuat — idx_packages_kickoff yang ada sudah cukup.

Perbandingan SQL penuh jendela mendatang [2026-11-23T23:00Z, 2026-11-27T02:00Z]:
129 baris, urutan IDENTIK (termasuk 17 grup kickoff seri).
Jendela selesai: himpunan baris identik, urutan di dalam kickoff seri
BERBEDA (59 grup seri) → query fallback LIMIT (sesudah-jendela +
listFinished) sengaja dipertahankan dalam bentuk lama (lihat laporan).
