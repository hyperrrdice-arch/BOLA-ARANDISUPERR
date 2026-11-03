# Mapping Review — hasil sync katalog Sportmonks (3 Nov 2026)

Audit atas `data/upcoming_fixtures.db` setelah sync katalog selesai (exit 0):
3.287 fixture SM tersimpan (horizon 2026-11-03 → 2026-12-31), 39 dilewati,
3.192 baris `sm_id_map` baru, 95 fixture terpetakan ke entri katalog lama (mt_).

## Status cakupan mapping

- Fixture `sm_*` di katalog: **3.296**; yang punya baris `sm_id_map`: **3.296 (100%)**.
  Nol baris dipaksa — fixture yang sudah terpetakan ke match lama (mt_) tidak dibuatkan
  baris ganda; jembatan `sm_fixture_id` (UNIQUE) tetap tunggal.
- `sm_id_map` total: 3.324 baris (3.201 menunjuk `sm_*`, 123 menunjuk `mt_*`).

## Butuh review manual

### 1. Liga langganan tanpa fixture di horizon (28)
Play-off / super cup / friendlies yang memang belum terjadwal di jendela Nov–Des 2026 —
bukan kegagalan mapping, tapi perlu disadari bahwa cakupan efektif = 81/109 liga:

| competition_id | Liga | Negara |
|---|---|---|
| sm:1128 | Super Cup | Belgium |
| sm:1371 | UEFA Europa League Play-offs | Belgium |
| sm:983 | Canadian Soccer League | Canada |
| sm:1659 | Superliga Play-offs | Denmark |
| sm:23 | Community Shield | England |
| sm:1328 | UEFA Super Cup | Europe |
| sm:1750 | Veikkausliiga Play-offs | Finland |
| sm:310 | Coupe de la Ligue | France |
| sm:1673 | Ligue 1 Play-offs | France |
| sm:1674 | Ligue 2 Play-offs | France |
| sm:166 | 2. Bundesliga Play-offs | Germany |
| sm:163 | Bundesliga Play-offs | Germany |
| sm:1932 | Super League - Playoffs | Greece |
| sm:1768 | J1 League Play-offs | Japan |
| sm:1353 | Eredivisie Playoffs | Netherlands |
| sm:1760 | Eliteserien Play-offs | Norway |
| sm:495 | Premier League Play-offs | Russia |
| sm:1678 | Pro League Play-offs | Saudi Arabia |
| sm:513 | Premiership Play-Offs | Scotland |
| sm:1666 | Premier League Play-offs | South Africa |
| sm:1251 | Super Cup | Spain |
| sm:1753 | Allsvenskan Play-offs | Sweden |
| sm:1681 | Super League Play-offs | Switzerland |
| sm:1691 | Premier League - Playoffs | Ukraine |
| sm:770 | Primera Division | Uruguay |
| sm:1101 | Club Friendlies 1 | World |
| sm:2450 | Club Friendlies 2 | World |
| sm:2452 | Club Friendlies 4 | World |

Catatan: `sm:770` Primera Division Uruguay satu-satunya liga reguler di daftar ini —
musimnya di luar jendela sync; akan muncul sendiri saat horizon bergeser.

### 2. Nama kompetisi sama, competition_id berbeda (risiko join berbasis nama)
Di ruang SM nama bersifat kanonis per liga, tapi nama yang sama dipakai liga berbeda
negara. Join apa pun WAJIB memakai `competition_id`, bukan nama:

- "Premier League" ×6 (England sm:8, Egypt sm:830, Ukraine sm:609, + play-offs Russia/South Africa/Ukraine)
- "Serie A" ×3 (Italy sm:384, Brazil sm:648, + legacy)
- "Super League" ×3 (Greece sm:325, Switzerland, + play-offs)
- "Pro League" ×2 (Belgium sm:208, Saudi Arabia sm:944)
- "Bundesliga" ×2 (Germany sm:82, Austria), "Eredivisie" ×2, "Ligue 1" ×2, "Serie B" ×2, "Superliga" ×2

### 3. Duplikasi nama warisan TheStats (di luar ruang SM, pre-existing)
Katalog lama masih memuat "LaLiga" (56) vs "La Liga" (13) dan "UEFA Champions League"
(54) vs "Champions League" (7) sebagai competition yang berbeda di ruang mt_.
Tidak diubah oleh sprint ini (aturan: baris legacy tidak ditimpa); resolusinya lewat
`sm_id_map` — fixture mt_ yang punya kembaran SM terbaca lewat jembatan itu.
