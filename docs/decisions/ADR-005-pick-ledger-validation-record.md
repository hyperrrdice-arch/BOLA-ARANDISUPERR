# ADR-005: Ledger pick adalah catatan validasi produk

## Status
Accepted

## Date
2026-11-05 (Fase A plan safe-bet parlay; branch `safe-bet-parlay`)

## Context
Produk berubah arah dari berburu value bet menjadi **safe bet untuk
parlay**: yang dijual adalah kaki berprobabilitas kejadian tertinggi.
Klaim "aman" tanpa catatan adalah klaim kosong — grade A/B/C hanya
bermakna bila setiap pick yang pernah diterbitkan tercatat bersama
klaimnya (probabilitas model, pasar, panel SM, spread kesepakatan,
status gerbang, grade) dan kemudian dicocokkan dengan hasil asli.
Parlay lab (walk-forward) memberi basis historis grade, tetapi
perilaku konfigurasi produksi yang berjalan hanya bisa dibuktikan
dari pick live yang tercatat.

## Decision
Satu ledger persisten `data/picks.db`: tabel `picks` (satu baris per
kaki yang diterbitkan, `source` ∈ {lab, live-run}) + `pick_outcomes`
(satu baris per pick ter-resolve: skor akhir + hit 0/1, FK ke picks).
Semantik hit didefinisikan SATU kali di `lib/picks/ledger.ts`
(`evaluatePick`) dan dipakai bersama oleh lab, engine, dan resolver —
definisi pasar tidak boleh bercabang. Pick live-run merujuk paket
asalnya (`package_id`, ADR-003). Grade berasal dari tabel lab
per-pasar + cap status gerbang; agreement dicatat sejak hari pertama
meski bobotnya belum dipakai grading (belum ada basis bukti historis
— divalidasi ke depan dari ledger ini sendiri).

## Alternatives Considered
### Tanpa ledger — verdict cukup di chat/laporan
- Pros: nol infrastruktur.
- Cons: tidak ada yang bisa membuktikan grade bekerja; setiap klaim akurasi menjadi ingatan.
- Rejected: bertentangan dengan standar bukti proyek (semua klaim harus terukur).

### Memperluas tabel snapshot lama sebagai catatan pick
- Pros: satu store riwayat.
- Cons: semantik berbeda (paket analisis ≠ kaki pick); skema lama milik jalur planner dorman.
- Rejected: pemisahan fungsi (ADR-002) + digantikan keputusan ADR-003.

## Consequences
- Audit 5 Nov 2026: 163,491 pick (163,008 lab ter-resolve 100%; 483 live-run tertaut paket 483/483, belum ter-resolve karena fixture belum selesai — resolver di ritme slate menutupnya begitu hasil masuk).
- Ledger menjadi jam validasi agreement: bobot pasar/SM dalam grading hanya boleh naik pangkat bila hit-rate live di ledger membuktikannya (aturan ini mengikat fase-fase berikutnya).
- Biaya: setiap perubahan semantik pasar wajib mengubah `evaluatePick` + menjalankan ulang lab, atau populasi lama dan baru tidak bisa dibandingkan. Diterima — itu harga satu definisi.
