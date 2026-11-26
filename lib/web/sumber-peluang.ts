/**
 * SUMBER PELUANG — proyeksi label bersama Detail laga & Pilihan (B2.2b).
 *
 * Satu-satunya tempat aturan copy basis peluang + pembanding pasar
 * diterjemahkan dari bukti BEKU pada baris pick resmi yang sama:
 * `probability_basis`, `effective_source`, `evidence_source`, dan
 * metadata quote (`odds_*`, `decision_at_utc`, `kickoff_at_issue_utc`)
 * yang dibekukan `lib/picks/publication.ts` saat terbit. Tidak ada
 * bacaan paket terbaru di sini — label selalu merujuk edisi yang
 * probabilitasnya sedang ditampilkan.
 *
 * Aturan copy (tabel brief B2.2):
 * - basis `model` ATAU `effective_source = stated-fallback`
 *     → "Peluang model saat terbit" (basis effective saja TIDAK
 *       membuktikan kalibrasi — fallback memakai angka model mentah);
 * - basis `effective` + `effective_source = lab-band`
 *     → "Peluang saat terbit" + keterangan "Disesuaikan dari uji historis";
 * - basis `effective` dengan sumber koreksi tidak tercatat
 *     → "Peluang saat terbit", tanpa klaim sudah disesuaikan;
 * - basis lama/invalid → label warisan `labelBasisPeluang` (pemanggil
 *   mempertahankan penyajian legacy-nya).
 *
 * Pembanding pasar adalah hal BERBEDA dari sumber peluang: quote
 * pra-laga dari edisi resmi yang sama, dan hanya labeli valid bila
 * lolos validasi penuh (lihat `validasiQuote`). Pembanding yang
 * tercatat tetapi metadata-nya hilang/tidak cocok/di luar cutoff →
 * "Waktu atau sumber pembanding belum terverifikasi". Ledger yang
 * menandai `model-only` dan memang tanpa pembanding → "Model saja".
 *
 * Modul murni (hanya formatter) — aman dipakai server maupun klien.
 */
import { jamWibOnly, labelBasisPeluang, labelZona, ZONA_BAKU } from "./format";

/** Bukti beku minimum dari SATU baris pick resmi. */
export interface BuktiPeluangResmi {
  probability_basis: string | null;
  effective_source: string | null;
  evidence_source: string | null;
  /** Peluang pasar pada baris (bukti pembanding tercatat di level peluang). */
  market_prob: number | null;
  /** Garis pasar baris pick; "" / null = pasar tanpa garis. */
  line: string | null;
  odds_bookmaker: string | null;
  odds_period: string | null;
  odds_line: string | null;
  odds_decimal: number | null;
  odds_captured_utc: string | null;
  decision_at_utc: string | null;
  kickoff_at_issue_utc: string | null;
}

export type KeadaanPembanding =
  | { jenis: "valid"; bookmaker: string; tercatat_utc: string }
  | { jenis: "model-saja" }
  | { jenis: "belum-terverifikasi" }
  | { jenis: "tidak-ada" };

export interface LabelSumberPeluang {
  /** "Peluang model saat terbit" | "Peluang saat terbit" | label warisan. */
  label_basis: string;
  /**
   * Keterangan basis: "Disesuaikan dari uji historis" (lab-band) atau
   * "Dihitung dari model skor." (model/fallback); null = tanpa klaim.
   */
  keterangan_basis: string | null;
  pembanding: KeadaanPembanding;
}

/** Banding garis: numerik-aware ("2.5" = "2.50"), selain itu string persis. */
function garisSama(a: string | null, b: string | null): boolean {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (x === y) return true;
  if (x === "" || y === "") return false;
  const nx = Number(x);
  const ny = Number(y);
  return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
}

/**
 * Validasi quote pembanding dari edisi resmi yang sama. Syarat:
 * bookmaker jelas; periode pra-laga ("prematch" — satu-satunya periode
 * yang dibekukan jalur publikasi untuk quote penawaran); garis cocok
 * untuk pasar bergaris (pasar tanpa garis tidak boleh membawa garis);
 * harga desimal finite > 1; dan rantai waktu
 * `odds_captured_utc <= decision_at_utc < kickoff_at_issue_utc`.
 * Tidak ada kebijakan usia maksimum quote di repo saat ini, jadi usia
 * tidak dievaluasi (dicatat jujur di laporan B2.2).
 */
function validasiQuote(
  b: BuktiPeluangResmi,
): { bookmaker: string; tercatat_utc: string } | null {
  const bookmaker = (b.odds_bookmaker ?? "").trim();
  if (bookmaker === "") return null;
  if (b.odds_period !== "prematch") return null;
  if (
    typeof b.odds_decimal !== "number" ||
    !Number.isFinite(b.odds_decimal) ||
    b.odds_decimal <= 1
  ) {
    return null;
  }
  const cap = b.odds_captured_utc ? Date.parse(b.odds_captured_utc) : NaN;
  const dec = b.decision_at_utc ? Date.parse(b.decision_at_utc) : NaN;
  const ko = b.kickoff_at_issue_utc ? Date.parse(b.kickoff_at_issue_utc) : NaN;
  if (!Number.isFinite(cap) || !Number.isFinite(dec) || !Number.isFinite(ko)) {
    return null;
  }
  if (!(cap <= dec && dec < ko)) return null;
  const garisPick = (b.line ?? "").trim();
  if (garisPick !== "") {
    if (!garisSama(b.odds_line, garisPick)) return null;
  } else if ((b.odds_line ?? "").trim() !== "") {
    return null;
  }
  return { bookmaker, tercatat_utc: b.odds_captured_utc as string };
}

/** Proyeksikan label sumber + pembanding dari bukti satu baris resmi. */
export function labelSumberPeluang(b: BuktiPeluangResmi): LabelSumberPeluang {
  let label_basis: string;
  let keterangan_basis: string | null = null;
  if (b.probability_basis === "model" || b.effective_source === "stated-fallback") {
    label_basis = "Peluang model saat terbit";
    keterangan_basis = "Dihitung dari model skor.";
  } else if (b.probability_basis === "effective" && b.effective_source === "lab-band") {
    label_basis = "Peluang saat terbit";
    keterangan_basis = "Disesuaikan dari uji historis";
  } else if (b.probability_basis === "effective") {
    // Sumber koreksi tidak tercatat → tanpa klaim sudah disesuaikan.
    label_basis = "Peluang saat terbit";
  } else {
    label_basis = labelBasisPeluang(b.probability_basis);
  }

  const quote = validasiQuote(b);
  let pembanding: KeadaanPembanding;
  if (quote) {
    pembanding = { jenis: "valid", bookmaker: quote.bookmaker, tercatat_utc: quote.tercatat_utc };
  } else {
    const adaMetadataQuote =
      [b.odds_bookmaker, b.odds_period, b.odds_line, b.odds_captured_utc].some(
        (v) => typeof v === "string" && v.trim() !== "",
      ) || typeof b.odds_decimal === "number";
    const adaBuktiPasar =
      adaMetadataQuote ||
      (typeof b.market_prob === "number" && Number.isFinite(b.market_prob)) ||
      (b.evidence_source ?? "").split("+").includes("market");
    if (adaBuktiPasar) {
      pembanding = { jenis: "belum-terverifikasi" };
    } else if (b.evidence_source === "model-only") {
      pembanding = { jenis: "model-saja" };
    } else {
      pembanding = { jenis: "tidak-ada" };
    }
  }
  return { label_basis, keterangan_basis, pembanding };
}

/**
 * Teks pembanding siap tampil. Cap waktu memakai kata "Tercatat"
 * (ledger menyimpan `available_utc` sebagai `odds_captured_utc` —
 * belum terbukti jam tangkap sebenarnya). `tidak-ada` → null (baris
 * tidak menampilkan keterangan pembanding sama sekali).
 */
export function teksPembanding(
  p: KeadaanPembanding,
  tz: string = ZONA_BAKU,
): string | null {
  switch (p.jenis) {
    case "valid":
      return `Pembanding pasar · ${p.bookmaker} · Tercatat ${jamWibOnly(p.tercatat_utc, tz)} ${labelZona(tz)}`;
    case "model-saja":
      return "Model saja";
    case "belum-terverifikasi":
      return "Waktu atau sumber pembanding belum terverifikasi";
    default:
      return null;
  }
}

/**
 * Panel arsip dipertahankan hanya bila ada minimal satu probabilitas
 * finite yang valid (0 adalah nilai sah; di luar [0,1] bukan
 * probabilitas). Panel hadir tetapi kosong/invalid → pemanggil
 * menampilkan keadaan data belum tersedia, bukan tabel berisi strip.
 */
export function panelArsipAdaNilai(
  smPanel: { probs: Record<string, number> } | null | undefined,
): boolean {
  if (!smPanel || typeof smPanel !== "object") return false;
  const probs = smPanel.probs;
  if (!probs || typeof probs !== "object") return false;
  return Object.values(probs).some(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
  );
}
