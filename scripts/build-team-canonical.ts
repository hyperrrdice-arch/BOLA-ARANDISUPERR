/**
 * BUILD TEAM CANONICAL — membangun acuan pakem identitas tim
 * (data/team-canonical.json), pasangan dari data/league-canonical.json.
 *
 * Perintah owner 2026-11-05: beresin KESELURUHAN database jadi satu acuan
 * pakem permanen — satu identitas resmi per tim; semua baris dari sumber
 * mana pun ngacunya ke situ; sumber masa depan wajib lewat acuan ini.
 *
 * Prinsip penggabungan (KONSERVATIF — gabung hanya bukti kuat):
 *   - Nama ternormalisasi sama (normalizeTeamName proyek, termasuk kamus
 *     alias) DAN negara tidak bertentangan → satu tim kanonik.
 *   - Nama yang muncul di ≥2 negara berbeda = nama sengketa: baris tanpa
 *     negara TIDAK ikut digabung (ditandai, diputuskan di fase resolusi).
 *   - TANPA gabung fuzzy/jarak-edit di sini. Pasangan mirip dicatat sebagai
 *     KANDIDAT di laporan (tasks/team-canonical-report.md) untuk diputuskan
 *     di fase resolusi — nama benar diputuskan dari bukti (web bila perlu).
 *
 * Id kanonik: anggota Sportmonks menang (`sm:<angka>`); selain itu id
 * sumber tertua yang ada (tm_* lalu fd_*). Nama kanonik: nama tersimpan
 * anggota SM, dinormalisasi lewat kamus alias proyek; fallback nama
 * tersimpan terbanyak.
 *
 * Pakai: npx tsx scripts/build-team-canonical.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { normalizeTeamName, sanitizeString } from "../lib/quant/team-normalizer";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data/team-canonical.json");
const REPORT = path.join(ROOT, "tasks/team-canonical-report.md");

type System = "sportmonks" | "thestats" | "football-data" | "other";
interface Member { system: System; team_id: string; name_as_stored: string }
interface CanonTeam {
  canonical_id: string;
  name: string;
  country: string | null;
  members: Member[];
  aliases: string[];
  contested_name: boolean;
  resolution_notes?: string[];
  distinct_from?: { canonical_id: string; reason: string }[];
  name_unknown?: boolean;
}

/**
 * KEPUTUSAN RESOLUSI FASE 3 (2026-11-05) — diputuskan dari bukti terukur
 * (volume matches/logs/fixtures per id + kompetisi yang dimainkan) dan,
 * untuk identitas klub yang ambigu, web search. Bukan tebak-tebakan:
 * setiap pasangan membawa alasannya. Berlaku sebagai data di builder ini
 * supaya registry bisa dibangun ulang kapan pun dengan hasil sama.
 */
const MERGE_PAIRS: [string, string, string][] = [
  ["fd_andorra", "238115", "Satu klub: FC Andorra (Spanyol); baris fd cangkang nama pendek CSV."],
  ["fd_bayer-leverkusen", "tm_20832", "Satu klub: Bayer 04 Leverkusen; fd nama pendek CSV, tm pembawa data (145 match)."],
  ["fd_cambuur", "tm_10474", "Satu klub: SC Cambuur (Belanda); fd nama pendek CSV."],
  ["fd_groningen", "tm_26302", "Satu klub: FC Groningen (Belanda); fd nama pendek CSV."],
  ["fd_heerenveen", "tm_04732", "Satu klub: SC Heerenveen (Belanda); fd nama pendek CSV."],
  ["fd_sv-darmstadt-98", "482", "Satu klub: Darmstadt 98 (Jerman); fd nama pendek CSV."],
  ["fd_telstar", "tm_91047", "Satu klub: SC Telstar (Belanda); fd nama pendek CSV."],
  ["fd_tsg-1899-hoffenheim", "tm_73909", "Satu klub: TSG Hoffenheim (Jerman); fd nama pendek CSV."],
  ["254165", "605", "PECAHAN ENTITAS SM, bukan klub lain: id 254165 (nama tersimpan 'CF Benfica') membawa match Eropa SL Benfica (UCL 26, UEL 9) + sebagian domestik; id 605 membawa domestik (Liga Portugal 68). Digabung ke 605, nama pakem 'SL Benfica'. BUKAN Clube Futebol Benfica."],
  ["tm_master_sl_benfica", "605", "Nama persis 'SL Benfica'; sisa master 2 match, digabung ke pembawa utama 605."],
  ["17837", "9908", "Satu klub: Al-Ahli Saudi. Kedua id main di kompetisi yang sama (Saudi Pro sm:944 + ACL Elite sm:1085); 17837 cuma pecahan berlabel negara 'Asia'."],
  ["230422", "7780", "Cangkang 1 match tanpa telemetri, nama 'Al-Ain' = Al Ain (UEA, id 7780 pembawa 77 match). Label negara 'Saudi Arabia' di cangkang itu keliru konteks."],
  // Gelombang 3b: pasangan SM <-> TheStats nama sama, beda imbuhan saja
  // (FC/AC/AFC/huruf miring) — klub khas yang tidak mungkin tertukar,
  // negara sama, muncul dari permukaan standings/fixture.
  ["10655", "tm_02219", "Thun = FC Thun (Swiss); imbuhan FC saja."],
  ["132649", "tm_7937035", "Ararat-Armenia = FC Ararat-Armenia (Armenia); imbuhan FC saja."],
  ["1433", "tm_10419", "Almere City = Almere City FC (Belanda); imbuhan FC saja."],
  ["1668", "tm_6686", "Bodø/Glimt — beda ejaan garis miring saja (SM 'Bodø / Glimt')."],
  ["2727", "tm_89295", "Sparta Praha = AC Sparta Praha (Ceko); imbuhan AC saja."],
  ["353", "tm_64315", "St. Pauli = FC St. Pauli (Jerman); imbuhan FC saja."],
  ["3546", "tm_8366658", "Riga = Riga FC (Latvia); imbuhan FC saja."],
  ["496", "tm_master_st_mirren", "St. Mirren = St Mirren (Skotlandia); beda titik saja."],
  ["52", "tm_1772", "AFC Bournemouth = Bournemouth; bentuk pendek TheStats."],
  ["591", "tm_01119", "Paris Saint-Germain — beda tanda hubung saja."],
  ["734", "tm_master_st_johnstone", "St. Johnstone = St Johnstone (Skotlandia); beda titik saja."],
  ["83", "tm_37445", "FC Barcelona = Barcelona; imbuhan FC saja."],
  ["3608", "8364", "Racing Club: baris sintetis standings (Copa Sudamericana sm:1116) = id 8364 'Racing' yang membawa 237 match di sm:636/sm:770/sm:1116 — Racing Club de Avellaneda."],
  ["4508", "tm_11910", "'Paris' (id 4508) di fixture + standings Ligue 1 = Paris FC — PSG entitasnya terpisah di SM (id 591) dan ikut Ligue 1 yang sama, jadi 'Paris' bukan PSG."],
  ["fd_goztep", "3897", "Nama CSV football-data 'Goztep' adalah Göztepe yang terpotek diakritiknya (Turki, id SM 3897 'Göztepe') — ketahuan dari baris form 31 Okt: lawan Fenerbahçe tercatat dua kali karena dua id ini tidak tergabung."],
  // Gelombang 4 (2026-11-16): tim cadangan yang tampil dengan dua nama —
  // nama lama/pendek di CSV football-data vs nama resmi kini di Sportmonks.
  // Bukti penentu = fixture kembar: kompetisi + kickoff + lawan identik.
  ["fd_celta-b", "384", "Satu tim cadangan: 'Celta B' berganti nama resmi jadi 'Celta Fortuna' sejak 2023-24 (terverifikasi web: Wikipedia/rccelta.es). fd memakai nama CSV lama, SM nama kini. Bukti data: fixture kembar La Liga 2 — Albacete vs keduanya 2026-11-16T19:30Z dan Burgos vs keduanya 2026-11-07T13:00Z. Tim utama Celta Vigo (sm:36) entitas BERBEDA, tidak digabung."],
  ["fd_sociedad-b", "9656", "Satu tim cadangan: Real Sociedad B (Sanse). fd memakai nama CSV pendek 'Sociedad B', SM memakai 'Real Sociedad II'. Bukti data: fixture kembar La Liga 2 — Sabadell vs keduanya 2026-11-09T19:30Z dan vs Sporting Gijón 2026-11-14T15:15Z, kickoff identik. Tim utama Real Sociedad (sm:594) dan Real Sociedad III (sm:28124) entitas BERBEDA, tidak digabung."],
  // Gelombang 5 (2026-11-21, audit redesain langkah 2): klub terbelah
  // lintas namespace yang LOLOS dari gelombang sebelumnya karena nama
  // ternormalisasi beda ejaan/bahasa. Bukti penentu per pasangan =
  // fixture kembar: dua baris katalog/dataset beda sumber untuk laga
  // fisik yang sama (kickoff identik + lawan kanonik sama + kompetisi
  // sama), atau fixture cermin dataset (baris sm:2 vs comp_3498 dengan
  // tanggal + lawan identik). Bukan kemiripan nama semata.
  ["44", "tm_25550", "Satu klub: Olympique de Marseille. SM 'Olympique Marseille' vs TheStats 'Olympique de Marseille' — kata 'de' membuat nama ternormalisasi beda. Bukti fixture kembar Ligue 1: vs Le Mans 2026-11-22T19:45Z, vs Toulouse 2026-11-01T19:45Z, vs Nice 2026-11-08T19:45Z (kickoff + lawan identik di kedua sumber)."],
  ["562", "602", "Satu klub: Olympiacos Piraeus. SM sendiri terbelah: id 562 'Olympiakos' (label World) hanya membawa 3 laga persahabatan (vs Banga, Omonia 29M, APOEL — profil laga uji Olympiacos), id 602 'Olympiacos F.C.' membawa domestik Yunani (73) + Eropa; anggota tm_47798 'Olympiacos FC' sudah di 562. Pola pecahan SM yang sama dengan SL Benfica (254165/605). Kanonik dipaksa ke 602 (pembawa utama) lewat CANONICAL_ID_OVERRIDES."],
  ["fd_accrington", "395", "Satu klub: Accrington Stanley; fd nama pendek CSV. Fixture kembar League Two vs Port Vale 2026-11-14T15:00Z."],
  ["fd_amedspor", "3570", "Satu klub: Amed SK (Amedspor); fd nama CSV. Fixture kembar Super Lig vs Galatasaray 2026-11-07T16:00Z."],
  ["fd_bielefeld", "2927", "Satu klub: DSC Arminia Bielefeld; fd nama pendek CSV. Fixture kembar 2. Bundesliga vs Holstein Kiel 2026-11-07T12:00Z."],
  ["fd_birmingham", "12", "Satu klub: Birmingham City; fd nama pendek CSV. Fixture kembar Championship vs Swansea 2026-11-07 + vs Millwall 2026-11-03."],
  ["fd_bolton", "16", "Satu klub: Bolton Wanderers; fd nama pendek CSV. Fixture kembar vs Derby County 2026-11-06T20:00Z."],
  ["fd_borussia-monchengladbach", "683", "Satu klub: Borussia Mönchengladbach; fd ejaan tanpa diakritik. Fixture kembar Bundesliga vs Hamburger SV 2026-11-06T19:30Z."],
  ["fd_bristol-rvs", "230", "Satu klub: Bristol Rovers; fd singkatan CSV 'Rvs'. Fixture kembar League Two vs Chesterfield 2026-11-14T15:00Z."],
  ["fd_burton", "150", "Satu klub: Burton Albion; fd nama pendek CSV. Fixture kembar League One vs MK Dons 2026-11-14T15:00Z."],
  ["fd_buyuksehyr", "3702", "Satu klub: İstanbul Başakşehir; fd nama CSV 'Buyuksehyr' (Büyükşehir). Fixture kembar Super Lig vs Göztepe 2026-11-07T16:00Z."],
  ["fd_charlton", "4", "Satu klub: Charlton Athletic; fd nama pendek CSV. Fixture kembar Championship vs Sheffield United 2026-11-07T15:00Z."],
  ["fd_colchester", "74", "Satu klub: Colchester United; fd nama pendek CSV. Fixture kembar League Two vs Gillingham 2026-11-14T15:00Z."],
  ["fd_corum", "13871", "Satu klub: Çorum FK; fd nama tanpa diakritik. Fixture kembar Super Lig vs Fenerbahçe 2026-11-08T13:00Z."],
  ["fd_cottbus", "3322", "Satu klub: Energie Cottbus; fd nama pendek CSV. Fixture kembar 2. Bundesliga vs Eintracht Braunschweig 2026-11-06T17:30Z."],
  ["fd_crewe", "87", "Satu klub: Crewe Alexandra; fd nama pendek CSV. Fixture kembar League Two vs Newport County 2026-11-14T15:00Z."],
  ["fd_den-haag", "1128", "Satu klub: ADO Den Haag; fd nama pendek CSV. Fixture kembar Eredivisie vs Sparta Rotterdam 2026-11-07T17:45Z."],
  ["fd_dresden", "1077", "Satu klub: Dynamo Dresden; fd nama pendek CSV. Fixture kembar 2. Bundesliga vs Greuther Fürth 2026-11-06T17:30Z."],
  ["fd_erzurumspor", "13818", "Satu klub: Erzurumspor FK; fd tanpa imbuhan FK. Fixture kembar Super Lig vs Rizespor 2026-11-08T10:30Z."],
  ["fd_estrela", "12152", "Satu klub: Estrela Amadora; fd nama pendek CSV. Fixture kembar Liga Portugal vs SL Benfica 2026-11-08T20:30Z."],
  ["fd_for-sittard", "1459", "Satu klub: Fortuna Sittard; fd nama CSV terpotong 'For Sittard'. Fixture kembar Eredivisie vs Telstar 2026-11-07T15:30Z."],
  ["fd_guimaraes", "830", "Satu klub: Vitória Guimarães; fd nama pendek CSV. Fixture kembar Liga Portugal vs FC Porto 2026-11-08T18:00Z."],
  ["fd_harrogate", "382", "Satu klub: Harrogate Town; fd nama pendek CSV. Fixture kembar National League vs Altrincham 2026-11-14T15:00Z."],
  ["fd_hartlepool", "310", "Satu klub: Hartlepool United; fd nama pendek CSV. Fixture kembar National League vs Wealdstone 2026-11-14T15:00Z."],
  ["fd_hornchurch", "1151", "Satu klub: AFC Hornchurch; fd nama pendek CSV. Fixture kembar National League vs Tamworth 2026-11-14T15:00Z."],
  ["fd_iraklis", "7171", "Satu klub: Iraklis 1908 FC; fd nama pendek CSV. Fixture kembar Super League Yunani vs Panathinaikos 2026-11-08T15:30Z."],
  ["fd_kortrijk", "1130", "Satu klub: KV Kortrijk; fd nama pendek CSV. Fixture kembar Pro League vs KV Mechelen 2026-11-04 + vs Gent 2026-11-08."],
  ["fd_lincoln", "305", "Satu klub: Lincoln City; fd nama pendek CSV. Fixture kembar Championship vs QPR 2026-11-07 + vs Watford 2026-11-03."],
  ["fd_mansfield", "225", "Satu klub: Mansfield Town; fd nama pendek CSV 'Mansfield' di divisi E2 (League One, 13 match dataset). BUKAN AFC Mansfield (sm:20249, klub non-liga berbeda) — pasangan itu TIDAK digabung."],
  ["fd_nijmegen", "494", "Satu klub: NEC Nijmegen; fd nama pendek CSV. Fixture kembar Eredivisie vs FC Utrecht 2026-11-08T19:00Z."],
  ["fd_padova", "249160", "Satu klub: Calcio Padova; fd nama pendek CSV. Fixture kembar Serie B vs Empoli 2026-11-07T14:00Z."],
  ["fd_panetolikos", "213", "Satu klub: Panaitolikos; fd ejaan 'Panetolikos'. Fixture kembar Super League Yunani vs Aris 2026-11-07T17:30Z."],
  ["fd_scunthorpe", "101", "Satu klub: Scunthorpe United; fd nama pendek CSV. Fixture kembar National League vs Worthing 2026-11-14T15:00Z."],
  ["fd_sp-braga", "884", "Satu klub: Sporting Braga; fd singkatan CSV 'Sp Braga'. Fixture kembar Liga Portugal vs Rio Ave 2026-11-08T20:30Z."],
  ["fd_stockport", "249", "Satu klub: Stockport County; fd nama pendek CSV. Fixture kembar League One vs Reading 2026-11-14T15:00Z."],
  ["fd_tranmere", "201", "Satu klub: Tranmere Rovers; fd nama pendek CSV. Fixture kembar League Two vs Fleetwood Town 2026-11-14T17:30Z."],
  ["fd_vfl-bochum", "999", "Satu klub: VfL Bochum 1848; fd tanpa tahun. Fixture kembar 2. Bundesliga vs Karlsruher SC 2026-11-08T12:30Z."],
  ["fd_yeovil", "261", "Satu klub: Yeovil Town; fd nama pendek CSV. Fixture kembar National League vs Boreham Wood 2026-11-14T15:00Z."],
  ["fd_york", "92", "Satu klub: York City; fd nama pendek CSV. Fixture kembar League Two vs Rochdale 2026-11-14T15:00Z."],
  ["fd_zwolle", "1016", "Satu klub: PEC Zwolle; fd nama pendek CSV. Fixture kembar Eredivisie vs Willem II 2026-11-06T19:00Z."],
  ["tm_master_charleroi", "1087", "Satu klub: Sporting Charleroi; TheStats master nama pendek 'Charleroi'. Fixture kembar Pro League vs Westerlo 2026-11-07T15:00Z."],
  ["tm_master_ofi_crete", "118", "Satu klub: OFI Crete; SM menyimpan 'OFI' saja. Fixture kembar Super League Yunani vs Atromitos 2026-11-08T16:30Z."],
  ["tm_8557956", "138649", "Satu klub: Sabah FK (Azerbaijan); SM menyimpan 'Sabah'. Fixture kembar UEFA Champions League 2026-11-25T17:45Z."],
  ["tm_master_oud_heverlee_leuven", "1947", "Satu klub: OH Leuven = Oud-Heverlee Leuven. Fixture kembar Pro League vs Mechelen 2026-11-07T17:15Z."],
  ["tm_64842", "216", "Satu klub: SK Slavia Praha; SM tanpa imbuhan SK. Fixture kembar UCL 2026-11-04 + 2026-11-25."],
  ["tm_02198", "2417", "Satu klub: ŠK Slovan Bratislava; SM tanpa imbuhan SK. Fixture kembar UCL 2026-11-03 + 2026-11-24."],
  ["tm_89026", "3588", "Satu klub: SV Elversberg; TheStats 'SV 07 Elversberg'. Fixture kembar Bundesliga 2026-11-07 + 21 + 28."],
  ["tm_98394", "429", "Satu klub: Deportivo La Coruña = Deportivo A Coruña (SM). Fixture kembar LaLiga 2026-11-02 + 2026-11-07. Alias CSV 'La Coruna' yang sudah dijangkar ke tm_98394 ikut pindah."],
  ["tm_64398", "794", "Satu klub: 1. FSV Mainz 05; SM tanpa awalan '1.'. Fixture kembar Bundesliga 2026-11-07 + 22 + 28."],
  ["tm_64681", "7980", "Satu klub: Atlético Madrid = Atlético de Madrid (SM). Fixture kembar LaLiga/UCL 2026-10-31 + 11-03 + 11-08."],
  ["tm_master_levadeiakos", "990", "Satu klub: Levadiakos; TheStats ejaan 'Levadeiakos'. Fixture kembar Super League Yunani vs AEK Athens 2026-11-08T15:00Z."],
  ["tm_master_raal_la_louviere", "6722", "Satu klub: RAAL La Louvière; SM menyimpan 'La Louviere'. Fixture kembar Pro League vs Cercle Brugge 2026-11-07T19:45Z."],
  ["tm_26373", "669", "Satu klub: Willem II (Tilburg); TheStats menambahkan kota. 'II' di sini nama raja (Willem II), BUKAN tim cadangan. Fixture kembar Eredivisie 2026-11-06 + 22 + 27."],
  ["tm_76152", "2673", "Satu klub: FK Crvena zvezda (Red Star Belgrade). Fixture CERMIN dataset: baris TheStats comp_3498 vs tm_05877 (21+29 Jul 2026) dan tm_93670 (4+11 Agu 2026) identik tanggal+lawan dengan baris SM sm:2 milik id 2673."],
  ["tm_08322", "321", "Satu klub: Viking FK (Stavanger); SM menyimpan 'Viking'. Fixture CERMIN dataset: vs tm_97303 18+26 Agu, tm_37258 9 Sep, tm_98299 13 Okt 2026 — identik dengan baris sm:2 milik id 321 (lawan 674 = tm_97303 yang sama)."],
  ["tm_25152", "3357", "Satu klub: SK Sturm Graz; SM tanpa imbuhan SK. Fixture CERMIN dataset: vs tm_91646 5 Agu 2026 identik di comp_3498 dan sm:2 (id 3357)."],
  ["tm_42581", "3877", "Satu klub: FK Borac Banja Luka; SM tanpa imbuhan FK. Fixture CERMIN dataset: vs tm_52213 7+14 Jul 2026 identik di comp_3498 dan sm:2 (id 3877)."],
  ["tm_2905815", "928", "Satu klub: FK Kauno Žalgiris; SM tanpa imbuhan FK. Fixture CERMIN dataset: vs tm_4649576 (7+14 Jul), tm_05888 (21+29 Jul), tm_97303 (4+11 Agu) 2026 — tanggal+lawan identik dengan baris sm:2 milik id 928."],
  // Gelombang 6 (2026-11-21, verifikasi produksi temuan #1): klub
  // terbelah fd_ <-> SM yang lolos dari gelombang 5 karena gelombang
  // itu membuktikan pasangan dari katalog saat itu; pasangan ini
  // terbukti oleh fixture kembar Süper Lig yang sama persis (kickoff
  // identik + kompetisi sama + sisi lain kanonik sama) dan oleh
  // kejadian terbit yang identik di kedua baris (tim kandang mencetak
  // gol 0,7612 di fd_ maupun sm_). Bukan kemiripan nama semata.
  ["fd_gaziantep", "4192", "Satu klub: Gaziantep FK (Turki). fd memakai nama CSV pendek 'Gaziantep', SM menyimpan 'Gaziantep F.K.'. Bukti fixture kembar Süper Lig: vs Gençlerbirliği (sm:286 di kedua baris) 2026-11-21T10:30Z dan vs Kasımpaşa 2026-11-06T17:00Z — kickoff + lawan identik di kedua sumber; peluang terbit kejadian yang sama identik (0,7612)."],
  ["tm_master_kasimpasa", "1071", "Satu klub: Kasımpaşa (Turki). TheStats master memakai ejaan tanpa diakritik 'Kasimpasa', SM menyimpan 'Kasımpaşa'. Bukti fixture kembar Süper Lig 2026-11-06T17:00Z: baris fd_ membawa tm_master_kasimpasa sebagai tim tamu, baris sm_ membawa 1071 — kickoff identik, tim kandangnya klub yang sama (Gaziantep, lihat pasangan di atas)."],
];

/** Pasangan yang TERBUKTI klub berbeda — jangan pernah digabung otomatis. */
const DISTINCT_PAIRS: [string, string, string][] = [
  ["10002", "2837", "River Plate Argentina vs River Plate Uruguay — dua klub berbeda (negara + volume data masing-masing besar)."],
  ["132434", "94617", "Ourense CF vs UD Ourense — dua klub berbeda dari kota yang sama (UD bubar 2014, Ourense CF klub terpisah)."],
  ["2079", "28207", "San Fernando CD (Cádiz, Andalusia) vs UD San Fernando (Maspalomas, Canarias) — klub berbeda."],
  ["26423", "28245", "Coria CF = Coria del Río, Andalusia (berdiri 1923) vs CD Coria = Coria, Cáceres, Extremadura (berdiri 1960) — terverifikasi web (Wikipedia kedua klub)."],
  ["277303", "278222", "Celoricense (entitas Campeonato de Portugal) vs SC Celoricense = Sporting Clube Celoricense, Celorico da Beira (berdiri 1948, liga distrik Guarda) — terverifikasi web (soccerzz/playmakerstats)."],
  ["10016", "238136", "Melilla vs Melilla CD — bukti belum cukup dan keduanya cangkang nyaris kosong (3+1 match, 0 log); dibiarkan terpisah sampai ada bukti."],
  ["4701", "82", "'VfL Bremen' (id 4701, 1 match) BUKAN Werder Bremen (id 82, pembawa 106 match) — kandidat ini artefak kunci longgar, bukan kemiripan klub."],
  ["18544", "84", "Qatar (tim NASIONAL, id 18544) vs Qatar SC (klub) — entitas berbeda kategori."],
  ["13", "15064", "Everton FC (Inggris, Premier League) vs Everton de Viña del Mar (Chile, Primera División) — dua klub berbeda yang dulu TERGABUNG KELIRU dalam satu entri kanonik karena nama tersimpan sama persis ('Everton') dan keduanya tanpa baris teams/negara. Dipisah lewat SPLIT_DECISIONS (gelombang 5); bukti: kompetisi katalog disjoint total (Premier League/Carabao Cup vs Primera División Chile)."],
  ["374", "2488", "Bohemians Dublin (Irlandia) vs Bohemians 1905 Praha (Ceko) — nama mirip, klub berbeda negara. Bukti dataset: 20 match id 374 semuanya melawan klub Irlandia (St Patrick's, Cork City, Shelbourne, Waterford, Drogheda, Longford, Athlone); id 2488 membawa Chance Liga Ceko (78 match)."],
  ["fd_mansfield", "20249", "Football-data 'Mansfield' (League One/Two Inggris) adalah Mansfield Town (sm:225), BUKAN AFC Mansfield (sm:20249, klub non-liga dari kota yang sama, berdiri 2012)."],
];

/**
 * KEPUTUSAN PISAH (gelombang 5, 2026-11-21) — entri kanonik yang
 * TERBUKTI menampung DUA klub berbeda karena pengelompokan nama
 * menyatukannya (nama tersimpan sama persis + negara tak diketahui di
 * kedua sisi, jadi uji sengketa tidak pernah menyala). Anggota yang
 * disebut dipisahkan jadi entri sendiri; sisa grup menjadi entri tuan
 * rumah dengan id kanonik yang dihitung ulang dari anggotanya.
 * Negara kedua sisi diisi dari bukti kompetisi katalog (baris teams
 * kedua klub ini tidak ada, jadi builder tidak bisa menurunkannya).
 */
const SPLIT_DECISIONS: {
  member_id: string;
  canonical_id: string;
  country: string | null;
  host_country: string | null;
  reason: string;
}[] = [
  {
    member_id: "15064",
    canonical_id: "sm:15064",
    country: "Chile",
    host_country: "England",
    reason: "Everton de Viña del Mar (Chile) dipisah dari Everton FC (Inggris): kompetisi katalog disjoint total — id 15064 hanya Primera División Chile, id 13 hanya Premier League + Carabao Cup Inggris (audit redesain langkah 2, 2026-11-21).",
  },
];

/** Nama eksternal tanpa baris teams yang sudah diputuskan pemiliknya. */
const EXTRA_ALIASES: { name: string; member_id: string; reason: string }[] = [
  { name: "KV Mechelen", member_id: "2938", reason: "Nama CSV football-data (divisi B1) untuk klub yang di SM tersimpan sebagai 'Mechelen' (id 2938, Belgia). Satu-satunya nama tak ter-resolve di tasks/free-import-unmatched.json run terakhir." },
  // Nama bentuk CSV football-data di fit legacy (data/calibrated_ratings.json)
  // yang tidak sama persis dengan nama kanonik — diputuskan dari identitas
  // klub (divisi + negara + keunikan nama), diukur 2026-11-05: 41 nama,
  // 36 berjangkar di sini, 5 jadi entri legacy-only (LEGACY_ONLY_TEAMS).
  { name: "Seraing", member_id: "1674", reason: "Bentuk pendek CSV untuk RFC Seraing (B1 Belgia)." },
  { name: "Eupen", member_id: "2412", reason: "CSV 'Eupen' di B1 (kasta tertinggi) = KAS Eupen, bukan FC Eupen (entitas lain)." },
  { name: "Beerschot VA", member_id: "2432", reason: "Bentuk CSV untuk K. Beerschot V.A. (B1)." },
  { name: "RWD Molenbeek", member_id: "8307", reason: "RWD Molenbeek = RWDM Brussels (nama kini klub yang sama, B1)." },
  { name: "TSG 1899 Hoffenheim", member_id: "2726", reason: "Bentuk CSV dengan tahun berdiri; kanonik TSG Hoffenheim." },
  { name: "Bayer Leverkusen", member_id: "3321", reason: "Bentuk CSV tanpa '04'; kanonik Bayer 04 Leverkusen." },
  { name: "Ein Frankfurt", member_id: "366", reason: "Singkatan CSV 'Ein' = Eintracht Frankfurt (bukan FSV Frankfurt)." },
  { name: "SV Darmstadt 98", member_id: "482", reason: "Bentuk CSV dengan 'SV'; kanonik Darmstadt 98." },
  { name: "Wehen", member_id: "3519", reason: "Bentuk pendek CSV untuk Wehen Wiesbaden." },
  { name: "Huddersfield", member_id: "251", reason: "Bentuk pendek CSV untuk Huddersfield Town." },
  { name: "Peterboro", member_id: "254", reason: "Singkatan CSV untuk Peterborough United." },
  { name: "Rotherham", member_id: "138", reason: "Bentuk pendek CSV untuk Rotherham United." },
  { name: "Wigan", member_id: "17", reason: "Bentuk pendek CSV untuk Wigan Athletic." },
  { name: "Sheffield Weds", member_id: "56", reason: "Bentuk CSV untuk Sheffield Wednesday." },
  { name: "Giannina", member_id: "542", reason: "Bentuk pendek CSV untuk PAS Giannina (G1 Yunani)." },
  { name: "Athens Kallithea", member_id: "5406", reason: "Athens Kallithea FC = Kallithea (G1)." },
  { name: "Larisa", member_id: "1089", reason: "Bentuk CSV untuk Larissa / AEL (G1)." },
  { name: "Spal", member_id: "394", reason: "Ejaan CSV untuk SPAL (I2 Italia)." },
  { name: "SSC Bari", member_id: "445", reason: "SSC Bari = entitas Bari 1908 di SM (I2)." },
  { name: "Waalwijk", member_id: "814", reason: "Bentuk pendek CSV untuk RKC Waalwijk (N1)." },
  { name: "Heracles", member_id: "1403", reason: "Bentuk pendek CSV untuk Heracles Almelo (N1)." },
  { name: "Volendam", member_id: "2396", reason: "FC Volendam (N1) — bukan RKAV Volendam (amatir)." },
  { name: "Portimonense", member_id: "1658", reason: "Portimonense kasta tertinggi = Portimonense SAD (P1). Entitas SC terpisah di divisi bawah." },
  { name: "Belenenses", member_id: "258659", reason: "Nama CSV lintas era dijangkar ke CF Os Belenenses; era Belenenses SAD (2018+) tercatat sebagai ambiguitas nama yang sama di CSV." },
  { name: "Pacos Ferreira", member_id: "1122", reason: "Ejaan CSV tanpa cedilla untuk Pacos de Ferreira (P1)." },
  { name: "Santander", member_id: "9818", reason: "Bentuk pendek CSV untuk Racing de Santander (bukan tim II)." },
  { name: "La Coruna", member_id: "tm_98394", reason: "Bentuk CSV untuk Deportivo La Coruna (bukan tim II)." },
  { name: "Ibiza", member_id: "132590", reason: "Bentuk pendek CSV untuk UD Ibiza (SP2)." },
  { name: "Amorebieta", member_id: "2055", reason: "Bentuk pendek CSV untuk SD Amorebieta (SP2)." },
  { name: "Ferrol", member_id: "8396", reason: "Bentuk pendek CSV untuk Racing de Ferrol (SP2)." },
  { name: "Karagumruk", member_id: "3990", reason: "Ejaan CSV tanpa diakritik untuk Fatih Karagumruk (T1)." },
  { name: "Ad. Demirspor", member_id: "1039", reason: "Singkatan CSV untuk Adana Demirspor (T1) — bukan Adanaspor." },
  { name: "Bodrumspor", member_id: "13924", reason: "Bodrumspor = Bodrum FK (nama kini klub yang sama, T1)." },
];

/**
 * Klub yang HANYA ada di data legacy (fit divisi lama) dan tidak punya
 * padanan di permukaan SM/TheStats/fixture mana pun — didaftarkan sebagai
 * entri kanonik legacy-only supaya nama fit-nya punya rumah resmi.
 */
const LEGACY_ONLY_TEAMS: { stored: string; display: string; reason: string }[] = [
  { stored: "Oostende", display: "KV Oostende", reason: "Hanya ada di fit legacy B1; tidak ada padanan 'Oostende' di permukaan lain." },
  { stored: "Ionikos", display: "Ionikos", reason: "Hanya ada di fit legacy G1 (Ionikos Nikaia); tidak ada padanan di permukaan lain." },
  { stored: "Pordenone", display: "Pordenone", reason: "Hanya ada di fit legacy I2; tidak ada padanan di permukaan lain." },
  { stored: "Giresunspor", display: "Giresunspor", reason: "Hanya ada di fit legacy T1; tidak ada padanan di permukaan lain." },
  { stored: "Villarreal B", display: "Villarreal B", reason: "Tim B Villarreal di fit legacy SP2; registry hanya punya tim utama Villarreal CF — TIDAK digabung ke tim utama." },
];

/** Nama pakem yang menimpa hasil normalisasi untuk kanonik tertentu. */
const NAME_OVERRIDES: Record<string, string> = {
  "605": "SL Benfica",
  "8364": "Racing Club",
};

/**
 * Id kanonik paksa untuk grup hasil gabungan: id PEMBAWA UTAMA (volume
 * data terbesar), bukan anggota SM pertama yang ketemu. Kunci = salah
 * satu member id di grup itu.
 */
const CANONICAL_ID_OVERRIDES: Record<string, string> = {
  "605": "sm:605", // SL Benfica: 605 pembawa domestik+utama, 254165 pecahan Eropa
  "9908": "sm:9908", // Al-Ahli Saudi: 9908 pembawa 94 match, 17837 pecahan 28
  "7780": "sm:7780", // Al Ain: 7780 pembawa 77 match, 230422 cangkang 1 match
  "8364": "sm:8364", // Racing Club: 8364 pembawa 237 match, 3608 baris standings saja
  "602": "sm:602", // Olympiacos: 602 pembawa utama (110 match), 562 pecahan persahabatan (3)
};

/**
 * Label benua/kategori dari Sportmonks yang BUKAN negara ("World" saja
 * menempel di 3.286 baris tim). Untuk logika grouping/sengketa label ini
 * diperlakukan sebagai negara tidak diketahui — kalau tidak, nama yang
 * sama terbelah hanya karena satu baris berlabel "World" dan baris lain
 * berlabel negara aslinya.
 */
const NON_COUNTRIES = new Set([
  "World", "Europe", "Asia", "Africa", "South America", "North America",
  "Oceania", "Antarctica",
]);
const realCountry = (c: string | null): string | null =>
  c && !NON_COUNTRIES.has(c) ? c : null;

function systemOf(teamId: string): System {
  if (/^\d+$/.test(teamId)) return "sportmonks";
  if (teamId.startsWith("tm_")) return "thestats";
  if (teamId.startsWith("fd_")) return "football-data";
  return "other";
}

/** Kunci nama longgar untuk kandidat: buang diakritik + token generik. */
function looseKey(name: string): string {
  return sanitizeString(name)
    .toLowerCase()
    .replace(/\b(fc|afc|sc|cf|club|sv|ssc|ac|as|cd|ud|rc|1899|1900|1904|04|05|09)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const ds = new DatabaseSync(path.join(ROOT, "data/thestats_dataset.db"), { readOnly: true });
  const rows = ds.prepare("SELECT team_id, name, country FROM teams").all() as unknown as {
    team_id: string; name: string; country: string | null;
  }[];
  // Permukaan standings: 167 team_id dirujuk standings tapi tidak punya
  // baris di tabel teams (audit 2026-11-04). Nama untuk 164 di antaranya
  // ada di baris fixture upcoming (id yang sama tampil bernama di sana);
  // sisanya (3) didaftarkan id-only berflag name_unknown — jujur, bukan
  // nama karangan. Baris sintetis ikut aturan grouping yang sama.
  const standingsIds = (ds.prepare("SELECT DISTINCT team_id FROM standings").all() as unknown as { team_id: string }[])
    .map((r) => r.team_id);
  ds.close();
  const up = new DatabaseSync(path.join(ROOT, "data/upcoming_fixtures.db"), { readOnly: true });
  const nameById = new Map<string, string>();
  for (const r of up.prepare("SELECT home_team_id AS id, home_team_name AS nm FROM upcoming_fixtures UNION SELECT away_team_id, away_team_name FROM upcoming_fixtures").all() as unknown as { id: string; nm: string }[]) {
    if (r.id && r.nm && !nameById.has(r.id)) nameById.set(r.id, r.nm);
  }
  up.close();
  const knownIds = new Set(rows.map((r) => r.team_id));
  const nameUnknownIds: string[] = [];
  let standingsSurfaced = 0;
  for (const sid of standingsIds) {
    if (knownIds.has(sid)) continue;
    const nm = nameById.get(sid);
    if (nm) {
      rows.push({ team_id: sid, name: nm, country: null });
      knownIds.add(sid);
      standingsSurfaced += 1;
    } else {
      nameUnknownIds.push(sid);
    }
  }
  // Permukaan fixture: id tim yang tampil bernama di katalog upcoming tapi
  // tidak punya baris teams dan tidak dirujuk standings (kebanyakan tim
  // TheStats mt_ dari kompetisi yang timnya tidak pernah diimpor ke
  // dataset). Mereka tim nyata dengan fixture — didaftarkan dari bukti
  // fixture dengan aturan grouping yang sama.
  let fixtureSurfaced = 0;
  {
    const up2 = new DatabaseSync(path.join(ROOT, "data/upcoming_fixtures.db"), { readOnly: true });
    const fxRows = up2.prepare(
      "SELECT home_team_id AS id, home_team_name AS nm FROM upcoming_fixtures UNION SELECT away_team_id, away_team_name FROM upcoming_fixtures",
    ).all() as unknown as { id: string; nm: string }[];
    up2.close();
    for (const r of fxRows) {
      if (!r.id || !r.nm || knownIds.has(r.id)) continue;
      knownIds.add(r.id);
      rows.push({ team_id: r.id, name: r.nm, country: null });
      fixtureSurfaced += 1;
    }
  }

  // Negara yang diketahui per nama ternormalisasi (untuk deteksi sengketa).
  // Hanya negara ASLI yang dihitung; label benua diperlakukan tak diketahui.
  const countriesByName = new Map<string, Set<string>>();
  for (const r of rows) {
    const n = normalizeTeamName(r.name);
    if (!countriesByName.has(n)) countriesByName.set(n, new Set());
    const rc = realCountry(r.country);
    if (rc) countriesByName.get(n)!.add(rc);
  }

  // Kelompokkan: kunci = nama ternormalisasi + (negara asli bila sengketa).
  const groups = new Map<string, { name: string; members: (typeof rows)[number][]; contested: boolean }>();
  for (const r of rows) {
    const n = normalizeTeamName(r.name);
    const contested = (countriesByName.get(n)?.size ?? 0) >= 2;
    const key = contested ? `${n}||${realCountry(r.country) ?? "?"}` : n;
    if (!groups.has(key)) groups.set(key, { name: n, members: [], contested });
    groups.get(key)!.members.push(r);
  }

  const teams: CanonTeam[] = [];
  for (const g of groups.values()) {
    const seen = new Set<string>();
    const members: Member[] = [];
    for (const m of g.members) {
      if (seen.has(m.team_id)) continue;
      seen.add(m.team_id);
      members.push({ system: systemOf(m.team_id), team_id: m.team_id, name_as_stored: m.name });
    }
    const sm = members.find((m) => m.system === "sportmonks");
    const tm = members.find((m) => m.system === "thestats");
    const canonical_id = sm ? `sm:${sm.team_id}` : tm ? tm.team_id : members[0].team_id;
    const baseName = sm?.name_as_stored ?? members[0].name_as_stored;
    const country =
      g.members.find((m) => realCountry(m.country))?.country ??
      g.members.find((m) => m.country)?.country ??
      null;
    const aliases = [...new Set(members.map((m) => m.name_as_stored))].sort();
    teams.push({
      canonical_id,
      name: normalizeTeamName(baseName),
      country,
      members,
      aliases,
      contested_name: g.contested,
    });
  }
  // --- Keputusan pisah: keluarkan anggota yang terbukti klub berbeda
  // dari grup nama yang menyatukannya. Berjalan SEBELUM gabung fase 3
  // supaya pasangan gabung/distinct sesudahnya melihat entri yang sudah
  // bersih.
  let splitsApplied = 0;
  for (const sd of SPLIT_DECISIONS) {
    const host = teams.find((t) => t.members.some((m) => m.team_id === sd.member_id));
    if (!host || host.members.length < 2) continue;
    const idx = host.members.findIndex((m) => m.team_id === sd.member_id);
    const [peeled] = host.members.splice(idx, 1);
    host.aliases = [...new Set(host.members.map((m) => m.name_as_stored))].sort();
    const hsm = host.members.find((m) => m.system === "sportmonks");
    const htm = host.members.find((m) => m.system === "thestats");
    host.canonical_id = hsm ? `sm:${hsm.team_id}` : htm ? htm.team_id : host.members[0].team_id;
    if (sd.host_country) host.country = sd.host_country;
    (host.resolution_notes ??= []).push(sd.reason);
    teams.push({
      canonical_id: sd.canonical_id,
      name: normalizeTeamName(peeled.name_as_stored),
      country: sd.country,
      members: [peeled],
      aliases: [peeled.name_as_stored],
      contested_name: false,
      resolution_notes: [sd.reason],
    });
    splitsApplied += 1;
  }

  // --- Fase 3: terapkan keputusan resolusi (gabung terbukti + beda terbukti).
  const byMember = () => {
    const m = new Map<string, CanonTeam>();
    for (const t of teams) for (const mb of t.members) m.set(mb.team_id, t);
    return m;
  };
  const pickCanonical = (members: Member[]): string => {
    for (const m of members) {
      const forced = CANONICAL_ID_OVERRIDES[m.team_id];
      if (forced) return forced;
    }
    const sm = members.find((m) => m.system === "sportmonks");
    const tm = members.find((m) => m.system === "thestats");
    return sm ? `sm:${sm.team_id}` : tm ? tm.team_id : members[0].team_id;
  };
  let mergesApplied = 0;
  const mergeTeams = (ta: CanonTeam, tb: CanonTeam, reason: string): void => {
    const members = [...ta.members, ...tb.members];
    const survivor: CanonTeam = {
      canonical_id: pickCanonical(members),
      name: ta.name,
      country: ta.country ?? tb.country,
      members,
      aliases: [...new Set([...ta.aliases, ...tb.aliases])].sort(),
      contested_name: ta.contested_name || tb.contested_name,
      resolution_notes: [...(ta.resolution_notes ?? []), ...(tb.resolution_notes ?? []), reason],
      distinct_from: [...(ta.distinct_from ?? []), ...(tb.distinct_from ?? [])],
    };
    // Nama pakem: nama tersimpan anggota yang jadi id kanonik, dinormalisasi.
    const canonMember =
      members.find((m) => `sm:${m.team_id}` === survivor.canonical_id || m.team_id === survivor.canonical_id) ??
      members.find((m) => m.system === "sportmonks");
    survivor.name = normalizeTeamName(canonMember?.name_as_stored ?? survivor.name);
    teams.splice(teams.indexOf(ta), 1);
    teams.splice(teams.indexOf(tb), 1);
    teams.push(survivor);
    mergesApplied += 1;
  };
  for (const [a, b, reason] of MERGE_PAIRS) {
    const idx = byMember();
    const ta = idx.get(a);
    const tb = idx.get(b);
    if (!ta || !tb || ta === tb) continue;
    mergeTeams(ta, tb, reason);
  }
  // Grup bayangan: tim kanonik LAIN yang namanya persis sama dengan alias
  // yang sudah diputuskan (lahir dari permukaan fixture/standings, mis.
  // fd_kv-mechelen bernama "KV Mechelen") harus ikut ke target alias —
  // kalau tidak, nama itu menunjuk dua kanonik sekaligus dan alias
  // keputusan kalah oleh urutan abjad.
  for (const ea of EXTRA_ALIASES) {
    const target = byMember().get(ea.member_id);
    if (!target) continue;
    const shadow = teams.find((t) => t !== target && t.name === ea.name);
    if (shadow) {
      mergeTeams(target, shadow, `Grup bayangan "${ea.name}" digabung ke target alias yang diputuskan (${ea.reason})`);
    }
  }
  for (const [memberId, display] of Object.entries(NAME_OVERRIDES)) {
    const t = byMember().get(memberId);
    if (t) t.name = display;
  }
  for (const [a, b, reason] of DISTINCT_PAIRS) {
    const idx = byMember();
    const ta = idx.get(a);
    const tb = idx.get(b);
    if (!ta || !tb || ta === tb) continue;
    (ta.distinct_from ??= []).push({ canonical_id: tb.canonical_id, reason });
    (tb.distinct_from ??= []).push({ canonical_id: ta.canonical_id, reason });
  }
  for (const ea of EXTRA_ALIASES) {
    const t = byMember().get(ea.member_id);
    if (t) {
      if (!t.aliases.includes(ea.name)) t.aliases.push(ea.name);
      (t.resolution_notes ??= []).push(`Alias eksternal diputuskan: "${ea.name}" — ${ea.reason}`);
    }
  }

  // Entri legacy-only: klub yang hanya hidup di fit divisi lama.
  for (const lt of LEGACY_ONLY_TEAMS) {
    teams.push({
      canonical_id: `legacy:${lt.stored.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: lt.display,
      country: null,
      members: [{ system: "other", team_id: `legacy-name:${lt.stored}`, name_as_stored: lt.stored }],
      aliases: [lt.stored],
      contested_name: false,
      resolution_notes: [lt.reason],
    });
  }

  // Entri id-only untuk id standings yang namanya tidak ditemukan di
  // permukaan lokal mana pun — tetap terdaftar supaya setiap referensi
  // punya rumah di registry, dengan flag jujur name_unknown.
  for (const sid of nameUnknownIds) {
    teams.push({
      canonical_id: `sm:${sid}`,
      name: `Sportmonks team ${sid} (nama belum diketahui)`,
      country: null,
      members: [{ system: "sportmonks", team_id: sid, name_as_stored: "" }],
      aliases: [],
      contested_name: false,
      resolution_notes: ["Id dirujuk standings tapi tidak bernama di permukaan lokal mana pun (0 match, 0 telemetri). Didaftarkan id-only; nama diisi bila tim ini kelak punya match/fixture bernama."],
      name_unknown: true,
    });
  }

  teams.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));

  // Kandidat pasangan mirip (TIDAK digabung): kunci longgar sama tapi beda grup.
  const byLoose = new Map<string, CanonTeam[]>();
  for (const t of teams) {
    const k = looseKey(t.name);
    if (!byLoose.has(k)) byLoose.set(k, []);
    byLoose.get(k)!.push(t);
  }
  const candidates: { loose: string; ids: string[]; names: string[] }[] = [];
  for (const [k, ts] of byLoose) {
    if (k.length >= 4 && ts.length > 1) {
      candidates.push({ loose: k, ids: ts.map((t) => t.canonical_id), names: ts.map((t) => t.name) });
    }
  }

  const merged = teams.filter((t) => t.members.length > 1);
  const multiSystem = teams.filter((t) => new Set(t.members.map((m) => m.system)).size > 1);
  const contested = teams.filter((t) => t.contested_name);
  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: "scripts/build-team-canonical.ts",
    note: "Acuan pakem identitas tim: satu canonical_id per tim nyata. members = id per sistem sumber; aliases = semua bentuk nama tersimpan. Penggabungan konservatif (nama ternormalisasi sama + negara tidak bertentangan); pasangan kandidat yang belum digabung ada di tasks/team-canonical-report.md.",
    teams,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  const lines: string[] = [];
  lines.push("# Registry Kanonik Tim — Laporan Build");
  lines.push("");
  lines.push(`Dibangun: ${out.generated_at}`);
  lines.push("");
  lines.push("## Angka");
  lines.push("");
  lines.push(`- Baris tim sumber (tabel teams): **${rows.length}**`);
  lines.push(`- Tim kanonik hasil: **${teams.length}**`);
  lines.push(`- Grup tergabung (>1 baris sumber): **${merged.length}** (menyerap ${merged.reduce((s, t) => s + t.members.length - 1, 0)} baris ekstra)`);
  lines.push(`- Grup lintas sistem (>1 sumber): **${multiSystem.length}**`);
  lines.push(`- Tim bernama sengketa (≥2 negara): **${contested.length}** entri`);
  lines.push(`- Pasangan kandidat mirip BELUM digabung: **${candidates.length}**`);
  lines.push(`- Keputusan resolusi fase 3 diterapkan: **${mergesApplied} penggabungan terbukti**, **${splitsApplied} pemisahan terbukti**, **${DISTINCT_PAIRS.length} pasangan terbukti klub BERBEDA** (dicatat distinct_from, tidak akan digabung), **${EXTRA_ALIASES.length} alias eksternal**.`);
  lines.push(`- Permukaan standings: **${standingsSurfaced} id** tanpa baris teams didaftarkan dari nama fixture; **${nameUnknownIds.length} id** terdaftar id-only (name_unknown: ${nameUnknownIds.join(", ") || "-"}). Cakupan standings sekarang penuh.`);
  lines.push(`- Permukaan fixture: **${fixtureSurfaced} id** tim katalog tanpa baris teams didaftarkan dari bukti fixture (nama + id-nya sendiri).`);
  lines.push("");
  lines.push("## Keputusan resolusi fase 3 (bukti terukur + web untuk identitas ambigu)");
  lines.push("");
  for (const [a, b, r] of MERGE_PAIRS) lines.push(`- GABUNG \`${a}\` + \`${b}\` — ${r}`);
  for (const [a, b, r] of DISTINCT_PAIRS) lines.push(`- BEDA \`${a}\` + \`${b}\` — ${r}`);
  for (const sd of SPLIT_DECISIONS) lines.push(`- PISAH \`${sd.member_id}\` → \`${sd.canonical_id}\` — ${sd.reason}`);
  lines.push("");
  lines.push("## Contoh grup lintas sistem");
  lines.push("");
  for (const t of multiSystem.slice(0, 15)) {
    lines.push(`- \`${t.canonical_id}\` ${t.name} (${t.country ?? "?"}): ${t.members.map((m) => `${m.system}:${m.team_id}="${m.name_as_stored}"`).join(" · ")}`);
  }
  lines.push("");
  lines.push("## Kandidat mirip (keputusan fase resolusi)");
  lines.push("");
  for (const c of candidates.slice(0, 60)) {
    lines.push(`- kunci "${c.loose}": ${c.ids.map((id, i) => `\`${id}\` ${c.names[i]}`).join("  vs  ")}`);
  }
  if (candidates.length > 60) lines.push(`- …dan ${candidates.length - 60} lagi (lihat data/team-canonical.json untuk turunan penuh).`);
  lines.push("");
  fs.writeFileSync(REPORT, lines.join("\n"));

  console.log(`teams sumber=${rows.length} kanonik=${teams.length} grup-tergabung=${merged.length} lintas-sistem=${multiSystem.length} sengketa=${contested.length} kandidat=${candidates.length} resolusi-gabung=${mergesApplied}`);
  console.log(`tertulis: ${OUT} + ${REPORT}`);
}

main();
