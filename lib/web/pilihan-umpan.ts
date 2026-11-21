/**
 * UMPAN PILIHAN — bentuk data bersama halaman /pilihan (temuan #3
 * verifikasi produksi: beban awal).
 *
 * Dulu halaman mengirim SELURUH pilihan resmi + matriks skor SEMUA
 * paket sebagai props serial (±3,5 MB dokumen terukur produksi).
 * Sekarang:
 * - server hanya mengirim ringkasan 20 kelompok laga pertama + total
 *   terfilter (`halamanUmpan`); halaman berikutnya dan pencarian
 *   diambil dari route /api/pilihan yang menjalankan fungsi yang sama
 *   di server atas SELURUH umpan;
 * - matriks TIDAK pernah ikut di sini — diambil lazy per paket lewat
 *   /api/pilihan/matriks hanya saat benar-benar diperlukan builder;
 * - pemulihan draf berjalan di server (`pulihkanDariUmpan` lewat
 *   /api/pilihan/pulih): entri tersimpan divalidasi terhadap umpan
 *   terbaru dengan aturan lib/web/draf.ts yang sama.
 *
 * Fungsi di file ini murni atas baris umpan `PilihanPraLaga` — aman
 * dipakai server (halaman + route) maupun klien (pengelompokan
 * halaman yang terakumulasi).
 */
import { kunciTanggal } from "./format";
import { lipatTeks } from "./jadwal";
import {
  kunciSemantikPilihan,
  pulihkanDraf,
  type EntriDraf,
} from "./draf";
import type { PilihanPraLaga } from "./rekam";

/** Satu pilihan resmi dalam bentuk yang dirender builder. */
export interface BuilderPick {
  key: string;
  /** ID provider untuk tautan detail. */
  matchId: string;
  /** UID laga fisik kanonik — kunci kelompok & hitungan laga unik. */
  fixtureUid: string;
  kickoffUtc: string;
  home: string;
  away: string;
  competitionName: string;
  gateStatus: string;
  grade: string;
  market: string;
  selection: string;
  /** Garis pasar ternormalisasi — bagian kunci semantik kejadian. */
  line: string;
  /** Peluang saat terbit (beku K2). */
  prob: number;
  /** "lab" = basis effective (koreksi lab beku); "model" = peluang model beku. */
  probBasis: "lab" | "model";
  /** Basis peluang terbit mentah dari ledger (effective/model/…) untuk label. */
  basisTerbit: string | null;
  /** Waktu terbit pilihan (ISO UTC) — ditampilkan di samping basis. */
  publishedAtUtc: string | null;
  /** Peluang model mentah, referensi. */
  modelProb: number;
  sourcesAgree: number;
  packageId: number | null;
  /**
   * Konflik edisi resmi (brief §4): >1 edisi mengaku resmi dengan angka
   * terbit berbeda. Pilihan ditahan dari gabungan sampai konflik
   * selesai; jejak nilainya ditampilkan, tidak dipilih diam-diam.
   */
  konflik?: { nilai: { prob: number; matchId: string }[] } | null;
}

/** Petakan satu baris umpan resmi ke bentuk builder (tanpa matriks). */
export function keBuilderPick(p: PilihanPraLaga): BuilderPick {
  return {
    key: p.pick_uid,
    matchId: p.match_id,
    fixtureUid: p.fixture_uid,
    kickoffUtc: p.kickoff_utc,
    home: p.home,
    away: p.away,
    competitionName: p.competition_name,
    gateStatus: p.gate_status,
    grade: p.grade,
    market: p.market,
    selection: p.selection,
    line: p.line,
    // Peluang builder = peluang SAAT TERBIT (beku K2). Basisnya memetakan
    // basis terbit: effective → koreksi lab yang dibekukan ("lab"),
    // model → peluang model saat terbit ("model").
    prob: p.published_prob,
    probBasis: p.probability_basis === "effective" ? "lab" : "model",
    basisTerbit: p.probability_basis,
    publishedAtUtc: p.published_at_utc,
    modelProb: p.model_prob,
    sourcesAgree: p.sources_agree,
    packageId: p.package_id,
    konflik: p.konflik
      ? { nilai: p.konflik.nilai.map((n) => ({ prob: n.published_prob, matchId: n.match_id })) }
      : null,
  };
}

/** Keadaan saring daftar pilihan — semantik sama persis dengan saringan klien lama. */
export interface FilterUmpan {
  /** "AB" = kelas A + B (bawaan), "A" = A saja, "ALL" = semua kelas. */
  kelas: "AB" | "A" | "ALL";
  /** Pencarian teks bebas atas nama tim/kompetisi (lipat aksen). */
  q: string;
  /** Kunci tanggal WIB (YYYY-MM-DD) atau "" untuk semua tanggal. */
  tanggal: string;
}

export const FILTER_UMPAN_BAWAAN: FilterUmpan = { kelas: "AB", q: "", tanggal: "" };

/** Saring umpan: kelas → tanggal → pencarian (menjangkau SELURUH hasil). */
export function saringUmpan(picks: PilihanPraLaga[], f: FilterUmpan): PilihanPraLaga[] {
  const keep = (g: string) =>
    f.kelas === "ALL" ? true : f.kelas === "A" ? g === "A" : g === "A" || g === "B";
  const kueri = lipatTeks(f.q).trim();
  return picks.filter((p) => {
    if (!keep(p.grade)) return false;
    if (f.tanggal && kunciTanggal(p.kickoff_utc) !== f.tanggal) return false;
    if (
      kueri &&
      ![p.home, p.away, p.competition_name].some((n) => lipatTeks(n).includes(kueri))
    )
      return false;
    return true;
  });
}

/**
 * Kelompokkan pilihan per laga fisik: urutan kelompok mengikuti
 * kemunculan pertama di umpan (umpan menaik per sepak mula); di dalam
 * kelompok, peluang terbit tertinggi lebih dulu.
 */
export function kelompokkanPilihan<T extends { fixtureUid: string; prob: number }>(
  picks: T[],
): T[][] {
  const map = new Map<string, T[]>();
  for (const p of picks) {
    const arr = map.get(p.fixtureUid);
    if (arr) arr.push(p);
    else map.set(p.fixtureUid, [p]);
  }
  return [...map.values()].map((g) => [...g].sort((a, b) => b.prob - a.prob));
}

/** Jumlah kelompok laga per halaman daftar (brief §3D.1). */
export const LAGA_PER_HALAMAN = 20;

export interface HalamanUmpan {
  /** Ringkasan pilihan pada halaman ini (kelompok utuh, tanpa matriks). */
  pilihan: BuilderPick[];
  /** Total pilihan atas SELURUH hasil terfilter. */
  totalPilihan: number;
  /** Total kelompok laga atas SELURUH hasil terfilter. */
  totalLaga: number;
}

/**
 * Satu halaman daftar dari umpan: saring seluruh hasil, kelompokkan,
 * lalu ambil `batasLaga` kelompok utuh mulai dari `offsetLaga`.
 */
export function halamanUmpan(
  umpan: PilihanPraLaga[],
  filter: FilterUmpan,
  offsetLaga: number,
  batasLaga: number = LAGA_PER_HALAMAN,
): HalamanUmpan {
  const tersaring = saringUmpan(umpan, filter).map(keBuilderPick);
  const kelompok = kelompokkanPilihan(tersaring);
  const halaman = kelompok.slice(offsetLaga, offsetLaga + batasLaga);
  return {
    pilihan: halaman.flat(),
    totalPilihan: tersaring.length,
    totalLaga: kelompok.length,
  };
}

/**
 * Pemulihan draf di server: entri tersimpan (ID + kunci semantik)
 * divalidasi terhadap umpan terbaru memakai aturan lib/web/draf.ts —
 * yang pulih adalah baris umpan terbaru itu sendiri (snapshot resmi
 * saat terbit), bukan angka dari perangkat.
 */
export function pulihkanDariUmpan(
  entri: EntriDraf[],
  umpan: PilihanPraLaga[],
): { pilihan: BuilderPick[]; hilang: number } {
  const builder = umpan.map(keBuilderPick);
  const denganKunci = builder.map((p) => ({
    ...p,
    kunciSemantik: kunciSemantikPilihan(p.fixtureUid, p.market, p.line, p.selection),
  }));
  const { pulih, hilang } = pulihkanDraf(entri, denganKunci);
  const perKey = new Map(builder.map((p) => [p.key, p]));
  const pilihan: BuilderPick[] = [];
  for (const p of pulih) {
    const asli = perKey.get(p.key);
    if (asli) pilihan.push(asli);
  }
  return { pilihan, hilang };
}
