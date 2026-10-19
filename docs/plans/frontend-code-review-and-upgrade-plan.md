# Laporan Audit Kode Frontend & Rencana Peningkatan
**Football Agent Quant Terminal (BOLA-ARANDISUPERR)**  
*Dibuat oleh: Lead Frontend Architect & Antigravity Agent*  
*Tanggal: 17 Oktober 2026*  

---

## 1. Ringkasan Eksekutif (Executive Summary)

Audit ini mengevaluasi arsitektur frontend `football-agent` berbasis **Next.js 16 (App Router)**, **React 19**, dan **Tailwind CSS v4** dengan pendekatan *Verdict-First (BFF ViewModel pattern via `AnalysisView`)*.

### Status Kesehatan Frontend:
- **Keamanan (Security)**: `PASS` — Tidak ada `dangerouslySetInnerHTML`, semua parameter URL di-escape via `encodeURIComponent`, tidak ada celah injeksi client-side.
- **Performa (Performance)**: `PASS` — Komponen berat (500+ baris bursa 1xBet) di-lazyload dengan `next/dynamic` (`ssr: false`), tabel dipaginasi per 30 baris, DOM tidak mengalami freeze.
- **Stabilitas State (Race Condition Guard)**: `PASS` — Menggunakan pattern `useRef(reqId)` pada fetching data pertandingan dan bursa taruhan, mencegah response jaringan lambat menimpa data laga baru.
- **Integritas Logika (Correctness)**: `NEEDS ATTENTION` — Ditemukan 3 edge-case logika numerik pada perhitungan Kelly Criterion & pembagian nol, serta 2 kelemahan pengecekan `null !== undefined`.
- **Kebersihan Kode (Code Hygiene)**: `NEEDS CLEANUP` — Terdapat 3 komponen yatim (*dead code*) pasca migrasi ke ViewModel v2.0 yang sudah tidak diimpor lagi di `app/page.tsx`.

---

## 2. Rincian Temuan & Solusi Kode (Bug & Edge-Cases)

Berikut adalah daftar temuan teknis beserta solusi kode langsung yang siap diaplikasikan:

---

### 🔴 Temuan 1: Alokasi Stake Kelly Minimum 1% saat EV Negatif & Risiko Division by Zero
- **File**: `components/dashboard/OneXBetDeepMarketsCard.tsx` (baris ~319–335)
- **Masalah**:
  1. Pada pilihan *Double Chance* banker:
     ```typescript
     const ev1X = prob1X * o1X - 1;
     picks.push({
       ...
       kelly_percentage: Math.round(Math.max(1, (ev1X / (o1X - 1)) * 25) * 10) / 10,
       is_positive_ev: ev1X >= 0,
     });
     ```
     Jika $EV < 0$ (misal $-0.05$), fungsi `Math.max(1, negative)` **tetap menghasilkan 1%**. Padahal aturan fundamental *Kelly Criterion*, bila nilai ekspektasi negatif, taruhan harus bernilai **0% (No Bet)**.
  2. Jika bookmaker odds bernilai `1.00`, ekspresi `o1X - 1` bernilai `0`, menghasilkan pembagian dengan nol (`Infinity`).
- **Solusi Kode**:
  ```typescript
  const ev1X = prob1X * o1X - 1;
  const rawKelly1X = (o1X > 1 && ev1X > 0) ? (ev1X / (o1X - 1)) * 25 : 0;
  const kellyPct1X = Math.round(Math.max(0, Math.min(5.0, rawKelly1X)) * 10) / 10;

  picks.push({
    id: "logical-dc-1x",
    market_id: mDC.market_id,
    market_name: "Double Chance (Banker)",
    category: "Utama 1X2",
    selection: `${homeTeam} atau Seri (1X)`,
    bookmaker_odds: o1X,
    fair_odds: Math.round((1 / prob1X) * 100) / 100,
    model_probability: prob1X,
    expected_value: ev1X,
    ev_percentage: `${ev1X >= 0 ? "+" : ""}${(ev1X * 100).toFixed(1)}%`,
    kelly_percentage: kellyPct1X,
    confidence_level: "SANGAT TINGGI",
    rationale: `Tingkat resistensi kekalahan tinggi: Model mengonfirmasi probabilitas 1X mencapai ${(prob1X * 100).toFixed(1)}%, opsi konservatif paling stabil.`,
    is_positive_ev: ev1X >= 0,
  });
  ```

---

### 🔴 Temuan 2: Pengecekan `prob !== undefined` Meloloskan `null` (Merender "0%")
- **File**: `components/dashboard/OddsDislocationBar.tsx` (baris ~284–288)
- **Masalah**:
  ```tsx
  {item.prob !== undefined && (
    <span className="px-2 py-0.5 rounded-[12px] text-[11px] font-bold flat-tag-zinc tabular-nums">
      {(item.prob * 100).toFixed(0)}%
    </span>
  )}
  ```
  Di JavaScript, jika `item.prob === null`, maka `null !== undefined` adalah `true`. Nilai `null * 100` dievaluasi menjadi `0`, sehingga layar menampilkan badge palsu **`0%`**, padahal datanya absen (*null/unrecorded*).
- **Solusi Kode**:
  ```tsx
  {item.prob != null && (
    <span className="px-2 py-0.5 rounded-[12px] text-[11px] font-bold flat-tag-zinc tabular-nums">
      {(item.prob * 100).toFixed(0)}%
    </span>
  )}
  ```

---

### 🟡 Temuan 3: Pengecekan xG Poisson `dcHomeXg !== undefined` Meloloskan `null` (Merender "0.00 vs 0.00")
- **File**: `components/dashboard/MatchHeaderCard.tsx` (baris ~177–180)
- **Masalah**:
  ```tsx
  {dcHomeXg !== undefined && dcAwayXg !== undefined
    ? `${Number(dcHomeXg).toFixed(2)} vs ${Number(dcAwayXg).toFixed(2)}`
    : "Terkalibrasi"}
  ```
  Jika baseline lambda/mu bernilai `null` dari API backend, `null !== undefined` bernilai `true`. Fungsi `Number(null)` menghasilkan angka `0`, sehingga UI menampilkan `"0.00 vs 0.00"` bukan tulisan `"Terkalibrasi"`.
- **Solusi Kode**:
  ```tsx
  {dcHomeXg != null && dcAwayXg != null && !Number.isNaN(Number(dcHomeXg))
    ? `${Number(dcHomeXg).toFixed(2)} vs ${Number(dcAwayXg).toFixed(2)}`
    : "Terkalibrasi"}
  ```

---

### 🟡 Temuan 4: Risiko Pembagian Nol pada Perhitungan Implied Consensus Odds
- **File**: `components/dashboard/OddsDislocationBar.tsx` (baris ~72–79)
- **Masalah**:
  ```typescript
  if (impliedProb && impliedProb.kandang > 0) {
    return {
      home: +(100 / impliedProb.kandang).toFixed(2),
      draw: +(100 / impliedProb.seri).toFixed(2),
      away: +(100 / impliedProb.tandang).toFixed(2),
      source: "Implied Consensus",
    };
  }
  ```
  Kondisi `if` hanya memvalidasi `kandang > 0`. Bila `impliedProb.seri` bernilai `0` atau `null`, `100 / 0` menghasilkan `Infinity`, dan `+(Infinity).toFixed(2)` menghasilkan `NaN`.
- **Solusi Kode**:
  ```typescript
  if (
    impliedProb &&
    impliedProb.kandang > 0 &&
    impliedProb.seri > 0 &&
    impliedProb.tandang > 0
  ) {
    return {
      home: +(100 / impliedProb.kandang).toFixed(2),
      draw: +(100 / impliedProb.seri).toFixed(2),
      away: +(100 / impliedProb.tandang).toFixed(2),
      source: "Implied Consensus",
    };
  }
  ```

---

### 🟡 Temuan 5: Resiliensi Input Modal Portofolio Terhadap Nilai `NaN`
- **File**: `components/dashboard/QuantEngineCard.tsx` (baris ~192)
- **Masalah**:
  ```tsx
  onChange={(e) => setBankroll(Math.max(0, Number(e.target.value)))}
  ```
  Saat input modal dikosongkan oleh user, `Number("")` menghasilkan `0`. Tetapi jika user mengetik karakter non-angka atau format tak valid, `Number(e.target.value)` menghasilkan `NaN`. Fungsi `Math.max(0, NaN)` bernilai `NaN`, yang menjalar ke kalkulasi nominal stake sehingga merender teks `"Rp NaN"`.
- **Solusi Kode**:
  ```tsx
  onChange={(e) => {
    const raw = Number(e.target.value);
    setBankroll(Number.isFinite(raw) && raw >= 0 ? raw : 0);
  }}
  ```

---

## 3. Identifikasi Komponen Yatim (Dead Code Hygiene)

Pasca pembaruan ke layout *Verdict-First (4 Ruang Bedah)* di v2.0, terdapat 3 komponen yang sudah **tidak diimpor atau digunakan lagi** di `app/page.tsx`:

| Nama Komponen | Lokasi File | Alasan Tidak Digunakan Lagi |
| :--- | :--- | :--- |
| `TacticalPitchCard.tsx` | `components/dashboard/TacticalPitchCard.tsx` | Visualisasi pitch 2D digantikan oleh panel metrik split performa & vonis sindikat terpadu. |
| `KellyMatrixCard.tsx` | `components/dashboard/KellyMatrixCard.tsx` | Seluruh kalkulator & simulator Kelly Criterion telah diintegrasikan langsung ke dalam `QuantEngineCard.tsx`. |
| `MarketOddsOverviewCard.tsx` | `components/dashboard/MarketOddsOverviewCard.tsx` | 4-grid bursa pasar (1X2, Asian Handicap, Total Goals, BTTS) telah diintegrasikan ke header `OddsDislocationBar.tsx`. |

> **Rekomendasi Tindakan**:  
> Simpan file-file ini di folder arsip (`components/dashboard/legacy/`) atau hapus agar tidak membebani pemindaian tipe data TypeScript dan pencarian modul.

---

## 4. Peningkatan Aksesibilitas (WCAG AA) & UX

1. **Tombol Hapus Pencarian di `FilterToolbar.tsx`**:
   Tambahkan atribut `aria-label`:
   ```tsx
   <button
     type="button"
     aria-label="Hapus pencarian"
     onClick={() => {
       setLocalSearch("");
       onSearchChange("");
     }}
     className="..."
   >
     ×
   </button>
   ```
2. **Input Slider & Number di `QuantEngineCard.tsx`**:
   Tambahkan `aria-label="Nominal modal bankroll"` pada input angka dan `aria-label="Slider penyesuaian modal bankroll"` pada input range slider.
3. **Input Match ID di `BettingScannerCard.tsx`**:
   Tambahkan `aria-label="Masukkan ID pertandingan 1xBet"`.

---

## 5. Rencana Eksekusi Bertahap (Next Steps Checklist)

Gunakan checklist ini saat ingin menerapkan perbaikan di atas:

- [ ] **Langkah 1**: Terapkan perbaikan rumus Kelly di `components/dashboard/OneXBetDeepMarketsCard.tsx`.
- [ ] **Langkah 2**: Perbaiki loose inequality `!= null` di `components/dashboard/OddsDislocationBar.tsx` dan `components/dashboard/MatchHeaderCard.tsx`.
- [ ] **Langkah 3**: Tambahkan validasi 3 arah pada `impliedProb` di `components/dashboard/OddsDislocationBar.tsx`.
- [ ] **Langkah 4**: Perbaiki penanganan `NaN` pada bankroll input di `components/dashboard/QuantEngineCard.tsx`.
- [ ] **Langkah 5**: Tambahkan `aria-label` pada tombol dan input di `FilterToolbar.tsx` dan `BettingScannerCard.tsx`.
- [ ] **Langkah 6**: Pindahkan atau hapus file yatim (`TacticalPitchCard.tsx`, `KellyMatrixCard.tsx`, `MarketOddsOverviewCard.tsx`).
- [ ] **Langkah 7**: Jalankan verifikasi otomatis:
  ```bash
  npx tsc --noEmit
  npm run build
  ```
