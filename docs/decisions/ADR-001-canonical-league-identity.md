# ADR-001: Identitas liga kanonik tunggal (`league-canonical.json`)

## Status
Accepted

## Date
2026-11-04

## Context
Identitas liga tiba dari empat konvensi berbeda: Sportmonks
`sm:<leagueId>`, TheStats `comp_*`, kode div legacy (E0/SP1/…), dan
kunci rating (`SM<leagueId>`). Resolusi berbasis nama terbukti salah
secara terukur: katalog memuat 88 id kompetisi vs 73 nama, dan
"Premier League" saja adalah 6 id dari 5 negara. Akibatnya fixture
Sportmonks di liga bernama-sama-legacy dilayani fit LEGACY lewat
resolusi nama (identitas `sm:<id>` hilang di batas intel) — 803
fixture (21,3%) berubah fit pelayan setelah perbaikan. Owner menolak
tambalan prioritas dan memerintahkan akar masalahnya dibereskan:
satu struktur kanonik.

## Decision
Satu registry kanonik `data/league-canonical.json`: setiap liga dunia
nyata = satu `canonical_id` (mengadopsi id sistem dominannya —
`sm:<leagueId>` untuk liga ber-Sportmonks, `comp_*` untuk liga yang
hanya ada di TheStats), dan setiap identitas sumber lain dicatat
sebagai alias {system, id, name_as_stored}. Resolusi runtime
(`lib/quant/league-identity.ts`): id sumber → kanonik → fit yang
**se-sumber** dengan fixture-nya. Nama polos yang ambigu tidak
pernah di-resolve diam-diam — hasilnya null yang keras (fail-closed).

## Alternatives Considered
### Prioritas sumber saat nama bertabrakan (tambalan routing)
- Pros: perubahan kecil, cepat.
- Cons: akar masalah (identitas hilang di batas) tetap; tabrakan berikutnya mengulang bug yang sama.
- Rejected: owner secara eksplisit menolak tambalan.

### Kolom mapping per store (peta alias tersebar di loader)
- Pros: tanpa artefak baru.
- Cons: empat salinan kebenaran yang bisa drift — penyakit yang sama dalam bentuk baru.
- Rejected: melanggar prinsip satu sumber kebenaran.

## Consequences
- 250 liga kanonik, 412/412 identitas sumber terpetakan (audit 5 Nov 2026: 412 pasangan alias unik, 0 duplikat lintas liga; seluruh 88 competition_id katalog ter-resolve).
- Registry adalah artefak tergenerasi (`scripts/build-league-canonical.ts`) — tidak pernah edit tangan; field piala ditanam produsennya sendiri (ADR terkait model offset).
- Biaya jujur yang tercatat: roster fit Sportmonks lebih kecil dari legacy menurunkan both-teams-found sesaat (2,889 → 2,871), kemudian pulih lewat alias nama tim di kalibrasi (→ 2,954).
- Identitas TIM tidak ikut diselesaikan keputusan ini — lihat proposal registry tim kanonik di `tasks/db-audit-report.md` (P-05).
