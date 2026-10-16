# Tasks: Fase C — Fondasi LLM Layer

Plan lengkap: `tasks/plan-phase-c-llm-foundation.md`
Urutan disusun risiko naik: perubahan nol-perilaku dulu, migrasi plumbing, baru
sapu terakhir yang menyentuh orchestrator.

---

## Slice 1: Sumber model & kebersihan secret (risiko rendah, nol perubahan perilaku)

### Task C1: Satu sumber nama model (`lib/llm/models.ts`)

**Description:** Nama model tersebar di 4 file. Satu modul menjadi sumber tunggal supaya
perubahan nama model cukup di satu tempat.

**Keputusan (dikonfirmasi pemilik): nilai default TIDAK diseragamkan.** Setiap peran
memakai default lama masing-masing file, supaya nol model yang berubah nilainya. Modul
ini mengumpulkan **nama env var + mekanisme baca**, bukan menetapkan satu nilai khusus.
Konsekuensinya: kalau suatu saat default mau diseragamkan, itu keputusan sadar berbeda,
bukan efek samping refactor ini.

**Perubahan yang SUDAH dikerjakan sebelum task ini (di luar plan, atas keputusan
pemilik):** di `lib/syndicate-orchestrator.ts`, `MODEL_BULL` disetel ke
`ag/gemini-3.8-flash-high` dan `MODEL_NEUTRAL` ke `bai/glm-5.3-flash`. Jadi nilai
`SYNDICATE.MODEL_BULL` / `SYNDICATE.MODEL_NEUTRAL` di `models.ts` **harus memakai nilai
baru ini**, bukan nilai lama. Ini bukan refactor nol-perilaku untuk dua peran itu —
nilainya memang sengaja diubah.

**Keanehan yang dicatat, TIDAK diperbaiki di sini:** default peran debat di `route.tsx`
(`MODEL_BULL` = `ag/gemini-3.8-flash-high`, `MODEL_NEUTRAL` = `bai/glm-5.3-flash`) kini
**sama** dengan orchestrator untuk dua peran ini. `MODEL_DEFAULT` tetap beda antar file.
Perbedaan label di `route.tsx` bersifat praktis-mati (di-overwrite `syndicate_debate`
dari orchestrator di baris 584), jadi tidak diperbaiki kecuali diminta.

**Acceptance criteria:**
- [ ] `lib/llm/models.ts` mengekspor satu fungsi `envModel(namaEnv, defaultLama)` plus
      konstanta per-peran yang **mempertahankan default yang berlaku saat ini**.
      Bentuknya memisahkan secara eksplisit asal jalur (`SYNDICATE.*` vs `AGENT_ROUTE.*`)
      agar default per-jalur bisa hidup tanpa salah satu menang diam-diam.
- [ ] `SYNDICATE.MODEL_BULL` default = `ag/gemini-3.8-flash-high`,
      `SYNDICATE.MODEL_NEUTRAL` default = `bai/glm-5.3-flash` (nilai pasca-perubahan).
- [ ] `AGENT_ROUTE.*` memakai default `route.tsx` saat ini, tidak diubah.
- [ ] Setiap konstanta membaca env var yang sama seperti sekarang.
- [ ] `MODEL_DEFAULT` per file tetap beda seperti sekarang; hanya pindah lokasi definisi.
- [ ] `MODEL_ARBITER` tetap tersedia, dibaca dari env dengan default = nilai judgement 1
      sesuai perilaku sekarang (`agent/route.tsx:62`), tanpa mengubah hasil.
- [ ] Env var mati `ODDSPAPI_API_KEY` dan `ODDSPAPI_BASE_URL` dihapus dari `.env.example`.

**Verification:**
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] Test regresi nilai: untuk setiap peran, `resolve(model)` tanpa env di-set
      menghasilkan string **identik** dengan nilai yang berlaku setelah perubahan Bull/
      Neutral di orchestrator. Ini diuji di script C7, bukan diasumsikan.
- [ ] `grep` tidak menemukan literal `"bai/` atau `"ag/` di luar `lib/llm/models.ts`.

**Dependencies:** None
**Files touched:** `lib/llm/models.ts` (baru), `lib/syndicate-orchestrator.ts`,
`lib/stats-fetcher-agent.ts`, `app/api/agent/route.tsx`, `app/api/betting/route.ts`,
`.env.example`
**Scope:** Medium (6 file, semua substitusi konstanta)

---

### Task C2: Hapus fallback secret hardcode

**Description:** Dua file masih memuat kunci API sebagai nilai cadangan. Dihapus
supaya kegagalan konfigurasi env terlihat, bukan diam-diam memakai kunci yang sudah
ada di riwayat git remote.

**Acceptance criteria:**
- [ ] `lib/syndicate-orchestrator.ts` (baris 69) membaca kunci dari env saja.
- [ ] `lib/stats-fetcher-agent.ts` (baris 34) membaca kunci dari env saja.
- [ ] `lib/1xbet.ts` kunci RapidAPI dari env saja.
- [ ] Kalau env kosong, error-nya jelas menyebut nama env yang kurang (bukan
      `undefined` misterius).
- [ ] `.env.example` memuat semua kunci yang kini wajib, dengan komentar cara isi.

**Verification:**
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] `grep -E "(sk-|[0-9a-f]{16,}msh)" lib/ app/` tidak menemukan kunci literal.
- [ ] `node_modules\.bin\tsc.cmd` build lolos dengan env lengkap (uji manual lokal).

**Dependencies:** None (bisa paralel dengan C1)
**Files touched:** `lib/syndicate-orchestrator.ts`, `lib/stats-fetcher-agent.ts`,
`lib/1xbet.ts`, `.env.example`
**Scope:** Small (4 file, hapus nilai literal)

> **Catatan operasional (bukan tugas kode):** kunci di atas sudah masuk riwayat git
> remote. Menghapusnya dari kode tidak membatalkan kebocoran. Rotasi kredensial
> dilakukan pemilik repo sebelum deploy.

---

## Slice 1b: Keputusan arsitektur yang dikunci

Setelah pemeriksaan kode, dipastikan bahwa Fase C **tidak mengubah struktur debat**:

- Jumlah agent tetap 5 (Bull, Neutral, Bear, Judgement 1, Judgement 2).
- Model setiap peran tetap berbeda seperti sekarang; pembandingan antar-model
  adalah inti fitur dan tidak disentuh.
- `MODEL_DEFAULT` di orchestrator terkonfirmasi **tidak pernah dipakai** (hanya
  definisi di baris 71), jadi ia bukan peserta debat melainkan nilai cadangan tak terpakai.
- Perbedaan default `MODEL_BULL`/`MODEL_NEUTRAL` antara orchestrator dan agent route
  **dipertahankan apa adanya** sesuai keputusan pemilik (Task C1). Apakah itu memang
  disengaja tetap jadi pertanyaan terbuka, tapi tidak diubah refactor ini.
- Anti-bias orchestrator (retry model yang sama, tanpa substitusi) dipertahankan dan
  dikunci oleh test di Task C7.
- Bull di orchestrator **sudah** dipindah ke `ag/gemini-3.8-flash-high` dan Neutral ke
  `bai/glm-5.3-flash` (keputusan pemilik, dikerjakan di luar plan). Task C1 hanya
  memastikan `models.ts` memuat nilai baru itu, bukan mengubahnya lagi.
- `app/api/agent/route.tsx` hanya memanggil model **sekali** (`callModelWithFallback`
  untuk `MODEL_JUDGEMENT_1`, baris 576). Label Bull/Bear/Neutral di file itu hanya teks
  pada template JSON yang kemudian ditimpa `syndicate_debate` dari orchestrator (baris 584).
  Jadi tidak ada debat lokal di route itu yang perlu ditambah agent.

---

## Slice 2: Klien & ekstraksi bersama (risiko rendah)

### Task C3: Klien bersama `lib/llm/client.ts`

**Description:** `createOpenAI` dan `customFetch` diduplikasi 4x. Satu modul klien
yang memegang keduanya, plus satu fungsi pemanggilan dengan parameter kebijakan.

**Acceptance criteria:**
- [ ] `lib/llm/client.ts` mengekspor `getNineRouterClient()` (singleton `createOpenAI`
      dengan `baseURL` + `customFetch` bersama).
- [ ] Ekspor `callModel({ model, system, prompt, timeoutMs, maxTokens? })` yang
      memakai `generateText`, mengembalikan `{ text, modelUsed }`.
- [ ] Ekspor `callModelWithPolicy({ model, system, prompt, policy })` dengan dua
      kebijakan bernama eksplisit:
      - `"retry-same"` → dua kali percobaan model sama; kalau tetap gagal kembalikan
        teks error (dipakai orchestrator).
      - `"substitute"` → satu kali model utama, lalu model cadangan; menerima
        `onExhausted: "throw" | "soft-fail"` (dipakai agent route dan betting route).
- [ ] Tidak ada lagi `createOpenAI`/`customFetch` lokal di file consumer.

**Verification:**
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] `grep -c "createOpenAI\|customFetch"` di `lib/syndicate-orchestrator.ts`,
      `lib/stats-fetcher-agent.ts`, `app/api/agent/route.tsx`, `app/api/betting/route.ts` = 0.

**Dependencies:** C1 (nama model datang dari modul terpusat)
**Files touched:** `lib/llm/client.ts` (baru)
**Scope:** Medium (1 file baru, inti phase ini)

---

### Task C4: Migrasi 3 consumer sederhana ke klien bersama

**Description:** Tiga call-site yang memakai jalur `generateText` biasa beralih ke
`lib/llm/client.ts`, tanpa mengubah kapan pun mereka memakai retry vs substitusi.

**Acceptance criteria:**
- [ ] `app/api/agent/route.tsx`: `callModelWithFallback` lokal diganti
      `callModelWithPolicy` dengan `policy: "substitute"`, `onExhausted: "throw"`.
      Perilaku tetap: model utama dulu, lalu `MODEL_DEFAULT`, lalu throw.
- [ ] `app/api/betting/route.ts`: kebijakan sama, `onExhausted: "soft-fail"`
      (mengembalikan `{success:false}`, bukan throw).
- [ ] `lib/stats-fetcher-agent.ts`: satu panggilan, tanpa fallback, lewat `callModel`.
- [ ] Teks log tetap membedakan model utama vs fallback agar jejak audit utuh.

**Verification:**
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] `scripts/verify-pl-pipeline.ts` tetap 100% PASS (end-to-end tidak berubah).

**Dependencies:** C3
**Files touched:** `app/api/agent/route.tsx`, `app/api/betting/route.ts`,
`lib/stats-fetcher-agent.ts`
**Scope:** Medium (3 file, migrasi mekanis)

---

## Slice 3: Orchestrator (risiko tertinggi, menyentuh debat)

### Task C5: Relokasi `call9RouterDirect` tanpa mengubah perilaku

**Description:** Pindahkan pemanggilan SSE manual dari orchestrator ke
`lib/llm/9router-direct.ts` **apa adanya**. Tujuannya memisahkan, bukan memperbaiki.

**Acceptance criteria:**
- [ ] `lib/llm/9router-direct.ts` memuat `call9RouterDirect` dengan kemampuan sama:
      `maxTokens` 16384, timeout 180 detik, payload native thinking, parsing SSE,
      pemulihan `reasoning_content`, penanganan respons ter-wrap Atria.
- [ ] Kebijakan orchestrator tetap **retry model yang sama**, tanpa substitusi,
      dan tetap mengembalikan teks error (bukan throw) setelah retry gagal.
- [ ] Komentar jaminan independensi model dipindah beserta kodenya, tidak hilang.
- [ ] Tidak ada perubahan byte pada logika di dalam `tryCall`.

**Verification:**
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] `scripts/verify-pl-pipeline.ts` tetap 100% PASS.
- [ ] Diff diperiksa manual: selain baris `import` dan lokasi fungsi, isi fungsi identik.

**Dependencies:** C3 (biar `nineRouter` singleton bisa dipakai bersama)
**Files touched:** `lib/llm/9router-direct.ts` (baru), `lib/syndicate-orchestrator.ts`
**Scope:** Small (relokasi, bukan rewrite)

---

### Task C6: Satu `extractJSON` untuk semua call-site

**Description:** Ada 3 varian: `safeExtractJSON` (orchestrator, dengan fallback
Atria & `reasoning_content`), dan dua `extractJSON` sederhana di kedua route.

**Acceptance criteria:**
- [ ] `lib/llm/extract.ts` mengekspor `extractJSON` tunggal yang mencakup: buang
      fence ```` ```json ````, ambil objek `{...}` pertama, parsing.
- [ ] Varianta Atria & `reasoning_content` tetap tersedia lewat parameter opsional
      `{ mode: "lenient" }`, dipakai orchestrator saja (jalur SSE menyimpan format itu).
- [ ] Tiga consumer memakai fungsi bersama; tidak ada lagi `extractJSON` lokal.
- [ ] Perilaku saat input bukan JSON tidak berubah: kembalikan fallback yang diberikan
      pemanggil, jangan throw.

**Verification:**
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] Script baru (C7) menguji ketiga jalur ekstraksi pada masukan identik.

**Dependencies:** C5 (orchestrator sudah pindah, jadi jalur Atria terlihat jelas)
**Files touched:** `lib/llm/extract.ts` (baru), `lib/syndicate-orchestrator.ts`,
`app/api/agent/route.tsx`, `app/api/betting/route.ts`
**Scope:** Medium (4 file)

---

### Checkpoint: Setelah Task C6

- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.
- [ ] `scripts/verify-pl-pipeline.ts` 100% PASS.
- [ ] `scripts/verify-foundation-phase-a.ts` 46 PASS, 0 FAIL.
- [ ] `scripts/verify-foundation-phase-b.ts` 20 PASS, 0 FAIL.
- [ ] `grep` konfirmasi: 0 `createOpenAI`/`customFetch` lokal, 0 kunci literal,
      nama model hanya di `lib/llm/models.ts`.
- [ ] Review pemilik sebelum lanjut ke Slice 4.

---

## Slice 4: Verifikasi & prasyarat walk-forward

### Task C7: Script verifikasi Fase C

**Description:** Mengunci perilaku yang baru disatukan supaya regresi terdeteksi.

**Acceptance criteria:**
- [ ] `scripts/verify-foundation-phase-c.ts` menguji `extractJSON` pada masukan:
      JSON bersih, JSON ber-fence, JSON ter-wrap Atria (mode lenient), dan
      teks non-JSON (harus kembalikan fallback, tidak throw).
- [ ] Menguji `callModelWithPolicy` dengan model tiruan: `"retry-same"` memanggil
      model sama dua kali saat gagal; `"substitute"` memakai model cadangan.
- [ ] Mengonfirmasi orchestrator tidak pernah memanggil model berbeda dari target
      (uji dengan menghitung model unik yang dipanggil saat target selalu gagal).
- [ ] Gaya keluaran mengikuti `scripts/verify-foundation-phase-a.ts`
      (`✅/❌`, ringkasan `PASS/FAIL`, exit 1 saat gagal).

**Verification:**
- [ ] Script lolos dengan semua assertion hijau.

**Dependencies:** C6
**Files touched:** `scripts/verify-foundation-phase-c.ts` (baru)
**Scope:** Small (1 file baru)

---

### Task C8: Parameter `--ref-date` pada kalibrasi (prasyarat walk-forward)

**Description:** `scripts/calibrate-ratings.ts` memakai tanggal match terakhir di
database sebagai `refDate` (baris 86). Validasi walk-forward perlu mengkalibrasi per
fold dengan tanggal potong berbeda. Tugas ini menyiapkan parameter, belum membuat
runner walk-forward-nya.

**Acceptance criteria:**
- [ ] `calibrateDivision` menerima `refDate` sebagai parameter, bukan lagi
      selalu dari `matches[matches.length - 1].date`.
- [ ] Ada opsi `--ref-date=YYYY-MM-DD`; tanpa opsi, perilaku default tidak berubah.
- [ ] Dengan `--ref-date`, hanya match sebelum tanggal itu yang masuk kalibrasi
      (tidak ada kebocoran data masa depan).
- [ ] Keluaran JSON menyertakan `refDate` yang dipakai agar setiap fold terlacak.

**Verification:**
- [ ] Tanpa `--ref-date`: keluaran identik dengan sekarang.
- [ ] Dengan `--ref-date` mundur: skor tim dan jumlah sampel turun (wajar, data lebih sedikit).
- [ ] `node_modules\.bin\tsc.cmd --noEmit` lolos.

**Dependencies:** None (independen dari Slice 1-3, tapi ditahan sampai checkpoint
karena menyentuh file skrip produksi)
**Files touched:** `scripts/calibrate-ratings.ts`
**Scope:** Small (1 file)

> **Catatan:** runner walk-forward itu sendiri milik Fase D. Task ini hanya membuka
> jalan. Pembobotan musim/time-decay masih menunggu keputusan pemilik repo.

---

## Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Nilai default `MODEL_DEFAULT` berubah (agent route dari Gemini ke glm-5.3-flash) | Kualitas jawaban endpoint agent bisa bergeser | Dicatat sadar di commit; kalau tidak diinginkan, kembalikan via env `NINE_ROUTER_MODEL` dan catat alasan |
| Salah paham kebijakan orchestrator lalu "diperbaiki" jadi substitusi | Debat 5-agent kehilangan independensi, hasil jadi bias | Kebijakan dikunci lewat `policy: "retry-same"` + test C7 yang gagal kalau ada substitusi |
| `extractJSON` bersama salah tangani format Atria | Orchestrator gagal baca respons, debat kosong | Mode `lenient` khusus orchestrator + test C7 pada masukan Atria |
| Penghapusan fallback secret mematikan runtime kalau env belum diisi | Endpoint gagal total | Kegagalan bersifat jelas (error menyebut env), dan `.env.example` diperbarui bersamaan |
| Hapus kunci dari kode disalahartikan "sudah aman" | Kredensial tetap valid di riwayat git remote | Catatan operasional rotasi eksplisit di plan; tidak dieksekusi agent |

## Pertanyaan terbuka

- Apakah perbedaan default `MODEL_BULL`/`MODEL_NEUTRAL` antara orchestrator dan agent
  route memang disengaja (dua jalur berbeda maksud), atau kecelakaan? Dipertahankan
  untuk Fase C sesuai keputusan pemilik; kalau ternyata kecelakaan, penyeragaman
  adalah perubahan sadar tersendiri.
- Apakah `ODDSPAPI_*` memang sudah tidak dipakai sama sekali, atau direncanakan
  untuk sumber odds kedua? Kalau direncanakan, biarkan di `.env.example` dengan komentar.
- Bobot musim/time-decay (walk-forward) masih menunggu keputusan pemilik repo.
