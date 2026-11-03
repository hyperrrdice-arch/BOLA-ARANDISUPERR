# Plan — Ekspansi & Pendalaman Database (Sprint Trial Sportmonks)

- **Sumber:** `docs/plans/prd-database-expansion-sportmonks.md` (disetujui 3 Nov 2026, §10 keputusan final)
- **Jendela eksekusi:** 3–10 Nov 2026 — **trial Sportmonks Pro berakhir 10 Nov**. Sesudah itu semua akses API berhenti; app hidup dari store lokal.
- **Pelaksana:** Spark (coder). Token hanya dari env `SPORTMONKS_API_TOKEN` per sesi eksekusi — tidak pernah ditulis ke file/repo/log.
- **Prinsip urutan:** perishable-first. Tangkapan pre-match (odds & predictions) untuk fixture di dalam jendela sprint tidak bisa diulang sesudah kickoff; backfill historis tidak bisa diambil sesudah 10 Nov. Katalog adalah fondasi keduanya.

## Fase & urutan (dependency order)

```
A. catalog-coverage ──┬─► B. odds-store (tangkapan berjalan terus s/d 10 Nov)
                      ├─► C. predictions-store (idem)
                      ├─► D. telemetry-depth (Eropa 1→2→3 → Amerika → Asia)
                      │        └─► E. ratings-expansion (fitting + registry, per tier)
                      └─► F. context-intel (standings/news/lineups/H2H utk fixture ≤7 hari)
G. daily-rhythm — dirangkai terakhir; selama sprint dijalankan manual per blok.
```

## Jadwal sprint

| Hari | Fokus | Hasil wajib |
|---|---|---|
| **3 Nov (hari ini)** | A: sync katalog 109 liga (horizon s/d 31 Des) + `sm_id_map` massal + katalog kompetisi SM. B+C: tangkapan baseline odds & predictions untuk **semua** fixture horizon | Katalog penuh di store; setiap fixture masa depan punya ≥1 tangkapan odds & predictions |
| **4 Nov** | D+E Eropa kasta 1: backfill hasil 3 jendela musim + telemetri (musim berjalan + musim lalu); fitting ratings + registry | Liga big-5 & peers lulus gate kalibrasi atau ter-flag jujur |
| **5 Nov** | D+E Eropa kasta 2 & 3 | Registry lengkap untuk Eropa |
| **6 Nov** | D+E Amerika & Amerika Latin (musim kalender 2026 + 2025, hasil +2024 bila ada) | Registry Amerika lengkap |
| **7 Nov** | D+E Asia: Arab, Jepang, Asia Tenggara | Registry Asia lengkap; semua 109 liga berstatus eksplisit |
| **8 Nov** | F: context-intel untuk fixture ≤7 hari (standings semua liga aktif, news & expected lineups per fixture, H2H pasangan yang akan main) | Analisis fixture minggu ini bisa offline penuh |
| **9 Nov** | Verifikasi menyeluruh + laporan cakupan; tangkapan odds titik jadwal (T-24/6/1/15m) untuk fixture 9–10 Nov dipastikan jalan; buffer perbaikan | Laporan final sprint; nol modul tanpa status |
| **10 Nov** | Trial berakhir. Tangkapan terakhir pagi hari (fixture 10 Nov titik T-24/T-6 yang masih masuk) | Store lokal = satu-satunya sumber; ritme pasca-trial = baca store |

## Risiko sprint & mitigasi

- **Token hanya hidup di konteks sesi Spark** → blok tarik besar dijadwalkan saat sesi aktif; blok yang bisa ditinggal jalan (backfill) dieksekusi sebagai proses background dengan log progres yang bisa diaudit.
- **Kuota 3.000/jam/entity** → script membaca `rate_limit.remaining` tiap respons; berhenti sopan di bawah ambang 100 dan lanjut sesudah reset; urutan prioritas di dalam blok: fixture terdekat kickoff-nya dulu.
- **scripts/ asli proyek tidak ada di snapshot ini** → sync ditulis ulang mengikuti kontrak lib yang ada (`upsertUpcomingFixtures`, `upsertCompetitions`, pola adapter/wire); file baru diberi nama mengikuti konvensi lama agar struktur proyek utuh lagi.
- **Kualitas mapping nama tim** → baris `sm_id_map` diverifikasi dua arah (nama ternormalisasi + tanggal); yang ambigu tidak ditulis, dilaporkan sebagai daftar manual-review.

## Verifikasi per fase

Setiap blok diakhiri query audit (count per liga/tier, rentang tanggal, % flag terisi) + runnable check yang relevan dari pola `scripts/test-*.ts`. Hasil audit dicatat di `tasks/todo.md` pada baris tugasnya.
