# Registry Kanonik Tim — Laporan Build

Dibangun: 2026-11-21T14:11:37.925Z

## Angka

- Baris tim sumber (tabel teams): **6815**
- Tim kanonik hasil: **6541**
- Grup tergabung (>1 baris sumber): **261** (menyerap 279 baris ekstra)
- Grup lintas sistem (>1 sumber): **245**
- Tim bernama sengketa (≥2 negara): **2** entri
- Pasangan kandidat mirip BELUM digabung: **9**
- Keputusan resolusi fase 3 diterapkan: **85 penggabungan terbukti**, **1 pemisahan terbukti**, **11 pasangan terbukti klub BERBEDA** (dicatat distinct_from, tidak akan digabung), **34 alias eksternal**.
- Permukaan standings: **167 id** tanpa baris teams didaftarkan dari nama fixture; **0 id** terdaftar id-only (name_unknown: -). Cakupan standings sekarang penuh.
- Permukaan fixture: **107 id** tim katalog tanpa baris teams didaftarkan dari bukti fixture (nama + id-nya sendiri).

## Keputusan resolusi fase 3 (bukti terukur + web untuk identitas ambigu)

- GABUNG `fd_andorra` + `238115` — Satu klub: FC Andorra (Spanyol); baris fd cangkang nama pendek CSV.
- GABUNG `fd_bayer-leverkusen` + `tm_20832` — Satu klub: Bayer 04 Leverkusen; fd nama pendek CSV, tm pembawa data (145 match).
- GABUNG `fd_cambuur` + `tm_10474` — Satu klub: SC Cambuur (Belanda); fd nama pendek CSV.
- GABUNG `fd_groningen` + `tm_26302` — Satu klub: FC Groningen (Belanda); fd nama pendek CSV.
- GABUNG `fd_heerenveen` + `tm_04732` — Satu klub: SC Heerenveen (Belanda); fd nama pendek CSV.
- GABUNG `fd_sv-darmstadt-98` + `482` — Satu klub: Darmstadt 98 (Jerman); fd nama pendek CSV.
- GABUNG `fd_telstar` + `tm_91047` — Satu klub: SC Telstar (Belanda); fd nama pendek CSV.
- GABUNG `fd_tsg-1899-hoffenheim` + `tm_73909` — Satu klub: TSG Hoffenheim (Jerman); fd nama pendek CSV.
- GABUNG `254165` + `605` — PECAHAN ENTITAS SM, bukan klub lain: id 254165 (nama tersimpan 'CF Benfica') membawa match Eropa SL Benfica (UCL 26, UEL 9) + sebagian domestik; id 605 membawa domestik (Liga Portugal 68). Digabung ke 605, nama pakem 'SL Benfica'. BUKAN Clube Futebol Benfica.
- GABUNG `tm_master_sl_benfica` + `605` — Nama persis 'SL Benfica'; sisa master 2 match, digabung ke pembawa utama 605.
- GABUNG `17837` + `9908` — Satu klub: Al-Ahli Saudi. Kedua id main di kompetisi yang sama (Saudi Pro sm:944 + ACL Elite sm:1085); 17837 cuma pecahan berlabel negara 'Asia'.
- GABUNG `230422` + `7780` — Cangkang 1 match tanpa telemetri, nama 'Al-Ain' = Al Ain (UEA, id 7780 pembawa 77 match). Label negara 'Saudi Arabia' di cangkang itu keliru konteks.
- GABUNG `10655` + `tm_02219` — Thun = FC Thun (Swiss); imbuhan FC saja.
- GABUNG `132649` + `tm_7937035` — Ararat-Armenia = FC Ararat-Armenia (Armenia); imbuhan FC saja.
- GABUNG `1433` + `tm_10419` — Almere City = Almere City FC (Belanda); imbuhan FC saja.
- GABUNG `1668` + `tm_6686` — Bodø/Glimt — beda ejaan garis miring saja (SM 'Bodø / Glimt').
- GABUNG `2727` + `tm_89295` — Sparta Praha = AC Sparta Praha (Ceko); imbuhan AC saja.
- GABUNG `353` + `tm_64315` — St. Pauli = FC St. Pauli (Jerman); imbuhan FC saja.
- GABUNG `3546` + `tm_8366658` — Riga = Riga FC (Latvia); imbuhan FC saja.
- GABUNG `496` + `tm_master_st_mirren` — St. Mirren = St Mirren (Skotlandia); beda titik saja.
- GABUNG `52` + `tm_1772` — AFC Bournemouth = Bournemouth; bentuk pendek TheStats.
- GABUNG `591` + `tm_01119` — Paris Saint-Germain — beda tanda hubung saja.
- GABUNG `734` + `tm_master_st_johnstone` — St. Johnstone = St Johnstone (Skotlandia); beda titik saja.
- GABUNG `83` + `tm_37445` — FC Barcelona = Barcelona; imbuhan FC saja.
- GABUNG `3608` + `8364` — Racing Club: baris sintetis standings (Copa Sudamericana sm:1116) = id 8364 'Racing' yang membawa 237 match di sm:636/sm:770/sm:1116 — Racing Club de Avellaneda.
- GABUNG `4508` + `tm_11910` — 'Paris' (id 4508) di fixture + standings Ligue 1 = Paris FC — PSG entitasnya terpisah di SM (id 591) dan ikut Ligue 1 yang sama, jadi 'Paris' bukan PSG.
- GABUNG `fd_goztep` + `3897` — Nama CSV football-data 'Goztep' adalah Göztepe yang terpotek diakritiknya (Turki, id SM 3897 'Göztepe') — ketahuan dari baris form 31 Okt: lawan Fenerbahçe tercatat dua kali karena dua id ini tidak tergabung.
- GABUNG `fd_celta-b` + `384` — Satu tim cadangan: 'Celta B' berganti nama resmi jadi 'Celta Fortuna' sejak 2023-24 (terverifikasi web: Wikipedia/rccelta.es). fd memakai nama CSV lama, SM nama kini. Bukti data: fixture kembar La Liga 2 — Albacete vs keduanya 2026-11-16T19:30Z dan Burgos vs keduanya 2026-11-07T13:00Z. Tim utama Celta Vigo (sm:36) entitas BERBEDA, tidak digabung.
- GABUNG `fd_sociedad-b` + `9656` — Satu tim cadangan: Real Sociedad B (Sanse). fd memakai nama CSV pendek 'Sociedad B', SM memakai 'Real Sociedad II'. Bukti data: fixture kembar La Liga 2 — Sabadell vs keduanya 2026-11-09T19:30Z dan vs Sporting Gijón 2026-11-14T15:15Z, kickoff identik. Tim utama Real Sociedad (sm:594) dan Real Sociedad III (sm:28124) entitas BERBEDA, tidak digabung.
- GABUNG `44` + `tm_25550` — Satu klub: Olympique de Marseille. SM 'Olympique Marseille' vs TheStats 'Olympique de Marseille' — kata 'de' membuat nama ternormalisasi beda. Bukti fixture kembar Ligue 1: vs Le Mans 2026-11-22T19:45Z, vs Toulouse 2026-11-01T19:45Z, vs Nice 2026-11-08T19:45Z (kickoff + lawan identik di kedua sumber).
- GABUNG `562` + `602` — Satu klub: Olympiacos Piraeus. SM sendiri terbelah: id 562 'Olympiakos' (label World) hanya membawa 3 laga persahabatan (vs Banga, Omonia 29M, APOEL — profil laga uji Olympiacos), id 602 'Olympiacos F.C.' membawa domestik Yunani (73) + Eropa; anggota tm_47798 'Olympiacos FC' sudah di 562. Pola pecahan SM yang sama dengan SL Benfica (254165/605). Kanonik dipaksa ke 602 (pembawa utama) lewat CANONICAL_ID_OVERRIDES.
- GABUNG `fd_accrington` + `395` — Satu klub: Accrington Stanley; fd nama pendek CSV. Fixture kembar League Two vs Port Vale 2026-11-14T15:00Z.
- GABUNG `fd_amedspor` + `3570` — Satu klub: Amed SK (Amedspor); fd nama CSV. Fixture kembar Super Lig vs Galatasaray 2026-11-07T16:00Z.
- GABUNG `fd_bielefeld` + `2927` — Satu klub: DSC Arminia Bielefeld; fd nama pendek CSV. Fixture kembar 2. Bundesliga vs Holstein Kiel 2026-11-07T12:00Z.
- GABUNG `fd_birmingham` + `12` — Satu klub: Birmingham City; fd nama pendek CSV. Fixture kembar Championship vs Swansea 2026-11-07 + vs Millwall 2026-11-03.
- GABUNG `fd_bolton` + `16` — Satu klub: Bolton Wanderers; fd nama pendek CSV. Fixture kembar vs Derby County 2026-11-06T20:00Z.
- GABUNG `fd_borussia-monchengladbach` + `683` — Satu klub: Borussia Mönchengladbach; fd ejaan tanpa diakritik. Fixture kembar Bundesliga vs Hamburger SV 2026-11-06T19:30Z.
- GABUNG `fd_bristol-rvs` + `230` — Satu klub: Bristol Rovers; fd singkatan CSV 'Rvs'. Fixture kembar League Two vs Chesterfield 2026-11-14T15:00Z.
- GABUNG `fd_burton` + `150` — Satu klub: Burton Albion; fd nama pendek CSV. Fixture kembar League One vs MK Dons 2026-11-14T15:00Z.
- GABUNG `fd_buyuksehyr` + `3702` — Satu klub: İstanbul Başakşehir; fd nama CSV 'Buyuksehyr' (Büyükşehir). Fixture kembar Super Lig vs Göztepe 2026-11-07T16:00Z.
- GABUNG `fd_charlton` + `4` — Satu klub: Charlton Athletic; fd nama pendek CSV. Fixture kembar Championship vs Sheffield United 2026-11-07T15:00Z.
- GABUNG `fd_colchester` + `74` — Satu klub: Colchester United; fd nama pendek CSV. Fixture kembar League Two vs Gillingham 2026-11-14T15:00Z.
- GABUNG `fd_corum` + `13871` — Satu klub: Çorum FK; fd nama tanpa diakritik. Fixture kembar Super Lig vs Fenerbahçe 2026-11-08T13:00Z.
- GABUNG `fd_cottbus` + `3322` — Satu klub: Energie Cottbus; fd nama pendek CSV. Fixture kembar 2. Bundesliga vs Eintracht Braunschweig 2026-11-06T17:30Z.
- GABUNG `fd_crewe` + `87` — Satu klub: Crewe Alexandra; fd nama pendek CSV. Fixture kembar League Two vs Newport County 2026-11-14T15:00Z.
- GABUNG `fd_den-haag` + `1128` — Satu klub: ADO Den Haag; fd nama pendek CSV. Fixture kembar Eredivisie vs Sparta Rotterdam 2026-11-07T17:45Z.
- GABUNG `fd_dresden` + `1077` — Satu klub: Dynamo Dresden; fd nama pendek CSV. Fixture kembar 2. Bundesliga vs Greuther Fürth 2026-11-06T17:30Z.
- GABUNG `fd_erzurumspor` + `13818` — Satu klub: Erzurumspor FK; fd tanpa imbuhan FK. Fixture kembar Super Lig vs Rizespor 2026-11-08T10:30Z.
- GABUNG `fd_estrela` + `12152` — Satu klub: Estrela Amadora; fd nama pendek CSV. Fixture kembar Liga Portugal vs SL Benfica 2026-11-08T20:30Z.
- GABUNG `fd_for-sittard` + `1459` — Satu klub: Fortuna Sittard; fd nama CSV terpotong 'For Sittard'. Fixture kembar Eredivisie vs Telstar 2026-11-07T15:30Z.
- GABUNG `fd_guimaraes` + `830` — Satu klub: Vitória Guimarães; fd nama pendek CSV. Fixture kembar Liga Portugal vs FC Porto 2026-11-08T18:00Z.
- GABUNG `fd_harrogate` + `382` — Satu klub: Harrogate Town; fd nama pendek CSV. Fixture kembar National League vs Altrincham 2026-11-14T15:00Z.
- GABUNG `fd_hartlepool` + `310` — Satu klub: Hartlepool United; fd nama pendek CSV. Fixture kembar National League vs Wealdstone 2026-11-14T15:00Z.
- GABUNG `fd_hornchurch` + `1151` — Satu klub: AFC Hornchurch; fd nama pendek CSV. Fixture kembar National League vs Tamworth 2026-11-14T15:00Z.
- GABUNG `fd_iraklis` + `7171` — Satu klub: Iraklis 1908 FC; fd nama pendek CSV. Fixture kembar Super League Yunani vs Panathinaikos 2026-11-08T15:30Z.
- GABUNG `fd_kortrijk` + `1130` — Satu klub: KV Kortrijk; fd nama pendek CSV. Fixture kembar Pro League vs KV Mechelen 2026-11-04 + vs Gent 2026-11-08.
- GABUNG `fd_lincoln` + `305` — Satu klub: Lincoln City; fd nama pendek CSV. Fixture kembar Championship vs QPR 2026-11-07 + vs Watford 2026-11-03.
- GABUNG `fd_mansfield` + `225` — Satu klub: Mansfield Town; fd nama pendek CSV 'Mansfield' di divisi E2 (League One, 13 match dataset). BUKAN AFC Mansfield (sm:20249, klub non-liga berbeda) — pasangan itu TIDAK digabung.
- GABUNG `fd_nijmegen` + `494` — Satu klub: NEC Nijmegen; fd nama pendek CSV. Fixture kembar Eredivisie vs FC Utrecht 2026-11-08T19:00Z.
- GABUNG `fd_padova` + `249160` — Satu klub: Calcio Padova; fd nama pendek CSV. Fixture kembar Serie B vs Empoli 2026-11-07T14:00Z.
- GABUNG `fd_panetolikos` + `213` — Satu klub: Panaitolikos; fd ejaan 'Panetolikos'. Fixture kembar Super League Yunani vs Aris 2026-11-07T17:30Z.
- GABUNG `fd_scunthorpe` + `101` — Satu klub: Scunthorpe United; fd nama pendek CSV. Fixture kembar National League vs Worthing 2026-11-14T15:00Z.
- GABUNG `fd_sp-braga` + `884` — Satu klub: Sporting Braga; fd singkatan CSV 'Sp Braga'. Fixture kembar Liga Portugal vs Rio Ave 2026-11-08T20:30Z.
- GABUNG `fd_stockport` + `249` — Satu klub: Stockport County; fd nama pendek CSV. Fixture kembar League One vs Reading 2026-11-14T15:00Z.
- GABUNG `fd_tranmere` + `201` — Satu klub: Tranmere Rovers; fd nama pendek CSV. Fixture kembar League Two vs Fleetwood Town 2026-11-14T17:30Z.
- GABUNG `fd_vfl-bochum` + `999` — Satu klub: VfL Bochum 1848; fd tanpa tahun. Fixture kembar 2. Bundesliga vs Karlsruher SC 2026-11-08T12:30Z.
- GABUNG `fd_yeovil` + `261` — Satu klub: Yeovil Town; fd nama pendek CSV. Fixture kembar National League vs Boreham Wood 2026-11-14T15:00Z.
- GABUNG `fd_york` + `92` — Satu klub: York City; fd nama pendek CSV. Fixture kembar League Two vs Rochdale 2026-11-14T15:00Z.
- GABUNG `fd_zwolle` + `1016` — Satu klub: PEC Zwolle; fd nama pendek CSV. Fixture kembar Eredivisie vs Willem II 2026-11-06T19:00Z.
- GABUNG `tm_master_charleroi` + `1087` — Satu klub: Sporting Charleroi; TheStats master nama pendek 'Charleroi'. Fixture kembar Pro League vs Westerlo 2026-11-07T15:00Z.
- GABUNG `tm_master_ofi_crete` + `118` — Satu klub: OFI Crete; SM menyimpan 'OFI' saja. Fixture kembar Super League Yunani vs Atromitos 2026-11-08T16:30Z.
- GABUNG `tm_8557956` + `138649` — Satu klub: Sabah FK (Azerbaijan); SM menyimpan 'Sabah'. Fixture kembar UEFA Champions League 2026-11-25T17:45Z.
- GABUNG `tm_master_oud_heverlee_leuven` + `1947` — Satu klub: OH Leuven = Oud-Heverlee Leuven. Fixture kembar Pro League vs Mechelen 2026-11-07T17:15Z.
- GABUNG `tm_64842` + `216` — Satu klub: SK Slavia Praha; SM tanpa imbuhan SK. Fixture kembar UCL 2026-11-04 + 2026-11-25.
- GABUNG `tm_02198` + `2417` — Satu klub: ŠK Slovan Bratislava; SM tanpa imbuhan SK. Fixture kembar UCL 2026-11-03 + 2026-11-24.
- GABUNG `tm_89026` + `3588` — Satu klub: SV Elversberg; TheStats 'SV 07 Elversberg'. Fixture kembar Bundesliga 2026-11-07 + 21 + 28.
- GABUNG `tm_98394` + `429` — Satu klub: Deportivo La Coruña = Deportivo A Coruña (SM). Fixture kembar LaLiga 2026-11-02 + 2026-11-07. Alias CSV 'La Coruna' yang sudah dijangkar ke tm_98394 ikut pindah.
- GABUNG `tm_64398` + `794` — Satu klub: 1. FSV Mainz 05; SM tanpa awalan '1.'. Fixture kembar Bundesliga 2026-11-07 + 22 + 28.
- GABUNG `tm_64681` + `7980` — Satu klub: Atlético Madrid = Atlético de Madrid (SM). Fixture kembar LaLiga/UCL 2026-10-31 + 11-03 + 11-08.
- GABUNG `tm_master_levadeiakos` + `990` — Satu klub: Levadiakos; TheStats ejaan 'Levadeiakos'. Fixture kembar Super League Yunani vs AEK Athens 2026-11-08T15:00Z.
- GABUNG `tm_master_raal_la_louviere` + `6722` — Satu klub: RAAL La Louvière; SM menyimpan 'La Louviere'. Fixture kembar Pro League vs Cercle Brugge 2026-11-07T19:45Z.
- GABUNG `tm_26373` + `669` — Satu klub: Willem II (Tilburg); TheStats menambahkan kota. 'II' di sini nama raja (Willem II), BUKAN tim cadangan. Fixture kembar Eredivisie 2026-11-06 + 22 + 27.
- GABUNG `tm_76152` + `2673` — Satu klub: FK Crvena zvezda (Red Star Belgrade). Fixture CERMIN dataset: baris TheStats comp_3498 vs tm_05877 (21+29 Jul 2026) dan tm_93670 (4+11 Agu 2026) identik tanggal+lawan dengan baris SM sm:2 milik id 2673.
- GABUNG `tm_08322` + `321` — Satu klub: Viking FK (Stavanger); SM menyimpan 'Viking'. Fixture CERMIN dataset: vs tm_97303 18+26 Agu, tm_37258 9 Sep, tm_98299 13 Okt 2026 — identik dengan baris sm:2 milik id 321 (lawan 674 = tm_97303 yang sama).
- GABUNG `tm_25152` + `3357` — Satu klub: SK Sturm Graz; SM tanpa imbuhan SK. Fixture CERMIN dataset: vs tm_91646 5 Agu 2026 identik di comp_3498 dan sm:2 (id 3357).
- GABUNG `tm_42581` + `3877` — Satu klub: FK Borac Banja Luka; SM tanpa imbuhan FK. Fixture CERMIN dataset: vs tm_52213 7+14 Jul 2026 identik di comp_3498 dan sm:2 (id 3877).
- GABUNG `tm_2905815` + `928` — Satu klub: FK Kauno Žalgiris; SM tanpa imbuhan FK. Fixture CERMIN dataset: vs tm_4649576 (7+14 Jul), tm_05888 (21+29 Jul), tm_97303 (4+11 Agu) 2026 — tanggal+lawan identik dengan baris sm:2 milik id 928.
- GABUNG `fd_gaziantep` + `4192` — Satu klub: Gaziantep FK (Turki). fd memakai nama CSV pendek 'Gaziantep', SM menyimpan 'Gaziantep F.K.'. Bukti fixture kembar Süper Lig: vs Gençlerbirliği (sm:286 di kedua baris) 2026-11-21T10:30Z dan vs Kasımpaşa 2026-11-06T17:00Z — kickoff + lawan identik di kedua sumber; peluang terbit kejadian yang sama identik (0,7612).
- GABUNG `tm_master_kasimpasa` + `1071` — Satu klub: Kasımpaşa (Turki). TheStats master memakai ejaan tanpa diakritik 'Kasimpasa', SM menyimpan 'Kasımpaşa'. Bukti fixture kembar Süper Lig 2026-11-06T17:00Z: baris fd_ membawa tm_master_kasimpasa sebagai tim tamu, baris sm_ membawa 1071 — kickoff identik, tim kandangnya klub yang sama (Gaziantep, lihat pasangan di atas).
- BEDA `10002` + `2837` — River Plate Argentina vs River Plate Uruguay — dua klub berbeda (negara + volume data masing-masing besar).
- BEDA `132434` + `94617` — Ourense CF vs UD Ourense — dua klub berbeda dari kota yang sama (UD bubar 2014, Ourense CF klub terpisah).
- BEDA `2079` + `28207` — San Fernando CD (Cádiz, Andalusia) vs UD San Fernando (Maspalomas, Canarias) — klub berbeda.
- BEDA `26423` + `28245` — Coria CF = Coria del Río, Andalusia (berdiri 1923) vs CD Coria = Coria, Cáceres, Extremadura (berdiri 1960) — terverifikasi web (Wikipedia kedua klub).
- BEDA `277303` + `278222` — Celoricense (entitas Campeonato de Portugal) vs SC Celoricense = Sporting Clube Celoricense, Celorico da Beira (berdiri 1948, liga distrik Guarda) — terverifikasi web (soccerzz/playmakerstats).
- BEDA `10016` + `238136` — Melilla vs Melilla CD — bukti belum cukup dan keduanya cangkang nyaris kosong (3+1 match, 0 log); dibiarkan terpisah sampai ada bukti.
- BEDA `4701` + `82` — 'VfL Bremen' (id 4701, 1 match) BUKAN Werder Bremen (id 82, pembawa 106 match) — kandidat ini artefak kunci longgar, bukan kemiripan klub.
- BEDA `18544` + `84` — Qatar (tim NASIONAL, id 18544) vs Qatar SC (klub) — entitas berbeda kategori.
- BEDA `13` + `15064` — Everton FC (Inggris, Premier League) vs Everton de Viña del Mar (Chile, Primera División) — dua klub berbeda yang dulu TERGABUNG KELIRU dalam satu entri kanonik karena nama tersimpan sama persis ('Everton') dan keduanya tanpa baris teams/negara. Dipisah lewat SPLIT_DECISIONS (gelombang 5); bukti: kompetisi katalog disjoint total (Premier League/Carabao Cup vs Primera División Chile).
- BEDA `374` + `2488` — Bohemians Dublin (Irlandia) vs Bohemians 1905 Praha (Ceko) — nama mirip, klub berbeda negara. Bukti dataset: 20 match id 374 semuanya melawan klub Irlandia (St Patrick's, Cork City, Shelbourne, Waterford, Drogheda, Longford, Athlone); id 2488 membawa Chance Liga Ceko (78 match).
- BEDA `fd_mansfield` + `20249` — Football-data 'Mansfield' (League One/Two Inggris) adalah Mansfield Town (sm:225), BUKAN AFC Mansfield (sm:20249, klub non-liga dari kota yang sama, berdiri 2012).
- PISAH `15064` → `sm:15064` — Everton de Viña del Mar (Chile) dipisah dari Everton FC (Inggris): kompetisi katalog disjoint total — id 15064 hanya Primera División Chile, id 13 hanya Premier League + Carabao Cup Inggris (audit redesain langkah 2, 2026-11-21).

## Contoh grup lintas sistem

- `sm:1` West Ham United (?): thestats:tm_3809="West Ham United" · sportmonks:1="West Ham United"
- `sm:10068` Lincoln Red Imps (?): thestats:tm_0181115="Lincoln Red Imps" · sportmonks:10068="Lincoln Red Imps"
- `sm:101` Scunthorpe United (England): football-data:fd_scunthorpe="Scunthorpe" · sportmonks:101="Scunthorpe United"
- `sm:1016` PEC Zwolle (Netherlands): football-data:fd_zwolle="Zwolle" · thestats:tm_26389="PEC Zwolle" · sportmonks:1016="PEC Zwolle"
- `sm:102` Genoa CFC (?): thestats:tm_51322="Genoa" · sportmonks:102="Genoa"
- `sm:1028` Stade de Reims (France): thestats:tm_master_stade_de_reims="Stade de Reims" · sportmonks:1028="Reims"
- `sm:1053` SC Heerenveen (Netherlands): football-data:fd_heerenveen="Heerenveen" · thestats:tm_04732="SC Heerenveen" · sportmonks:1053="SC Heerenveen"
- `sm:1055` Le Havre AC (?): thestats:tm_97714="Le Havre" · sportmonks:1055="Le Havre"
- `sm:106` Getafe CF (?): thestats:tm_73740="Getafe" · sportmonks:106="Getafe"
- `sm:10655` Thun (?): sportmonks:10655="Thun" · thestats:tm_02219="FC Thun"
- `sm:1071` Kasımpasa (Turkey): thestats:tm_master_kasimpasa="Kasimpasa" · sportmonks:1071="Kasımpaşa"
- `sm:1072` Pisa SC (?): thestats:tm_37240="Pisa" · sportmonks:1072="Pisa"
- `sm:10722` US Cremonese (?): thestats:tm_20131="Cremonese" · sportmonks:10722="Cremonese"
- `sm:1073` De Graafschap (?): thestats:tm_79130="De Graafschap" · sportmonks:1073="De Graafschap"
- `sm:1077` Dynamo Dresden (Germany): football-data:fd_dresden="Dresden" · sportmonks:1077="Dynamo Dresden"

## Kandidat mirip (keputusan fase resolusi)

- kunci "river plate": `sm:10002` River Plate  vs  `sm:2837` River Plate
- kunci "melilla": `sm:10016` Melilla  vs  `sm:238136` Melilla CD
- kunci "everton": `sm:13` Everton  vs  `sm:15064` Everton
- kunci "ourense": `sm:132434` Ourense CF  vs  `sm:94617` UD Ourense
- kunci "qatar": `sm:18544` Qatar  vs  `sm:84` Qatar SC
- kunci "san fernando": `sm:2079` San Fernando CD  vs  `sm:28207` UD San Fernando
- kunci "coria": `sm:26423` Coria CF  vs  `sm:28245` CD Coria
- kunci "celoricense": `sm:277303` Celoricense  vs  `sm:278222` SC Celoricense
- kunci "werder bremen": `sm:4701` Werder Bremen  vs  `sm:82` SV Werder Bremen
