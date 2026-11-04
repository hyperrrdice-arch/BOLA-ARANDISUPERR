# ADR-004: Predictions Sportmonks terisolasi dari jalur odds

## Status
Accepted

## Date
2026-11-03 (keputusan PRD ekspansi DB #6; aturan ditegakkan di semua fase sesudahnya)

## Context
Sportmonks menyediakan probabilitas siap pakai (predictions) yang
menarik untuk dipakai sebagai jalan pintas angka. Tetapi produk ini
menjual kejujuran angka: probabilitas yang disajikan harus berasal
dari model kuant sendiri dan dibandingkan terhadap **odds pasar
nyata**. Bila predictions menyusup ke jalur odds (mis. diperlakukan
sebagai tangkapan pasar atau anchor), perbandingan model-vs-pasar
menjadi sirkular dan benchmark closing line kehilangan makna.
Pengukuran sprint juga menunjukkan endpoint premium SM bisa kosong
meski tercatat entitled — angka provider tidak boleh menjadi
ketergantungan diam-diam.

## Decision
Predictions hidup di store sendiri (`predictions.db`: sm_predictions,
sm_value_bets, sm_predictability) dan **tidak pernah** masuk
`match_odds_history` atau jalur odds kuant dalam bentuk apa pun.
Satu-satunya peran sahnya: panel pembanding **berlabel** di view dan
di paket analisis (sumber ketiga agreement: model × pasar × SM),
dengan cap batch tangkapannya selalu tampil.

## Alternatives Considered
### Predictions sebagai anchor pasar cadangan saat odds kosong
- Pros: cakupan fixture ber-"pasar" naik.
- Cons: menghancurkan independensi perbandingan; fixture tanpa odds nyata akan tampak punya harga pasar padahal tidak.
- Rejected: melanggar aturan kejujuran produk (yang absen = null jujur).

### Predictions sebagai fitur model kuant
- Pros: mungkin menambah akurasi.
- Cons: model berhenti menjadi sumber angka yang mandiri; seluruh validasi OOS/closing menjadi tak bisa dibaca.
- Rejected untuk jalur utama; perannya sebagai pembanding sudah memberi nilai tanpa kontaminasi.

## Consequences
- Isolasi bisa dicek mekanis (INV-14): predictions.db tidak punya tabel odds; source di match_odds_history hanya {NULL legacy, 'sportmonks'}; audit 5 Nov 2026: PASS, dan baris predictions yang tertangkap setelah kickoff pun tidak pernah dipakai sebagai bukti historis agreement (tercatat di laporan Fase A).
- Saat Sportmonks mati (trial berakhir 10 Nov 2026), panel berhenti di arsip (fixture s/d 2 Des 2026) dan agreement menyusut jujur menjadi dua sumber — tanpa perubahan jalur odds.
- Value bets versi SM sendiri (80 baris) tetap data panel: boleh ditampilkan berlabel, tidak boleh masuk evaluasi harga.
