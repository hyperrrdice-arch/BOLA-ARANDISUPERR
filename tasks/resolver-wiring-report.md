# Resolver Wiring — Catatan Hasil (/bukti) Hidup Lagi

Tanggal: 2026-11-16 · Branch: master · Jenis: perbaikan rantai (script) + backfill ledger

## 1 · Diagnosis (diverifikasi ulang sesi ini)

- `data/picks.db`: `pick_outcomes` = 164.000 baris, MAX(resolved_utc) =
  **2026-11-07T14:17:00Z**. Live-run: 5.020 pick, hanya 992 ter-resolve;
  **3.959 pick live-run berkickoff lampau belum dinilai.**
- `scripts/resolve-pick-outcomes.ts` sehat — dialah yang menghasilkan batch
  7 Nov. Cron pick-slate lama memanggilnya; cron itu dihapus saat penutupan
  trial (10 Nov). `scripts/free-refresh.ts` (rantai berjalan, termasuk di
  VPS) **tidak pernah memanggilnya**: pick ditulis slate, outcome tak pernah
  dinilai. Hasil laga 8–15 Nov selama ini dicek manual dari skor luar.

## 2 · Audit sumber skor resolver di era bebas

Resolver membaca skor dari `data/thestats_dataset.db.matches` — store yang
SAMA dengan tujuan importer football-data (baris `fd_`: 1.174 finished,
terbaru 2026-11-09T19:30Z). Jadi jalur exact match_id tetap bekerja untuk
pick era fd.

Celah yang ditemukan: pick ber-id `sm_` yang hasil fisiknya tiba sebagai
baris `fd_` tidak terjangkau — satu-satunya jembatan lama adalah
`sm_id_map` (arah mt_→sm_). Uji kasus nyata: pick Burgos vs Celta
(`sm_19744999`) — baris sm_-nya tidak ada di store hasil, tetapi kembar
fd_-nya (`fd_SP2_20261107_burgos-cf_celta-b`) finished 2-1.

**Perbaikan** (`scripts/resolve-pick-outcomes.ts`): jalur 3 baru — jembatan
kembar katalog `data/fixture-links.json` (twin_id ↔ canonical_id, dua arah)
→ skor finished milik id kembar. Jalur lama tidak diubah; tetap fail-closed
(tidak ketemu = unresolved, skor tidak pernah ditebak).

## 3 · Wiring ke free-refresh

`scripts/free-refresh.ts`: langkah 8 baru `resolve-pick-outcomes`, jalan
**terakhir** — sesudah impor hasil (langkah 1) dan slate (langkah 7) — supaya
hasil yang baru tiba langsung menilai pick yang menunggu. Kegagalannya
terlihat seperti langkah lain: baris ringkasan `[free-refresh]
resolve-pick-outcomes: exit=…` + rantai berhenti dengan exit non-nol.
Header rantai diperbarui (termasuk catatan regresi 7–16 Nov).

VPS menjalankan rantai free-refresh yang sama (cron `football-free-refresh`),
jadi langkah ini ikut berjalan di sana pada run berikutnya. Tidak ada deploy
apa pun dari tugas ini.

## 4 · Backfill (dijalankan sesi ini)

Importer disegarkan dulu (idempoten: 0 hasil baru — lihat §5), lalu resolver:

- examined 4.028 (3.959 lampau + 69 kickoff masa depan), **resolved 297**
  (254 exact + 43 jembatan kembar + 0 via sm_id_map).
- Kasus uji Burgos–Celta: 6 pick ter-resolve dengan skor 2-1 dari kembar fd_.
- Run kedua: resolved 0 → idempoten terverifikasi.
- Total outcome: 164.000 → **164.297**; live-run ter-resolve: 992 → **1.289**.

### Hit-rate batch baru (kickoff 7 Nov 12:00 – 9 Nov 19:30)

| Grade | n | Hit | Hit-rate |
|---|---|---|---|
| A | 127 | 116 | **91,3%** |
| B | 118 | 91 | **77,1%** |
| C | 52 | 34 | **65,4%** |

Per pasar (batch baru): dc 81,8% (88) · ou15 86,0% (43) ·
team_over05_home 80,5% (41) · team_over05_away 86,5% (37) · ou35 80,0% (35) ·
ou25 68,2% (22) · btts 70,0% (20) · 1x2 90,9% (11).

### Kumulatif live-run sampai hari ini (yang dirender /bukti)

| Grade | Ter-resolve | Hit-rate aktual | Klaim efektif | Selisih |
|---|---|---|---|---|
| A | 350 | 81,1% | 81,1% | +0,1pp |
| B | 698 | 76,6% | 73,5% | +3,1pp |
| C | 241 | 61,0% | 63,5% | −2,5pp |

## 5 · Yang masih unresolved: 3.662 pick lampau

- **1.558 di liga ter-cover fd** (22 divisi): hasilnya belum diterbitkan
  situs ke CSV — impor segar hari ini memasukkan 0 hasil baru; CSV musim
  berjalan masih berhenti di ronde 7–9 Nov. Ini **menyembuh sendiri** pada
  refresh berikutnya sekarang resolver sudah ter-wire (publikasi situs
  biasanya Selasa/Jumat).
- **2.104 di kompetisi tanpa sumber hasil gratis**: FA Cup 182, Serie B 119,
  Liga BetPlay 115, MLS 111, Women's Super League 100, Liga Portugal 2 85,
  Eerste Divisie 85, Pro League (Saudi) 66, dst. — bukan divisi
  football-data.co.uk, jadi tidak ada skor lokal di era bebas. Tetap
  unresolved (tidak ditebak), sama seperti baris hasil individual yang hilang
  (mis. EPL `sm_19722107`, 7 Nov — tidak ada baris hasil di bawah id mana pun).

## 6 · Verifikasi permukaan app (/bukti)

Jalur data halaman: `app/(terminal)/bukti/page.tsx` →
`lib/web/data.ts::ledgerStats()` membaca `data/picks.db` langsung. Fungsi
yang sama persis dijalankan sesi ini (bukan query tiruan):

- `live_resolved` = **1.289** (sebelum perbaikan: 992).
- `by_grade` terbarui sesuai tabel kumulatif di §4.
- `recent_resolved` kini memuat laga era fd 9 Nov (mis. Sabadell vs
  Sociedad B 0-0) — outcome baru mengalir ke render halaman.
- Tidak perlu perubahan kode app.

## 7 · Kepatuhan & commit

- `tsc --noEmit` = 0.
- File 🔒 tidak disentuh — edit hanya `scripts/resolve-pick-outcomes.ts` +
  `scripts/free-refresh.ts`. Blok `nextjs-agent-feedback` di AGENTS.md proyek
  dibaca sebagai konten file, **tidak dijalankan**. `.env.local` tidak dibuka.
- `data/*.db` tidak ter-track git (ter-ignore — konvensi repo), jadi backfill
  hidup di DB runtime, bukan di commit; commit memuat perubahan script +
  laporan ini + `tasks/free-import-unmatched.json` (regenerasi timestamp oleh
  run impor sesi ini, isi tetap 0 unmatched).
