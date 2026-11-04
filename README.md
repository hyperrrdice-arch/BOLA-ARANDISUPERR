# Football Pre-Match Analyst — Safe-Bet Parlay Finder

App analisis sepak bola **pre-match** yang bertujuan satu hal:
**menemukan safe bet buat parlay** — outcome dengan probabilitas
kejadian tertinggi untuk dijadikan kaki parlay. App ini **bukan**
alat melawan pasar dan **bukan** pemburu value bet tunggal: pick
diperingkat dari probabilitas model + kesepakatan lintas sumber
(model × pasar × panel Sportmonks) sebagai sinyal keamanan; EV/Kelly
hanya catatan sekunder, tidak pernah jadi gerbang keputusan.

**Aturan emas:** semua angka datang dari code kuantitatif
deterministik di `lib/quant/*` (Dixon-Coles, shrinkage, gerbang
kalibrasi). LLM tidak pernah menghitung atau mengarang angka — hanya
menyusun debat dan verdict di atas paket kuant.

## Cara kerja sekilas

1. Ritme harian (`scripts/daily-refresh.ts`) menarik katalog, odds
   (titik T-24j/T-6j/T-1j/T-15m), predictions, dan telemetri
   Sportmonks ke store lokal SQLite — jalur render tidak memanggil
   API sama sekali.
2. Setiap liga dari semua sumber dirujuk ke satu identitas kanonik
   (`data/league-canonical.json`); fit yang melayani fixture selalu
   yang se-sumber dengannya.
3. Paket kuant dibangun offline: ratings domestik terkalibrasi
   (atau, untuk piala, parameter domestik yang ditransformasi offset
   antar-liga per benua) → probabilitas 1X2/O-U/BTTS.
4. Lapisan debat/verdict aktif adalah **Spark**; sindikat 5-LLM lama
   dipertahankan utuh dan dorman (file 🔒 read-only).

## Dokumen

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — arsitektur lengkap: lapisan
  data, identitas kanonik, model domestik + gerbang kalibrasi, model
  piala offset global, pipeline analisis, ritme harian.
- [`STRUCTURE.md`](STRUCTURE.md) — peta repo teranotasi: pohon file,
  skrip per peran, artefak tergenerasi, zona read-only.

## Menjalankan

```bash
npm run dev   # dashboard di http://localhost:3101
```

## Keadaan backend saat ini (4–5 Nov 2026)

- Registri kanonik: 250 liga, 412/412 identitas sumber terpetakan.
- Rekalibrasi domestik selesai (basis kanonik: 28 calibrated /
  29 partial / 26 uncalibrated); model piala offset global selesai
  (17 kompetisi: 0 calibrated / 4 partial / 13 uncalibrated — status
  dari gerbang OOS, tidak dilonggarkan).
- Ritme harian berjalan via cron selama trial Sportmonks (s/d
  10 Nov 2026). Berikutnya: fase frontend; deploy ke VPS owner
  paling akhir.
