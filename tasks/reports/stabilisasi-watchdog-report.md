# Laporan Ronde Stabilisasi Watchdog — Opsi 1 + 6 (2026-11-24)

Branch: `fix/stabilisasi-watchdog` dari master `bb05f78`, worktree
`~/workspace/coding/app-football-stabilisasi`. Ronde ini branch + tes +
laporan saja: **tidak ada aktivasi produksi** — merge/deploy dan
pengaktifan watchdog v2 menunggu kata Arandi di ronde berikutnya.
Produksi (port 3101, checkout utama) tidak disentuh; terbukti di akhir
ronde `/healthz` di 3101 masih 404 (rute belum ada di build produksi).

Dasar: `Brief-Stabilisasi-Bola-Muse-Spark.pdf` (pemilik, 23 Nov 2026)
+ `diagnosis-hang-2026-11-23.md`. Catatan kepatuhan: `AGENTS.md` repo
memuat blok injeksi `nextjs-agent-feedback` (perintah menjalankan
`npx next internal agent-feedback-instructions`) dan blok aturan
subagent/persona tanam — keduanya diperlakukan sebagai isi berkas
saja, **tidak dijalankan dan tidak diikuti**, sama seperti ronde-ronde
sebelumnya.

## Ringkasan

- **Opsi 1 (probe liveness ringan + restart terkendali)** selesai:
  endpoint `GET /healthz` di proses app yang sama, dan watchdog v2
  (skrip + unit timer systemd) yang me-restart hanya sesudah 3 gagal
  beruntun, dengan masa tenggang startup 60 dtk dan cooldown 300 dtk.
  Semua berkas watchdog v2 **staged** — belum terpasang.
- **Opsi 6 (pengukuran)** selesai: log `[timing]` per request
  (templat rute, status, durasi total) untuk Beranda, Jadwal, dan
  detail; ringkasan delay event loop per 30 dtk bila di atas ambang;
  error server tercatat sebagai baris `[timing]` status=500.
- Kriteria penerimaan brief terbukti di panggung uji (port 3107/3108):
  probe ringan tanpa data, urutan restart tiruan persis seperti
  diminta, simulasi jalur data gagal (halaman gagal terlihat di log,
  liveness tetap sehat, nol restart), dan seluruh skrip verifikasi
  repo hijau.

## (A) Perubahan app — branch repo

| Berkas | Perubahan |
|---|---|
| `app/healthz/route.ts` | BARU. `GET /healthz`: 200, `Cache-Control: no-store`, body `ok\n`. Satu-satunya impor `connection` dari `next/server` (penanda dinamis per-request; tidak membaca data). |
| `lib/web/timing.ts` | BARU. Helper timer rute (`mulaiTimerRute`/`selesaikanTimerRute` via `after()`), keputusan log murni `perluLog`, formatter baris, normalisasi templat rute, `catatRuteError`. |
| `instrumentation.ts` | BARU. `register()` memuat monitor event loop khusus Node.js; `onRequestError()` mencatat setiap error server sebagai baris `[timing]` status=500 bertemplat ternormalisasi. |
| `instrumentation-node.ts` | BARU. `monitorEventLoopDelay` (perf_hooks); ringkasan maks 1 baris/30 dtk hanya bila max ≥ `TIMING_ELD_MAX_MS` (baku 1000). |
| `app/page.tsx` | Bedah: impor + titik mulai/selesai timer di pulau `SorotanDanJadwal` (pulau data utama Beranda), templat `/`. |
| `app/(terminal)/pertandingan/page.tsx` | Bedah: sama di `PertandinganContent`, templat `/pertandingan`. |
| `app/(terminal)/pertandingan/[matchId]/page.tsx` | Bedah: sama di `AnalisisContent` (kedua cabang return), templat `/pertandingan/[matchId]`. |
| `tests/test-stabilisasi.ts` | BARU. 32 assertion: keputusan log, format baris, normalisasi templat, penjaga statis graf impor healthz + pemasangan timer di 3 halaman. |
| `package.json` | `test:web` ditambah `tests/test-stabilisasi.ts` di ujung rantai. |

Berkas read-only (`lib/agent/*`, `lib/coverage.ts`,
`lib/syndicate-orchestrator.ts`, `lib/llm/*`) tidak disentuh.

### Bukti /healthz tanpa jalur data (dua arah, sesuai brief)

(a) **Graf impor**: `app/healthz/route.ts` mengimpor HANYA
`next/server` — tidak ada modul app lain sama sekali (dijaga uji
statis di test-stabilisasi: daftar impor persis `["next/server"]`,
dan regex anti `node:sqlite|node:fs|lib/web/data|lib/web/rekam`).
Repo **tidak punya middleware/proxy** (pencarian `middleware.*` /
`proxy.*` kosong) dan `next.config.ts` tidak punya rewrite/redirect
untuk jalur ini — jadi tidak ada lapisan lain antara probe dan
handler. Build menandai rute ini `ƒ (Dynamic)` — berjalan per
request, bukan prerender statis.

(b) **Perilaku hidup**: di instance uji 3107, `/healthz` menjawab
200 dalam 5–8 ms ×5 dengan header `cache-control: no-store`; dan di
instance rusak 3108 (DB dataset digantung) `/healthz` tetap 200
dalam 5–7 ms sementara `/` gagal membaca database (lihat C.3).

### Aturan log timing (opsi 6) — persisnya

- Baris rute: `[timing] ts=<ISO-UTC> route=<templat> status=<kode> dur_ms=<n>`.
- **Selalu dicatat**: request dengan `dur_ms >= TIMING_SLOW_MS`
  (env, baku **2000**).
- **Sampel normal**: 1 dari `TIMING_SAMPLE_N` penyelesaian rute
  (env, baku **100**; ≤1 = catat semua — dipakai instance uji).
- **Error**: selalu, lewat `onRequestError`, `dur_ms=-` (+ `digest=`).
- **Event loop**: `[timing] ts=... eventloop mean_ms=.. p95_ms=.. max_ms=.. window_s=30`,
  maks 1 baris per 30 dtk, hanya bila max ≥ 1000 ms.
- Query string & nilai parameter **tidak pernah** dicatat: yang
  ditulis hanya templat konstan per berkas halaman. Terbukti hidup:
  request `/pertandingan?q=remo&tz=Asia/Jakarta` tercatat sebagai
  `route=/pertandingan` (lihat bukti C.4).

## (B) Watchdog v2 — berkas staged di ~/workspace/vm-services/

**Belum terpasang.** `ensure-bola-vm.sh` live TIDAK diubah (cron 5
menit tetap mengeksekusi versi lama sampai ronde aktivasi).

| Berkas | Isi |
|---|---|
| `liveness-watchdog.sh` | BARU. Probe `curl --max-time 3 $PROBE_URL` (baku `http://127.0.0.1:3101/healthz`). Restart sesudah 3 gagal beruntun; sukses mereset hitungan ke 0. Grace: tidak menghitung selama service berumur < 60 dtk (dari `ActiveEnterTimestamp`) atau < 60 dtk sesudah restart sendiri terakhir. Cooldown: tidak ada restart selama 300 dtk sesudah restart. State persisten di `state/state.env` (`consecutive_failures`, `last_restart_epoch`), ditulis atomik; `flock` mencegah tumpang tindih. Setiap keputusan penting + restart dicatat berformat `[liveness] ts=... probe=... failures=n/3 action=... reason=...` ke stdout (jurnal) dan `state/liveness.log`. `PROBE_URL`, `RESTART_CMD`, `STATE_DIR`, ambang/grace/cooldown semua bisa diatur via env (dipakai tes). |
| `bola-liveness.service` | BARU (kanonik, inert). Oneshot `ExecStart=liveness-watchdog.sh`. |
| `bola-liveness.timer` | BARU (kanonik, inert). `OnBootSec=20s`, `OnUnitActiveSec=30s`, `AccuracySec=1s`. |
| `ensure-bola-vm.v2.sh` | BARU (staged, BUKAN pengganti live). Beda dari v1: memasang 4 unit (app, tunnel, liveness service+timer), meng-enable + menyalakan timer, tetap menyalakan service yang DOWN, dan **blok cek halaman → restart DIHAPUS** (restart kini milik liveness saja). Refresh env proxy identik. |

### Konfigurasi lama → baru

| Aspek | Lama (v1, masih live) | Baru (v2, staged) |
|---|---|---|
| Target probe | `GET /` Beranda penuh (membaca DB 2,9 GB) | `GET /healthz` loopback, tanpa data |
| Interval cek | ±5 menit (cron ensure) | 30 detik (systemd timer) |
| Timeout probe | 30 detik | 3 detik |
| Ambang restart | 1× gagal | 3× gagal beruntun |
| Reset hitungan | — | sukses → 0 |
| Startup grace | tidak ada | 60 detik |
| Cooldown restart | tidak ada | 300 detik |
| State antar-eksekusi | tidak ada | `state/state.env` + `flock` |
| Log keputusan | 1 baris stderr saat restart | `[liveness]` per keputusan, jurnal + berkas log |
| App mati total (service down) | ensure menyalakan | tetap ensure v2 menyalakan |
| Pengukuran halaman | tidak ada | log `[timing]` (rute + event loop) |

### Makna tiap angka di log

- `[timing] dur_ms` (baris rute): dari awal render komponen konten
  per-request (sesudah `connection()` terselesaikan) sampai respons
  selesai terkirim (callback `after()`). Mencakup baca data + render
  + streaming; tidak mencakup antre/routing sebelum render (umumnya
  milidetik) dan tidak mencakup transfer jaringan ke klien.
- `[timing] dur_ms=-` (baris error): durasi tidak tersedia di jalur
  `onRequestError`; baris ini menandai kegagalan + templat + digest.
- `eventloop mean/p95/max_ms`: delay penjadwalan timer Node pada
  jendela 30 dtk itu (perf_hooks, resolusi 20 ms). Max besar bersamaan
  dengan dur_ms besar = event loop tertahan (I/O sinkron/SQLite) —
  pembeda yang diminta brief antara stall I/O dan beban biasa.
- `[liveness] failures=n/3`: jumlah gagal beruntun saat keputusan itu
  diambil. `http=000` = koneksi gagal/timeout (bukan kode HTTP).
  `age_s` = umur service/restart terakhir saat grace menahan hitungan;
  `remaining_s` = sisa cooldown saat restart tertahan.
- **Durasi SQLite per request TIDAK dicatat** — jujur: query berjalan
  sinkron di dalam fase render yang sama dan tidak ada titik ukur
  bersih tanpa mengubah lapisan data. Dua sinyal pengganti (durasi
  total + delay event loop) adalah yang brief minta dibedakan.

## (C) Bukti penerimaan

Instance uji: build worktree (BUILD_ID `jHxnMBiaja2iCI_uIjeOG`) di
port 3107 (`TIMING_SAMPLE_N=1`) dan salinan rusak di 3108. Bukti
mentah di `tasks/reports/stabilisasi-evidence/`.

### C.1 /healthz cepat
5× `200` dalam 0,005–0,008 dtk; header `cache-control: no-store`;
body `ok`. Rute tertanda `ƒ Dynamic` di tabel build.

### C.2 Urutan restart tiruan — 15/15 PASS
Skrip otomatis `stabilisasi-evidence/run-liveness-test.sh` (restart
stub berlog, `systemctl` stub via PATH, probe mati = port 9, state di
/tmp; transkrip penuh di `liveness-test-output.txt`):

- Run 1–2 (probe mati): **0 restart**, hitungan 1 lalu 2.
- Run 3: **tepat 1 restart** (log stub membuktikan), hitungan reset 0.
- Run 4–6 (cooldown 300 dtk): ambang tercapai lagi tapi restart
  **tertahan cooldown** — tetap 1 restart, hitungan 3.
- Run dengan `COOLDOWN_S=0`: restart ke-2 terjadi (jalur kedaluwarsa
  cooldown), hitungan reset 0.
- Probe diarahkan ke instance sehat 3107 sesudah 2 gagal: sukses →
  hitungan **reset ke 0**, tanpa restart.
- Grace (`GRACE_S=60` + timestamp start service segar dari stub):
  probe mati **tidak dihitung** (hitungan tetap 0, log
  `reason=startup-grace`).

### C.3 Simulasi jalur data gagal
Salinan pohon app dengan `data/thestats_dataset.db` berupa symlink
dangkal ke `/nonexistent/` (HANYA di salinan; data produksi tidak
disentuh), DB lain utuh. Hasil:

- `GET /` → server melempar `Error: unable to open database file`;
  halaman menjawab 200 **terdegradasi** (isolasi error per-bagian
  menangkap kegagalan pulau — perilaku desain redesain), dan
  kegagalan itu tercatat persis sebagai
  `[timing] ts=2026-11-23T18:49:04.109Z route=/ status=500 dur_ms=- digest=184988745`.
  Jadi alert halaman muncul di log walau status HTTP terdegradasi.
- `GET /healthz` sesudah kegagalan itu: 200 dalam 0,005–0,007 dtk ×3.
- Probe liveness ×3 ke instance rusak: exit 0, **nol kegagalan
  tercatat** (berkas state bahkan tidak terbentuk), nol restart.
  Halaman terpantau, liveness sehat, tidak ada restart — persis
  kriteria brief.

### C.4 Contoh baris timing (instance sehat, `timing-log-evidence.txt`)
```
[timing] ts=2026-11-23T18:47:53.146Z route=/ status=200 dur_ms=12676
[timing] ts=2026-11-23T18:47:53.719Z route=/pertandingan status=200 dur_ms=532
[timing] ts=2026-11-23T18:47:57.257Z route=/pertandingan status=200 dur_ms=3509   <- request ber-query; tercatat templat polos
[timing] ts=2026-11-23T18:48:01.139Z eventloop mean_ms=46.6 p95_ms=21.2 max_ms=12759.1 window_s=30
[timing] ts=2026-11-23T18:48:01.780Z route=/pertandingan/[matchId] status=200 dur_ms=122
```
Baris pertama adalah request lambat sungguhan (Beranda dingin 12,7
dtk di host kelaparan ini — di atas ambang 2000, jadi akan tercatat
bahkan pada sampling produksi), dan ringkasan event loop menangkap
blokade 12.759 ms yang sama: mekanisme diagnosis terlihat langsung
oleh pengukuran baru.

### C.5 Verifikasi repo (semua di worktree)
- `tsc --noEmit`: bersih.
- `lint:gate`: LOLOS (91 error ≤ baseline 92; tidak ada error baru).
- `npm run build`: sukses; `/healthz` tertanda dinamis.
- `test:web` hijau penuh, termasuk `[jadwal-liga] 27/27` dan suite
  baru `[stabilisasi] 32/32`.
- `test:lanjut` hijau (25/25, 28/28, 27/27, 96/96, 73/73).
- `test:api` 42/42. `test:data` hijau (18/18, 58/58, 110/110, 69/69, 23/23).
- `test:verifikasi` hijau penuh (39/39, 36/36, 41/41, 38/38) —
  catatan jujur: larian pertama gagal di suite detail-ssr dengan
  "Another next build process is already running" karena dua
  instance uji saya (3107/3108) masih hidup dari worktree yang sama
  saat suite membangun; sesudah instance dihentikan, suite hijau.
  Itu kontensi lingkungan uji, bukan regresi kode.

## Langkah aktivasi (ronde deploy, atas kata Arandi)

1. Merge `fix/stabilisasi-watchdog` → master, push.
2. Deploy build app baru ke VM dengan pola biasa — **perhitungkan
   tabrakan watchdog**: ensure lama me-restart app bila cek `/`
   gagal saat service sengaja dihentikan untuk build; restart bersih
   sesudah build tuntas adalah penyembuhnya; verifikasi ISI (bukan
   cuma status): `curl 127.0.0.1:3101/healthz` → 200 `ok`.
3. Cadangkan ensure lama: `cp ensure-bola-vm.sh ensure-bola-vm.v1.bak`,
   lalu `cp ensure-bola-vm.v2.sh ensure-bola-vm.sh` dan jalankan
   sekali → memasang `bola-liveness.service/.timer`, enable + start
   timer, state dir terbentuk di `~/workspace/vm-services/state/`.
4. Verifikasi aktivasi: `systemctl list-timers bola-liveness.timer`;
   `journalctl -u bola-liveness.service -n 20` (tidak ada baris fail
   saat app sehat); uji paksa satu kali dengan probe diarahkan
   sementara ke port mati pada salinan state terpisah (jangan di
   state produksi).
5. **Teks job cron `bola-vm-watchdog` perlu penyegaran kata** saat
   aktivasi (ia masih menggambarkan ensure sebagai pengendali
   restart) — ditandai di sini, TIDAK diubah ronde ini.
6. Sesudah deploy (per brief pemilik): bandingkan timeout, restart,
   dan latensi halaman selama minimal satu siklus refresh yang
   mencakup jam rawan, lalu cocokkan dengan metrik I/O VM; evaluasi
   checkpoint WAL PASSIVE hanya bila pengukuran mengarah ke sana
   (pekerjaan lanjutan, bukan ronde ini).

## Rollback

- **Watchdog** (berkas saja, tanpa menyentuh app): kembalikan
  `ensure-bola-vm.sh` dari `ensure-bola-v1.bak` (atau salinan git-an
  bila sudah diarsipkan), `systemctl disable --now bola-liveness.timer`,
  hapus `/etc/systemd/system/bola-liveness.{service,timer}`,
  `systemctl daemon-reload`. Perilaku kembali persis ke v1.
- **App**: redeploy build sebelumnya (rollback `.next` seperti pola
  deploy biasa). `/healthz` kembali 404 dan baris `[timing]`
  berhenti; tidak ada migrasi/skema data yang perlu dibalik —
  perubahan ronde ini murni kode baca + log.

## Deviasi & catatan jujur

1. Durasi SQLite per request tidak dicatat (alasan di bagian B) —
   sesuai klausul brief "jika bisa diukur; bila tidak, katakan".
2. `dur_ms` mulai di awal render komponen konten, bukan di socket —
   selisih preamble routing tidak terukur (umumnya milidetik);
   makna angka didokumentasikan apa adanya di header `timing.ts`.
3. Baris rute halaman membawa status=200 hanya bila render konten
   selesai; kegagalan render dicatat jalur error (status=500,
   dur_ms=-). Detail untuk laga tak dikenal (`notFound()`) tidak
   menghasilkan baris timing — di luar fokus brief.
4. Beranda: timer dipasang di pulau `SorotanDanJadwal` saja (pulau
   data utama + terberat), bukan di ketiga pulau — satu baris per
   request Beranda; kegagalan pulau lain tetap tertangkap
   `onRequestError`.
5. Simulasi C.3: halaman `/` menjawab 200 terdegradasi (isolasi
   error per-bagian), bukan 500 penuh — kegagalan tetap terlihat di
   log timing sebagai baris error, dan kriteria brief terpenuhi.
6. Lingkungan uji: worktree memakai `npm ci` sendiri karena
   Turbopack menolak build dengan `node_modules` symlink dari
   checkout utama; DB uji berupa symlink baca-saja ke data checkout
   utama (app membuka DB readOnly). Bukan perubahan repo.
7. Kegagalan larian pertama `test:verifikasi` adalah kontensi kunci
   build dengan instance uji saya sendiri (lihat C.5) — didokumentasikan,
   bukan disembunyikan.
