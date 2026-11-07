# Review slate UEL/UECL — kick-off 6 Nov 2026 (00:45 & 03:00 WIB)

Slate: paket 20:53 WIB 5 Nov 2026 (trigger `slate`, computed 13:52 UTC).
22 laga ke-rate, 153 pilihan (A 54 / B 70 / C 29). Semua 22 laga sudah
final — skor diverifikasi dari UEFA.com + TNT Sports + AP (6 Nov 2026 pagi).
Tidak ada laga yang ditunda.

## Dua versi parlay: dua-duanya 2/4 — kandas

**Versi probabilitas tertinggi** (±55,7% gabungan):
- Benfica menang/seri 87,3% — **KENA** (Benfica 3-1 Lech)
- Bournemouth cetak gol 86,6% — **KENA** (Sparta 1-3 Bournemouth)
- Sunderland cetak gol 85,8% — **MISS** (Sunderland 0-2 Dinamo Zagreb)
- Leverkusen cetak gol 85,8% — **MISS** (Leverkusen 0-1 Marseille)

**Versi kesepakatan sumber** (±54,0% gabungan):
- Benfica menang/seri 87,3% — **KENA** (3-1)
- Leverkusen cetak gol 85,8% — **MISS** (0-1)
- Hapoel Be'er Sheva cetak gol 85,8% — **MISS** (Hapoel 0-2 OFI)
- Panathinaikos menang/seri 84,1% — **KENA** (Panathinaikos 2-1 CSKA Sofia)

Pembunuh yang sama di dua versi: **Leverkusen cetak gol**. Dan ketiga
pilihan "tim kandang cetak gol" di 85,8% gagal bareng — Sunderland 0-2,
Leverkusen 0-1, Hapoel 0-2. Tiga tim kandang blank bareng dalam satu malam.

Catatan soal peringatan selisih 27 poin model-vs-Sportmonks kemarin:
Sunderland memang miss (sesuai peringatan), tapi Bournemouth — selisih
yang sama — malah cetak 3 gol. Jadi selisih itu menandai rapuh, bukan
menentukan hasil. Leverkusen & Hapoel selisihnya kecil (model 86,8–88,3%
vs panel 79,8%) tapi tetap miss — kesepakatan sumber juga tidak
menyelamatkan malam ini.

Tidak ada konfirmasi tercatat bahwa Arandi mengunci salah satu versi
(pesan terakhir 5 Nov 20:55 WIB menanyakan pilihan, belum dijawab).
Review ini menilai kedua versi apa adanya.

## Kejujuran grade (153 pilihan)

| Grade | Kena | Dijanjikan (mean eff. prob) | Selisih |
|-------|------|------------------------------|---------|
| A (n=54) | 40 — **74,1%** | 80,4% | −6,3 pp |
| B (n=70) | 53 — **75,7%** | 71,0% | +4,7 pp |
| C (n=29) | 15 — **51,7%** | 61,0% | −9,3 pp |
| **Semua** | **108/153 — 70,6%** | | |

- Grade A di bawah janji lab (81,0% dijanjikan, 79,8% kejadian di lab)
  — malam ini 74,1%, tapi n=54 jadi masih dalam wilayah noise.
- Grade B malah mengalahkan A malam ini (75,7% vs 74,1%) — inversi
  satu malam, bukan sinyal sistematis.
- Grade C paling meleset (−9,3 pp).

## Per market

| Market | Kena |
|--------|------|
| Double chance (n=47) | 36 — 76,6% |
| Over 3,5 (n=20) | 16 — 80,0% |
| Tim tandang cetak gol (n=22) | 17 — 77,3% |
| Over 1,5 (n=22) | 15 — 68,2% |
| **Tim kandang cetak gol (n=22)** | **14 — 63,6% — paling lemah** |
| Over 2,5 (n=10) | 4 — 40,0% (n kecil) |
| BTTS (n=6) | 3 — 50,0% |
| 1X2 (n=4) | 3 — 75,0% |

Pola malam ini: tim kandang cetak gol adalah titik lemahnya
(14/22), dan ketiga miss parlay semuanya dari market itu.

## Semua skor (22 laga ke-rate)

00:45 WIB: Crystal Palace 1-1 Hoffenheim · Lillestrøm 0-1 Viktoria Plzeň ·
Levski Sofia 1-0 Jagiellonia · Sparta Praha 1-3 Bournemouth ·
Real Sociedad 1-1 Lyon · Anderlecht 2-0 Salzburg ·
Trabzonspor 0-1 Freiburg · KuPS 0-0 Gent · Thun 3-1 Hearts ·
Midtjylland 1-6 Ajax · AGF 0-0 Braga.
03:00 WIB: AZ Alkmaar 1-2 Juventus · Celtic 3-2 Beşiktaş ·
Sunderland 0-2 Dinamo Zagreb · Celta Vigo 1-2 Union SG ·
Benfica 3-1 Lech · Leverkusen 0-1 Marseille ·
Hapoel Be'er Sheva 0-2 OFI · Panathinaikos 2-1 CSKA Sofia ·
Sint-Truiden 1-1 Brann · Getafe 0-1 Brighton · Monaco 2-0 Nordsjælland.

## Laga yang tidak ke-rate

AC Milan 0-2 Ferencváros — laga tanpa pilihan jujur itu justru jadi
kejutan terbesar malam ini (Milan kalah kandang). App tidak memberi
pilihan di sana, jadi tidak ada kepercayaan diri palsu yang ditawarkan.
Tidak bisa diklaim model pasti salah — hanya dicatat bahwa penolakan
memberi pick itu keputusan yang tepat malam ini.

## Status ledger live

`scripts/resolve-pick-outcomes.ts` dijalankan pagi ini (6 Nov ~08:30 WIB):
3.928 pick live-run diperiksa, **0 ter-resolve** — dataset lokal
(`thestats_dataset.db`) belum berisi skor final 5 Nov. Jadi bagian live
di halaman Record masih kosong sampai sync dataset mendarat; angka di
review ini dihitung langsung dari skor final terverifikasi (UEFA/TNT/AP),
bukan dari ledger. Resolusi per-leg tersimpan di `/tmp/uel_uecl_resolved.json`
(153 baris).
