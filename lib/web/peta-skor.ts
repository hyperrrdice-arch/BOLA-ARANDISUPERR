/**
 * PETA SKOR — logika murni peta peluang skor (brief redesain §9).
 *
 * Bebas impor Next/DB/DOM supaya seluruh angka penerimaan §9 dapat
 * diuji langsung: validasi matriks di batas data, adapter format
 * historis, jumlah kelompok dari presisi asal, cakupan tampilan,
 * format sel, navigasi keyboard, dan gerbang gerak papan skor.
 *
 * Kontrak angka (brief §9 "Menghubungkan matriks yang benar"):
 * - Tiga peluang 1X2 = jumlah seluruh sel h>a / h=a / h<a dari matriks
 *   PENUH pada presisi asalnya — bukan dari bidang tampil.
 * - Cakupan tampilan = jumlah sel h≤4 dan a≤4; sisa tampilan = jumlah
 *   semua sel di luar bidang itu. `score_matrix_tail_mass` (massa di
 *   luar grid model SEBELUM normalisasi) adalah besaran lain dan
 *   TIDAK PERNAH dijumlahkan ke sisa tampilan.
 * - Mengganti filter hanya mengganti sorotan; persen sel selalu
 *   memakai penyebut awal (total matriks).
 */
import { pct } from "./format";

/** Batas bidang tampil: gol 0..4 per sisi (lima baris × lima kolom). */
export const BATAS_TAMPIL = 4;

/* ------------------------------------------------------------ validasi */

/**
 * Matriks tervalidasi + versi format asalnya. `proporsi-ketat` =
 * total dalam 1e-6 dari 1 (paket presisi penuh); `proporsi-bulat` =
 * format historis yang membulatkan sel (total menyimpang ≤0,01 —
 * diterima apa adanya, TIDAK dinormalisasi ulang, supaya jumlah
 * kelompok mengikuti presisi asal); `per-seribu` = sel bilangan bulat
 * bagian-dari-1000 (bentuk demo/ekspor lama) — dibagi 1000.
 */
export type VersiMatriks = "proporsi-ketat" | "proporsi-bulat" | "per-seribu";

export interface MatriksValid {
  /** Proporsi per sel; baris = gol kandang, kolom = gol tamu. */
  matrix: number[][];
  versi: VersiMatriks;
}

/**
 * Periksa matriks SEKALI di batas data (kontrak K8 per brief §9):
 * array tidak kosong, panjang semua baris konsisten, ada sel, semua
 * nilai angka hingga. Proporsi: nilai dalam [0,1] dan total ≈1.
 * Per-seribu: semua sel bilangan bulat ≥0 dan total ≈1000.
 * Kosong/timpang/negatif/null/NaN/di luar rentang → null (keadaan
 * "Peta skor belum tersedia untuk laga ini."), bukan tebakan.
 */
export function adaptasiMatriks(raw: unknown): MatriksValid | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  let lebar = -1;
  let total = 0;
  let semuaBulat = true;
  let semuaProporsi = true;
  for (const baris of raw) {
    if (!Array.isArray(baris) || baris.length === 0) return null;
    if (lebar === -1) lebar = baris.length;
    else if (baris.length !== lebar) return null;
    for (const v of baris) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
      if (!Number.isInteger(v)) semuaBulat = false;
      if (v > 1) semuaProporsi = false;
      total += v;
    }
  }
  if (semuaProporsi) {
    if (Math.abs(total - 1) <= 1e-6) return { matrix: raw as number[][], versi: "proporsi-ketat" };
    if (Math.abs(total - 1) <= 0.01) return { matrix: raw as number[][], versi: "proporsi-bulat" };
    return null;
  }
  if (semuaBulat && Math.abs(total - 1000) <= 2) {
    return {
      matrix: (raw as number[][]).map((r) => r.map((v) => v / 1000)),
      versi: "per-seribu",
    };
  }
  return null;
}

/* ------------------------------------------------------------ ringkasan */

export interface SelSkor {
  h: number;
  a: number;
  p: number;
}

export interface RingkasanPeta {
  /** Total seluruh sel matriks penuh (penyebut awal; ≈1). */
  total: number;
  pKandang: number;
  pSeri: number;
  pTamu: number;
  /** Jumlah sel bidang tampil 0..4 × 0..4. */
  cakupan: number;
  /** Jumlah semua sel di luar bidang tampil (bukan tail_mass). */
  sisa: number;
  /** Seri yang jatuh pada diagonal bidang tampil (h=a≤4). */
  seriDalamPeta: number;
  /** Seri di luar bidang tampil. */
  seriLuarPeta: number;
  /** Nilai maksimum pada bidang tampil — skala batang sebelum filter. */
  maksBidang: number;
  /** Skor teratas dari matriks penuh. */
  top: SelSkor[];
}

/** Ringkasan peta dari matriks tervalidasi — semua dari presisi asal. */
export function ringkasMatriks(matrix: number[][]): RingkasanPeta {
  let total = 0;
  let pKandang = 0;
  let pSeri = 0;
  let pTamu = 0;
  let cakupan = 0;
  let seriDalamPeta = 0;
  let maksBidang = 0;
  const semua: SelSkor[] = [];
  for (let h = 0; h < matrix.length; h++) {
    for (let a = 0; a < matrix[h].length; a++) {
      const p = matrix[h][a];
      total += p;
      if (h > a) pKandang += p;
      else if (h === a) pSeri += p;
      else pTamu += p;
      if (h <= BATAS_TAMPIL && a <= BATAS_TAMPIL) {
        cakupan += p;
        if (h === a) seriDalamPeta += p;
        if (p > maksBidang) maksBidang = p;
      }
      semua.push({ h, a, p });
    }
  }
  semua.sort((x, y) => y.p - x.p || x.h - y.h || x.a - y.a);
  return {
    total,
    pKandang,
    pSeri,
    pTamu,
    cakupan,
    sisa: total - cakupan,
    seriDalamPeta,
    seriLuarPeta: pSeri - seriDalamPeta,
    maksBidang,
    top: semua.slice(0, 5),
  };
}

/** Peluang satu sel; di luar matriks → null (bukan 0 yang dikarang). */
export function peluangSel(matrix: number[][], h: number, a: number): number | null {
  const v = matrix[h]?.[a];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Format peluang sel (brief §9): nol persis → "0%"; positif di bawah
 * 0,1% → "<0,1%" (format biasa akan membulatkannya menjadi nol);
 * selain itu persen id-ID maksimal satu desimal.
 */
export function formatPeluangSel(p: number): string {
  if (p === 0) return "0%";
  if (p > 0 && p < 0.001) return "<0,1%";
  return pct(p);
}

/* --------------------------------------------------------------- filter */

export type FilterPeta = "semua" | "kandang" | "seri" | "tamu";

export const LABEL_FILTER_PETA: Record<FilterPeta, string> = {
  semua: "Semua",
  kandang: "Kandang",
  seri: "Seri",
  tamu: "Tamu",
};

/** Apakah sel (h,a) anggota himpunan filter. */
export function selDalamFilter(h: number, a: number, filter: FilterPeta): boolean {
  switch (filter) {
    case "kandang":
      return h > a;
    case "seri":
      return h === a;
    case "tamu":
      return h < a;
    default:
      return true;
  }
}

/** Semua sel bidang tampil dalam filter, peluang menurun. */
export function selFilter(matrix: number[][], filter: FilterPeta): SelSkor[] {
  const out: SelSkor[] = [];
  const hMax = Math.min(BATAS_TAMPIL, matrix.length - 1);
  for (let h = 0; h <= hMax; h++) {
    const aMax = Math.min(BATAS_TAMPIL, matrix[h].length - 1);
    for (let a = 0; a <= aMax; a++) {
      if (selDalamFilter(h, a, filter)) out.push({ h, a, p: matrix[h][a] });
    }
  }
  return out.sort((x, y) => y.p - x.p || x.h - y.h || x.a - y.a);
}

/**
 * Pilihan sesudah filter berganti (brief §9.2): pertahankan skor
 * pilihan bila masih masuk filter; bila keluar, pilih skor berpeluang
 * tertinggi di himpunan yang terlihat; himpunan kosong → null
 * (keadaannya dijelaskan, bukan dipaksakan).
 */
export function selSesuaiFilter(
  matrix: number[][],
  filter: FilterPeta,
  kini: SelSkor | { h: number; a: number } | null,
): SelSkor | null {
  if (kini && selDalamFilter(kini.h, kini.a, filter)) {
    const p = peluangSel(matrix, kini.h, kini.a);
    if (p !== null && kini.h <= BATAS_TAMPIL && kini.a <= BATAS_TAMPIL) {
      return { h: kini.h, a: kini.a, p };
    }
  }
  return selFilter(matrix, filter)[0] ?? null;
}

/* ------------------------------------------------------------- keyboard */

export type ArahSel = "kiri" | "kanan" | "atas" | "bawah";

/**
 * Sel tujuan tombol panah di bidang tampil. Pada filter Seri panah
 * berpindah DI sepanjang diagonal (brief §9.5). Pada filter lain,
 * panah melompati sel yang bukan anggota himpunan ke arah itu; bila
 * tak ada anggota lagi ke arah itu, pilihan diam.
 */
export function selTetangga(
  matrix: number[][],
  kini: { h: number; a: number },
  arah: ArahSel,
  filter: FilterPeta,
): { h: number; a: number } {
  const hMax = Math.min(BATAS_TAMPIL, matrix.length - 1);
  const aMax = Math.min(BATAS_TAMPIL, (matrix[0]?.length ?? 1) - 1);
  if (filter === "seri") {
    const d = arah === "kanan" || arah === "bawah" ? 1 : -1;
    const n = Math.max(0, Math.min(hMax, aMax, kini.h + d));
    return { h: n, a: n };
  }
  const dh = arah === "atas" ? -1 : arah === "bawah" ? 1 : 0;
  const da = arah === "kiri" ? -1 : arah === "kanan" ? 1 : 0;
  let h = kini.h;
  let a = kini.a;
  for (;;) {
    h += dh;
    a += da;
    if (h < 0 || a < 0 || h > hMax || a > aMax) return kini;
    if (selDalamFilter(h, a, filter)) return { h, a };
  }
}

/* ------------------------------------------------------ papan skor/gerak */

export interface KeadaanSkor {
  status: string;
  home: number | null;
  away: number | null;
}

/**
 * Gerbang gerak papan skor (brief §9): pembaruan resmi menggerakkan
 * papan HANYA bila skor/status benar-benar berubah. Paket polling
 * yang identik tampil diam — fungsi ini yang memutuskan, supaya
 * perilakunya bisa diuji tanpa DOM.
 */
export function perluGerakSkor(
  sebelum: KeadaanSkor | null,
  sesudah: KeadaanSkor,
): boolean {
  if (!sebelum) return true;
  return (
    sebelum.status !== sesudah.status ||
    sebelum.home !== sesudah.home ||
    sebelum.away !== sesudah.away
  );
}

/**
 * Baca sel skor akhir untuk kepala grafik: di dalam peta 0..4 →
 * "2–1 · 12,5%"; di luar peta → "5–1 · Di luar peta 0–4" dan peluang
 * persisnya bila paket memuat sel itu (brief §9.6) — TIDAK dipindah
 * ke sel tepi.
 */
export function bacaSkorAkhir(
  matrix: number[][],
  h: number,
  a: number,
): { dalamPeta: boolean; teks: string } {
  const p = peluangSel(matrix, h, a);
  const persen = p !== null ? formatPeluangSel(p) : null;
  if (h <= BATAS_TAMPIL && a <= BATAS_TAMPIL) {
    return { dalamPeta: true, teks: persen ? `${h}–${a} · ${persen}` : `${h}–${a}` };
  }
  return {
    dalamPeta: false,
    teks: persen ? `${h}–${a} · Di luar peta 0–4 · ${persen}` : `${h}–${a} · Di luar peta 0–4`,
  };
}

/* ---------------------------------------------------------------- demo */

/**
 * Matriks demo brief §9 (Persada FC vs Rawa United) — isi sel adalah
 * bagian dari 1.000. Dipakai fixture uji penerimaan; adapter
 * `per-seribu` mengubahnya menjadi proporsi.
 */
export const MATRIKS_DEMO_PER_SERIBU: number[][] = [
  [56, 60, 33, 11, 3, 1],
  [82, 151, 73, 24, 7, 2],
  [48, 125, 73, 29, 9, 2],
  [18, 53, 42, 21, 6, 1],
  [6, 18, 12, 8, 3, 1],
  [2, 7, 6, 4, 2, 1],
];
