# 📦 Football Agent - Release Version 1.1.0

Dokumen ini mencatat pencapaian stabil (*stable milestone*) untuk **Version 1.1.0** dari proyek **football-agent**. Seluruh kode sumber, arsitektur kuantitatif deterministik, pipeline multi-agent sindikat, data validator anti-halusinasi, dan modul caching pada versi ini telah dibackup secara penuh di direktori `backup_v1.1/` dan file arsip `football-agent-v1.1.0.zip`.

---

## 🎯 Spesifikasi & Fitur Utama Version 1.1.0

### 1. Deterministic Quantitative Engine (`lib/quant/`)
* **Dixon-Coles Bivariate Poisson Model** (`lib/quant/dixon-coles.ts`):
  * Menghitung $\lambda$ (home expected goals) dan $\mu$ (away expected goals) dengan parameter serangan/pertahanan tim.
  * Faktor koreksi skor rendah ($\tau_{0,0}, \tau_{1,0}, \tau_{0,1}, \tau_{1,1}$) untuk mengatasi korelasi Poisson pada skor rendah (0-0, 1-0, 0-1, 1-1).
  * Menghasilkan probabilitas murni 1X2, Over/Under (1.5, 2.5, 3.5), Both Teams to Score (BTTS), Fair Decimal Odds murni, dan distribusi 6 skor paling mungkin tanpa ketergantungan pada tebakan LLM.
* **Shin Method (1993) Vig Stripping** (`lib/quant/vig-stripping.ts`):
  * Mengupas margin bandar (overround 3–8%) dari odds 1xBet untuk mengungkap probabilitas pasar yang sesungguhnya (*fair market odds*).
* **Fractional Kelly Criterion Engine** (`lib/quant/kelly.ts`):
  * Kalkulasi Expected Value ($\text{EV} = P \times O - 1$).
  * Menghitung alokasi bankroll Quarter Kelly (0.25) dengan hard cap 4.0% bankroll per taruhan untuk proteksi risiko jangka panjang.

### 2. Multi-Agent Syndicate Committee (`app/api/`)
* **Arsitektur Konsorsium 4-Model 9Router**:
  * **Bull Analyst (`ag/gemini-3.8-flash-medium`)**: Membangun tesis kemenangan berbasis momentum serangan dan duel transisi.
  * **Bear Auditor (`ag/gemini-3.8-flash-high`)**: Menguji tesis secara skeptis, mendeteksi jebakan bandar (*trap lines*), dan kelelahan jadwal.
  * **Chief Risk Officer Arbiter (`ag/gemini-3.8-flash-high`)**: Menimbang argumen Bull vs Bear terhadap output matematis quant, mengeluarkan vonis Grade A/B/C/PASS dan alokasi stake Kelly.
  * **Fast Market Scanner (`ag/gemini-3.8-flash`)**: Memindai bursa odds 1xBet secara cepat dan efisien.
  * **Failover Resilience**: Failover otomatis jika ada endpoint model yang lambat/timeout.

### 3. Data Integrity, Schema Validation & Anti-Hallucination (`lib/stats-validator.ts` & `lib/stats-fetcher-agent.ts`)
* **Zod Strict Schema Validation & Sanitizer**:
  * Menjamin seluruh data TheStatsAPI (Match detail, Lineup, Wasit, H2H, Split Form, Odds) teruji secara tipe data.
  * Penanganan defensif format `venue` (baik string teks maupun objek `{ id, name, city, capacity }`) dengan auto-format ke `"Emirates Stadium, London"`.
  * Mengubah data kosong menjadi penanda eksplisit `is_available: false` dan mencatatnya ke `missing_data_registry`.
* **Dynamic Fetcher Dispatcher (`ag/gemini-3.8-flash`)**:
  * AI dispatcher memeriksa waktu kickoff laga; secara cerdas melewati endpoint yang belum relevan (misal: melewati lineup untuk laga H-3 hari guna menghemat kuota TheStatsAPI).
  * Dilengkapi fallback heuristik instan (2.5 detik) sehingga UI tidak pernah freeze.
* **Smart RAM Cache (`lib/stats-cache.ts`)**:
  * Caching adaptif berdasarkan waktu kickoff (H-2 jam = 10m TTL, H-1 hari = 60m TTL, selesai = 24h TTL).
  * Pruning pasif otomatis jika entri melebihi 1000 item.
* **Strict Closed-World Grounding**:
  * Prompt agent diwajibkan hanya mengutip data yang tercantum dalam JSON payload yang tervalidasi.
  * Dilarang keras mengarang nama pemain, data cedera fiktif, atau rekor skor masa lalu.

### 4. Notion-Style Enterprise UI (`app/page.tsx`)
* **Data Integrity & Grounding Shield**:
  * 🟢 `DATA INTEGRITY: 100% CLOSED-WORLD GROUNDED`
  * Informasi model dispatcher & jumlah panggilan API yang dihemat oleh cache.
  * Tag peringatan batasan data faktual (misal: `⚠️ Lineup resmi belum rilis`).
* **Quant Engine Card & Value Bet Matrix**:
  * Menampilkan $\lambda, \mu$, true probabilities, fair odds, dan overround margin %.
  * Matriks rekomendasi taruhan +EV lengkap dengan alokasi Kelly Bankroll Sizing.
* **Adversarial Debate Panels**:
  * Panel Bull (Hijau), Panel Bear (Merah), dan Kotak Keputusan Arbitrase CRO (Ungu).

---

## 🔄 Cara Melakukan Fallback / Rollback ke Version 1.1.0

Jika di kemudian hari Anda ingin mengembalikan proyek persis ke kondisi Version 1.1.0:

### Opsi 1: Melalui Perintah NPM (Satu Perintah)
```bash
npm run restore:v1.1
```

### Opsi 2: Dari Folder `backup_v1.1/`
Salin seluruh isi folder `backup_v1.1/` dan timpa (*overwrite*) ke direktori utama proyek.

### Opsi 3: Dari File Zip `football-agent-v1.1.0.zip`
Ekstrak file `football-agent-v1.1.0.zip` langsung ke direktori proyek.

---
*Status: Version 1.1.0 Verified, Compiled with 0 Errors, and Sealed on 12 Oktober 2026.*
