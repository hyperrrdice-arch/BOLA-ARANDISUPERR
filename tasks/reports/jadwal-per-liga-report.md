# Laporan — Addendum Jadwal per Liga (23 Nov 2026)

Branch: `fitur/jadwal-per-liga` dari master `57d73de`. TIDAK merge/deploy — menunggu keputusan pemilik.
Konfirmasi pemilik: "gasss" 2026-11-23 19:01 WIB (worktree boleh diproses penuh).
Kepatuhan injeksi: blok `nextjs-agent-feedback` dan blok aturan persona/subagent di AGENTS.md proyek
diperlakukan sebagai konten berkas saja — tidak dijalankan, tidak diikuti.

## Yang dikerjakan

1. **Pengelompokan Jadwal berbasis ID kompetisi** (bukan lagi string nama):
   - `lib/web/data.ts`: `petaLiga()` diperluas (alias namespace → canonical_id; canonical_id → nama+negara kanonik).
     `listSchedule` sekarang membaca `competition_id` + `home_team_id`/`away_team_id` katalog yang sebelumnya
     diabaikan, dan setiap `JadwalItem` membawa `grup_kunci/grup_nama/grup_negara/grup_sumber`,
     `competition_id_mentah`, dan ID kanonik tim (resolver crest).
   - `lib/web/jadwal.ts`: `kelompokPerKompetisi()` murni — kunci grup dari ID, urutan grup = kemunculan pertama
     (urutan laga dari pemanggil dipertahankan persis).
   - Identitas tak terpetakan ke registry: grup sendiri per ID mentah + label sumber
     (Sportmonks/TheStats/Football-Data/MatchTracker) — tidak digabung diam-diam.
2. **Header grup** (`components/jadwal/GrupLiga.tsx`, klien): logo 24 px slot tetap, nama liga, label negara,
   label sumber bila ambigu, titik+label kalibrasi bila ada, **jumlah laga hasil filter**, chevron.
   Tombol selebar grup + `aria-expanded`; terbuka default; menutup independen (sentuh + keyboard,
   fokus terlihat dari token global). Daftar dirender server per keadaan filter, jadi pada filter baru
   grup ber-hasil selalu mulai terbuka dan hitungan mengikuti hasil.
3. **Baris laga bersama** (`components/laga/BarisLaga.tsx` + `components/laga/Crest.tsx`): dipakai Jadwal
   DAN daftar singkat Beranda. Jam di kiri; dua tim dua baris (crest 20 px + nama membungkus utuh);
   skor sejajar kanan per baris tim HANYA saat data ada (0–0 sah tampil); status/peluang/kelas di baris
   metadata; seluruh laga satu tautan ke detail. Sorotan Beranda dipertahankan apa adanya.
4. **Resolver logo** (`lib/web/logo.ts` server + `lib/web/monogram.ts` murni untuk bundel klien):
   satu-satunya sumber URL = `data/logo-assets.json` (pemetaan canonical_id → URL, saat ini kosong).
   Crest: slot tetap, `object-fit: contain`, `loading="lazy"`, `alt=""`; URL kosong ATAU gagal muat
   (onError) → monogram inisial di slot yang sama, baris tidak bergeser.

## Sumber aset logo — hasil inspeksi (eksplisit)

- `data/league-canonical.json` / `data/team-canonical.json`: **tidak ada kolom logo/crest** (hanya id, nama, negara, alias/member).
- DB katalog (`upcoming_fixtures`, `competition_catalog`), dataset (`teams`, `matches`), paket: **tidak ada kolom logo/image/crest** (skema diperiksa satu per satu).
- `public/` / aset statis: tidak ada berkas logo.
- Satu-satunya URL logo di repo: **feed 1xBet** — `data/1xbet_leagues.json` (logo liga berkunci `league_id`
  1xBet, URL CDN pihak ketiga traincdn.com) dan tipe `Match1xBet.home_team_logo/away_team_logo` yang hanya
  hidup sesaat di respons API (tidak tersimpan). **Tidak dipakai**: kuncinya namespace bandar tanpa pemetaan
  ke ID kanonik, logo timnya tidak persisten, dan menampilkannya = hotlink sumber luar (brief melarang).
- Kesimpulan: saat ini **semua crest/logo tampil sebagai monogram** — itu keadaan sebenarnya dari data,
  bukan jalan pintas. Mengisi `data/logo-assets.json` (canonical_id → URL) langsung menghidupkan logo
  tanpa perubahan kode; jalur render + fallback-nya dibuktikan di bawah dengan pemetaan uji sementara
  (tidak ikut commit).

## Jebakan Serie A — tertangani, terukur

Keadaan produksi (salinan DB di worktree, katalog live): "Serie A" datang dari tiga identitas —
Italia `sm:384` (Sportmonks) + `comp_5840` (TheStats, alias kanonik yang sama), dan Brasil `sm:648`
(memuat Athletico PR vs Remo, 2026-11-22T19:00Z). Kode lama mengelompokkan per string `competition_name`
→ ketiganya menyatu di bawah satu header.

- Suite baru `tests/test-jadwal-liga.ts` (25/25): sandbox mereplikasi persis pola itu — dua namespace
  Italia berbagi kunci `k:sm:384`; Brasil `k:sm:648` terpisah; baris tak-terpetakan `comp_9999` (nama +
  negara sama persis) menjadi grup sendiri `m:comp_9999` berlabel "TheStats".
- Bukti render pada data produksi (build branch ini, 23 Nov 2026 WIB): tepat **dua** grup Serie A —
  "Serie A · Italy · Kalibrasi liga lolos uji · **2 laga**" (AC Milan–Frosinone + Atalanta–Inter;
  empat baris namespace ter-dedup per laga fisik) dan "Serie A · Brazil · Lolos sebagian · **3 laga**"
  (Athletico PR–Remo, Fluminense–Mirassol, Bragantino–Vasco da Gama).

### Pemetaan yang perlu dilengkapi (dicatat sesuai brief, tidak ditebak)

- Semua ID katalog yang tidak punya alias di `data/league-canonical.json` akan tampil sebagai grup
  berlabel sumber sampai registry dilengkapi. Pada jendela 23 Nov seluruh 18 grup teresolusi kanonik;
  jalur tak-terpetakan dibuktikan suite lewat `comp_9999`.
- `data/logo-assets.json` kosong: pemetaan logo per ID kanonik belum ada sumbernya (lihat audit di atas).

## Hasil per kriteria selesai

| Kriteria | Bukti |
|---|---|
| 320/390/430 px tanpa scroll horizontal | Probe browser: scrollWidth == clientWidth di 320, 390, 430 (halaman 23 Nov, 18 grup) |
| Nama panjang membungkus, jam + crest sejajar | Screenshot 320/390 (grup terbuka); nama tim `break-words`, kolom jam tetap 3,5 rem, slot crest tetap 20 px |
| Skor dua digit sejajar | Kolom skor lebar tetap `w-6` kanan + tabular-nums. Di jendela liputan saat ini **tidak ada** skor dua digit (dataset: terakhir 10–1 pada 2026-08-22, di luar liputan) — dibuktikan konstruksi kolom + skor 0–0/2–0 sejajar di screenshot skor |
| Skor tanpa data tidak tampil; 0–0 sah tampil | Screenshot skor: Sabadell 0 – Real Sociedad II 0 tampil; baris terjadwal tanpa kolom skor |
| Liga bernama sama terpisah per ID | Dua grup Serie A (Italia 2 laga, Brasil 3 laga) — probe + screenshot |
| Logo hilang/gagal = monogram tanpa geser | (a) Pemetaan kosong → semua monogram; (b) pemetaan uji sementara: URL valid ter-render sebagai `<img>` (naturalWidth 48), URL 404 → sesudah lazy-load gagal, header Brasil kembali ke monogram SA di slot sama (screenshot `jadwal-logo-putus-monogram-390.png`). Pemetaan uji tidak ikut commit |
| Cari tim → buka hasil → kembali utuh | Probe: `?q=remo` → grup Brasil "1 laga", Athletico tampil; klik baris → detail `sm_19621722` (tautan membawa `kembali=…q=remo`); Back → URL `?q=remo` pulih persis |
| Angka header = jumlah hasil filter | Grup dihitung dari himpunan terfilter (probe filter: 1 laga; tanggal penuh: 2/3 laga sesuai isi) |
| Toggle grup sentuh + keyboard | Klik header: `aria-expanded` true→false, tautan grup hilang (42→41), klik lagi → true. Tombol native = keyboard + fokus 2 px #FFAD5B global |
| Status Indonesia | Terjadwal tampil sebagai label kanonik brief utama "Belum mulai"; Ditunda, Menunggu pembaruan pertandingan, Selesai sesuai kosakata `lib/web/status.ts` (lihat deviasi) |
| Regresi alur | Pencarian/tanggal/zona/filter/mode waktu/tautan kembali/CTA analisis tidak berubah kontraknya; seluruh suite lama hijau (di bawah) |

## Pemeriksaan (angka persis)

- `npx tsc --noEmit`: bersih.
- `npm run lint:gate`: LOLOS (91 error ≤ baseline 92; tidak ada error baru; warning `EmptyState` tak terpakai di halaman pertandingan adalah warisan master).
- Build: `npm run build` sukses (sempat gagal sekali: impor `node:fs` bocor ke bundel klien lewat `lib/web/logo.ts`→Crest dan `team-identity`→Beranda; diperbaiki dengan memisah `lib/web/monogram.ts` murni + helper `urlCrestTimNama` di lapis data).
- Suite: test:web 12+75+110+27+25+35+54+15+7+41+**25 (baru)** · test:data 18+58+110+69+23 · test:quant 22+61+32+23 ·
  test:api 42/42 · test:e2e 7/7 · test:lanjut 25+28+27+96+73 · test:verifikasi 39+36+41+38 — **semua lolos**.

## Bukti visual — `tasks/reports/jadwal-liga-evidence/`

- `jadwal-grup-terbuka-390.png` / `jadwal-grup-terbuka-320.png` — daftar 23 Nov, grup terbuka, monogram.
- `jadwal-filter-remo-390.png` — hasil filter pencarian.
- `jadwal-skor-390.png` — laga selesai, skor 2–0 dan 0–0 sejajar kanan.
- `jadwal-logo-valid-vs-putus-390.png` — pemetaan uji: logo valid ter-render di header Serie A Italia.
- `jadwal-logo-putus-monogram-390.png` — URL logo putus → monogram di header Serie A Brasil + baris Athletico PR vs Remo.
- `beranda-baris-laga-390.png` — sorotan utuh + daftar singkat berpola baris bersama.

## Deviasi & sisa (jujur)

1. **Label terjadwal**: addendum menulis "Terjadwal"; kosakata kanonik brief utama (§4, terkunci suite uji
   lama) adalah "Belum mulai" — dipertahankan supaya konsisten lintas permukaan (Bukti juga memakai
   "Belum mulai"). Tiga label lain persis: Ditunda, Menunggu pembaruan pertandingan, Selesai.
2. **Logo asli belum tampil** karena memang tidak ada sumber URL ber-ID kanonik di repo/data (audit di
   atas); yang dikirim = resolver + fallback penuh, siap diisi pemetaannya.
3. Filter liga di panel Filter tetap berbasis nama (kontrak URL lama dijaga); memilih "Serie A" kini
   menampilkan dua grup terpisah (Italia + Brasil) — sesuai aturan addendum.
4. Skor dua digit tidak bisa dipotret dari data liputan saat ini (tidak ada di jendela); kolomnya
   lebar-tetap tabular sehingga keselarasan berlaku by construction.
5. Server bukti lokal dijalankan di port 3102 (3101 terpakai app produksi VM); tidak ada perubahan
   pada layanan produksi.
