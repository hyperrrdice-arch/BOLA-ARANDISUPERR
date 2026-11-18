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

1. Ritme 12 jam (`scripts/free-refresh.ts`) mengimpor hasil, odds
   closing, dan fixture dari football-data.co.uk (22 divisi),
   membangun ulang registry kanonik + telemetri form, mengkalibrasi
   rating, lalu menulis slate pick ke ledger (`data/picks.db`) —
   tanpa API berbayar; jalur render tidak memanggil API sama sekali.
   Jalur Sportmonks sudah berhenti (trial berakhir 10 Nov 2026);
   panel Sportmonks kini hanya arsip pembanding.
2. Setiap liga dari semua sumber dirujuk ke satu identitas kanonik
   (`data/league-canonical.json`); fit yang melayani fixture selalu
   yang se-sumber dengannya.
3. Paket kuant dibangun offline: ratings domestik terkalibrasi
   (atau, untuk piala, parameter domestik yang ditransformasi offset
   antar-liga per benua) → probabilitas 1X2/O-U/BTTS.
4. Lapisan debat/verdict aktif adalah **Hikari** (agent owner);
   sindikat 5-LLM lama dipertahankan utuh dan dorman (file 🔒 read-only).

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

Produksi: **https://bola.mhmdarandi.biz.id** (VPS owner, port 3101).

## Keadaan saat ini (18 Nov 2026)

- Registri kanonik: 250 liga, 412/412 identitas sumber terpetakan.
- Rekalibrasi domestik selesai (basis kanonik: 28 calibrated /
  29 partial / 26 uncalibrated); model piala offset global selesai
  (17 kompetisi: 0 calibrated / 4 partial / 13 uncalibrated — status
  dari gerbang OOS, tidak dilonggarkan).
- Mode gratis penuh sejak 10 Nov 2026: free-refresh 12 jam menulis
  slate pick ke ledger live-run; app live di VPS dengan frontend v2.
- Audit jalur data Fase 0 selesai 16 Nov 2026; perbaikan R-01–R-03
  sudah masuk (segmentasi /bukti per gerbang, label gerbang per pick,
  filter fixture kembar mt_).
