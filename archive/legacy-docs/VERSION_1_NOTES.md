# 📦 Football Agent - Release Version 1.0.0

Dokumen ini mencatat titik stabil (*stable milestone*) untuk **Version 1.0.0** dari proyek **football-agent**. Seluruh kode sumber, konfigurasi, modul AI, dan basis data pasar taruhan pada versi ini telah dibackup secara penuh.

---

## 🎯 Spesifikasi & Fitur Lengkap Version 1.0.0

### 1. Desain Antarmuka: Notion Dark Workspace
* **Kanvas & Estetika**: Mengadopsi palet warna Notion Dark `#191919`, surface kartu `#202020`, border halus `rgba(255,255,255,0.094)`, dan tag multi-select warna pastel khas Notion (Green, Blue, Purple, Yellow, Red, Gray).
* **Navigasi Tab Interaktif**:
  * `[ 📋 Ringkasan & Prediksi ]`: Probabilitas pasar tersirat 1X2, Box Keputusan Hakim (*Judge Consensus*), ulasan komprehensif, checklist faktor kunci.
  * `[ ⚽ Taktik & Lapangan 2D ]`: 2D Tactical Blueprint Soccer Pitch (pure CSS/SVG), status lineup resmi/prediksi, profil & indeks ketegasan wasit, checklist cakupan data liga.
  * `[ 📊 Statistik & Form ]`: Performa form 5 laga, rekor kandang/tandang terisolasi (*home split* vs *away split*), urgensi klasemen, dan kualitas tembakan *non-penalty xG (npxG)*.
  * `[ 💰 Bursa Pasar & Odds ]`: Matriks 1X2, Asian Handicap, Over/Under, BTTS, analisis aliran dana *Smart Money*, dan *Player Props Goalscorer Threats*.

### 2. Intelijen Pra-Laga & TheStatsAPI Telemetry
* **Fase 1 (Deterministic Telemetry)**:
  * Mengambil 10 dimensi data terpadu dari TheStatsAPI (< 2 detik, 0 token AI) via `Promise.all`: jadwal, wasit, formasi/lineup, cedera pemain, form terakhir, H2H, klasemen, bursa odds, shotmap npxG, dan player props.
* **Fase 2 (AI Reasoning Engine)**:
  * Menggunakan model `ag/gemini-3.8-flash` via 9Router untuk mengevaluasi benturan taktik dan menghasilkan proyeksi skor & konsensus.

### 3. Integrasi 1xBet API & Dual-Model Betting Intelligence
* **Proteksi Kuota Ketat**:
  * *On-Demand Trigger*: Hanya memanggil API saat tombol diklik.
  * *Disk Cache 283 Liga (`data/1xbet_leagues.json`)*: Hemat kuota pencarian liga (0 request API).
  * *In-Memory Cache (TTL 60 Menit)*: Respons pasar disimpan selama 1 jam.
* **Dual-Model Betting AI Paralel**:
  * **Model A**: `ag/gemini-3.8-flash-high`
  * **Model B**: `oc/muse-spark-1.3-contributor-free`
  * Menganalisis 500+ baris data pasar aktif secara simultan dan mengelompokkan:
    - 🟢 *Banker (Rekomendasi Teraman)*
    - 💎 *Value Bet (Positive Expected Value)*
    - 🎯 *Pasar Niche Menarik (Kartu, Corner, Babak)*
    - ⚠️ *Trap Bet (Jebakan Bandar untuk Dihindari)*
* **Sintesis Konsensus**:
  * Otomatis mendeteksi kesepakatan kedua model (*Consensus Agreement*) vs diversifikasi sudut pandang (*Divergent Perspective*).
* **Pencocokan Hybrid**:
  * Pencocokan tim otomatis dengan fuzzy string matching + opsi input manual `1xBet Match ID`.

---

## 🔄 Cara Melakukan Fallback / Rollback ke Version 1.0.0

Jika di kemudian hari ada perubahan atau eksperimen baru yang ingin dikembalikan persis ke kondisi Version 1.0.0, Anda dapat menjalankan perintah berikut:

### Opsi 1: Melalui Perintah NPM (Satu Perintah)
```bash
npm run restore:v1
```

### Opsi 2: Dari Folder `backup_v1/`
Salin seluruh isi folder `backup_v1/` dan timpa (*overwrite*) ke folder utama proyek.

### Opsi 3: Dari File Zip `football-agent-v1.0.0.zip`
Ekstrak file `football-agent-v1.0.0.zip` langsung ke direktori proyek.

---
*Status: Version 1.0.0 Verified & Sealed on 12 Oktober 2026.*
