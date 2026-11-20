/**
 * PARLAY — matematika slip, murni dan deterministik.
 *
 * File ini TIDAK mengimpor Node, DB, atau modul server apa pun — aman
 * diimpor dari Client Component. Semua fungsi bekerja dari data yang
 * sudah dikirim server (probabilitas tersimpan + matriks skor paket).
 *
 * METODE GABUNGAN — dibaca apa adanya, jangan ditafsir ulang:
 * - Pilihan-pilihan dari SATU laga yang sama digabung PERSIS: jumlahkan
 *   sel matriks skor yang memenuhi SEMUA predikatnya sekaligus. Ini
 *   menangkap tumpang-tindih antar pasar (mis. "kandang menang" dan
 *   "peluang ganda 1X" berbagi sel yang sama) — mengalikan keduanya
 *   akan menghitung tumpang-tindih itu dua kali.
 * - Bila irisan satu laga TIDAK bisa dihitung persis (matriks skor
 *   edisi bersama tidak tersedia, atau pasar tak dikenal matriks),
 *   gabungannya TIDAK TERSEDIA — bukan dikalikan di dalam grup
 *   (brief redesain §3D.4; sejalan kontrak tiket resmi K3
 *   `joint_unavailable`). Grup ditandai `unavailable` + alasannya dan
 *   `combined` menjadi null.
 * - Antar laga, probabilitas grup DIKALIKAN. Itu asumsi independen:
 *   hasil satu laga dianggap tidak memengaruhi laga lain.
 * - Peringatan kejujuran: lab historis menunjukkan produk naif antar
 *   pilihan bisa melebih-lebihkan peluang bertahan slip sekitar
 *   1,5–4 poin persentase pada konteks survival. Angka di sini
 *   ditampilkan APA ADANYA beserta label metodenya — tidak dikurangi
 *   diam-diam, tidak dibulatkan ke atas.
 * - BASIS probabilitas (audit T3, 2026-11-09): setiap angka membawa basis
 *   eksplisit. "lab" = marginal terkoreksi empiris dari band lab;
 *   "model" = probabilitas model mentah (koreksi lab tak tersedia /
 *   fallback stated); "matrix" = joint eksak dari matriks skor MODEL
 *   (bukan koreksi empiris). Hasil gabungan mewarisi basis: semua grup
 *   "lab" → "lab"; semua grup model/matrix → "model"; selain itu
 *   "mixed". UI wajib menampilkan basis ini di samping angka gabungan —
 *   angka joint model tidak boleh tampil seolah kalibrasi empiris.
 */

/** Basis satu probabilitas: "lab" = terkoreksi empiris, "model" = model mentah. */
export type ProbBasis = "lab" | "model";

export interface SlipPick {
  /** Kunci unik baris pilihan (id ledger). */
  key: string;
  matchId: string;
  market: string;
  selection: string;
  /**
   * Probabilitas yang dipakai builder: probabilitas EFEKTIF (terkoreksi
   * lab) bila tersedia, jika tidak probabilitas model mentah. Basisnya
   * dinyatakan eksplisit lewat probBasis — jangan menebak dari nilainya.
   */
  prob: number;
  probBasis: ProbBasis;
  /** Matriks skor paket laga ini (indeks [gol kandang][gol tamu]), bila ada. */
  matrix?: number[][] | null;
}

export type ScorePredicate = (homeGoals: number, awayGoals: number) => boolean;

const OU_LINE: Record<string, number> = { ou15: 1.5, ou25: 2.5, ou35: 3.5 };

/**
 * Predikat sel skor untuk satu (pasar, pilihan). Selection selalu
 * lowercase. Mengembalikan null bila kombinasi tidak dikenal — pemanggil
 * wajib memperlakukannya sebagai "tidak bisa dihitung dari matriks",
 * bukan sebagai probabilitas nol.
 */
export function selectionPredicate(market: string, selection: string): ScorePredicate | null {
  const s = selection.toLowerCase();
  switch (market) {
    case "1x2":
      if (s === "1") return (h, a) => h > a;
      if (s === "x") return (h, a) => h === a;
      if (s === "2") return (h, a) => h < a;
      return null;
    case "dc":
      if (s === "1x") return (h, a) => h >= a;
      if (s === "12") return (h, a) => h !== a;
      if (s === "x2") return (h, a) => h <= a;
      return null;
    case "ou15":
    case "ou25":
    case "ou35": {
      const line = OU_LINE[market];
      if (s === "over") return (h, a) => h + a > line;
      if (s === "under") return (h, a) => h + a < line;
      return null;
    }
    case "btts":
      if (s === "yes") return (h, a) => h > 0 && a > 0;
      if (s === "no") return (h, a) => h === 0 || a === 0;
      return null;
    case "team_over05_home":
      // Hanya "yes" yang diterbitkan engine (tim cetak >= 1 gol).
      return s === "yes" ? (h) => h >= 1 : null;
    case "team_over05_away":
      return s === "yes" ? (_h, a) => a >= 1 : null;
    default:
      return null;
  }
}

/**
 * Probabilitas satu pilihan dihitung dari matriks skor: jumlah semua
 * sel yang memenuhi predikatnya. Null bila matriks/predikat tak ada.
 */
export function evaluateSelection(
  matrix: number[][] | null | undefined,
  market: string,
  selection: string,
): number | null {
  if (!matrix) return null;
  const pred = selectionPredicate(market, selection);
  if (!pred) return null;
  return sumWhere(matrix, [pred]);
}

function sumWhere(matrix: number[][], preds: ScorePredicate[]): number {
  let sum = 0;
  for (let h = 0; h < matrix.length; h++) {
    const row = matrix[h];
    if (!row) continue;
    for (let a = 0; a < row.length; a++) {
      if (preds.every((p) => p(h, a))) sum += row[a] ?? 0;
    }
  }
  return sum;
}

/** Basis probabilitas grup: "matrix" = joint eksak dari matriks model. */
export type GroupBasis = ProbBasis | "matrix" | "mixed";

export interface SlipGroup {
  matchId: string;
  /**
   * Probabilitas gabungan grup ini (persis dari matriks bila exact).
   * Null bila grup multi-pilihan satu laga tidak bisa dihitung persis
   * (`unavailable`) — tidak pernah diganti perkalian dalam grup.
   */
  prob: number | null;
  /** True bila grup multi-pilihan dihitung persis dari matriks skor. */
  exact: boolean;
  /** True bila irisan satu laga tidak tersedia (brief §3D.4). */
  unavailable: boolean;
  /** Alasan `unavailable` untuk ditampilkan ke pembaca; null bila tersedia. */
  alasan: string | null;
  /** Jumlah pilihan dalam grup. */
  count: number;
  /** Basis angka grup ini (lihat header file). */
  basis: GroupBasis;
}

export interface SlipResult {
  /**
   * Probabilitas gabungan seluruh slip. 0 bila slip kosong; null bila
   * ada grup yang irisannya tidak tersedia (`alasanGabungan` terisi).
   */
  combined: number | null;
  /** Alasan gabungan tidak tersedia (brief §3D.4); null bila tersedia. */
  alasanGabungan: string | null;
  /** True bila ada grup satu-laga multi-pilihan yang dihitung persis. */
  exactSameMatch: boolean;
  /**
   * Basis angka gabungan: "lab" bila SEMUA grup berbasis lab; "model"
   * bila semua grup model/matrix; "mixed" untuk kombinasi keduanya.
   */
  basis: ProbBasis | "mixed";
  groups: SlipGroup[];
}

/**
 * Gabungkan pilihan slip menjadi satu probabilitas.
 * Per laga: satu pilihan → probabilitas tersimpan; banyak pilihan +
 * matriks edisi bersama → persis dari matriks; banyak pilihan tanpa
 * matriks/predikat yang bisa dihitung → TIDAK TERSEDIA (brief §3D.4),
 * bukan perkalian dalam grup.
 * Antar laga: perkalian (asumsi independen — lihat header file).
 *
 * IDEMPOTENSI KEJADIAN (brief §4, redesain L2): kejadian semantik yang
 * sama dalam satu laga — (laga fisik, pasar, pilihan) — adalah SATU
 * kejadian, berapa kali pun ia sampai ke slip (mis. ditambah lewat dua
 * alias provider dari laga fisik yang sama). Duplikatnya dibuang
 * sebelum pengelompokan; kejadian tidak pernah dikuadratkan. Umpan
 * resmi menjamin duplikat yang sampai ke sini sepakat pada angka
 * terbit yang sama — yang berbeda angka ditahan sebagai konflik di
 * lapisan umpan (`daftarPilihanPraLaga`), tidak sampai ke fungsi ini.
 */
export function combineSlip(picks: SlipPick[]): SlipResult {
  if (picks.length === 0)
    return { combined: 0, alasanGabungan: null, exactSameMatch: false, basis: "model", groups: [] };

  const sudahAda = new Set<string>();
  const unik = picks.filter((p) => {
    const k = `${p.matchId}|${p.market}|${p.selection.toLowerCase()}`;
    if (sudahAda.has(k)) return false;
    sudahAda.add(k);
    return true;
  });

  const byMatch = new Map<string, SlipPick[]>();
  for (const p of unik) {
    const arr = byMatch.get(p.matchId);
    if (arr) arr.push(p);
    else byMatch.set(p.matchId, [p]);
  }

  const groups: SlipGroup[] = [];
  let combined = 1;
  let alasanGabungan: string | null = null;
  let exactSameMatch = false;

  for (const [matchId, group] of byMatch) {
    let prob: number | null;
    let exact = false;
    let unavailable = false;
    let alasan: string | null = null;
    let basis: GroupBasis;
    if (group.length === 1) {
      prob = group[0].prob;
      basis = group[0].probBasis;
    } else {
      const matrix = group.find((g) => g.matrix)?.matrix ?? null;
      const preds = group.map((g) => selectionPredicate(g.market, g.selection));
      if (matrix && preds.every((p): p is ScorePredicate => p !== null)) {
        prob = sumWhere(matrix, preds);
        exact = true;
        exactSameMatch = true;
        // Joint eksak dihitung dari matriks MODEL — basisnya "matrix",
        // bukan koreksi empiris lab, seberapa pun akuratnya penjumlahan itu.
        basis = "matrix";
      } else {
        // Brief §3D.4: tanpa matriks edisi bersama (atau ada pasar yang
        // tak bisa dihitung dari matriks), irisan satu laga tidak
        // tersedia — mengalikan di dalam grup akan menghitung
        // tumpang-tindih dua kali dan mengarang angka gabungan.
        prob = null;
        unavailable = true;
        alasan = !matrix
          ? "matriks skor tidak tersedia untuk irisan satu laga"
          : "ada pasar yang tidak bisa dihitung dari matriks skor";
        basis = group.every((g) => g.probBasis === group[0].probBasis)
          ? group[0].probBasis
          : "mixed";
      }
    }
    groups.push({ matchId, prob, exact, unavailable, alasan, count: group.length, basis });
    if (prob === null) {
      if (alasanGabungan === null) alasanGabungan = alasan;
    } else {
      combined *= prob;
    }
  }

  const kinds = new Set(groups.map((g) => g.basis));
  const basis: SlipResult["basis"] =
    kinds.size === 1 && kinds.has("lab")
      ? "lab"
      : [...kinds].every((k) => k === "model" || k === "matrix")
        ? "model"
        : "mixed";

  return {
    combined: alasanGabungan === null ? combined : null,
    alasanGabungan,
    exactSameMatch,
    basis,
    groups,
  };
}

/**
 * Gerbang waktu builder (K7, U04): sebuah laga TERKUNCI begitu sepak
 * mula tiba — pada instant T persis sudah terkunci (konsisten dengan
 * penolakan backend K2 yang menolak terbit pada T). Pilihan dari laga
 * terkunci tidak bisa ditambah; yang sudah terpilih ditandai kedaluwarsa
 * dan dikeluarkan dari estimasi aktif sampai pengguna menghapusnya.
 * Murni — jam diserahkan pemanggil supaya dapat diuji pada batas T−1/T.
 */
export function sudahMulai(kickoffUtc: string, nowMs: number): boolean {
  const ko = Date.parse(kickoffUtc);
  if (!Number.isFinite(ko)) return true; // waktu tak terbaca → kunci, jangan tebak
  return nowMs >= ko;
}
