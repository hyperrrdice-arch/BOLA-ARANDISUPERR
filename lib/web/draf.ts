/**
 * DRAF PILIHAN — persistensi draf pribadi pembaca (brief redesain §3D.3).
 *
 * File ini MURNI (tanpa Node/DB/DOM) supaya aturan pulihnya dapat diuji
 * langsung; akses `localStorage` yang sebenarnya tinggal di komponen
 * klien dan selalu dibungkus try/catch di sana.
 *
 * Yang disimpan di perangkat HANYA: versi format + ID pilihan resmi
 * (pick_uid) + kunci semantik kejadiannya. Angka TIDAK disimpan —
 * sesudah muat ulang, angka diambil dari snapshot umpan resmi terbaru
 * (peluang saat terbit yang dibekukan K2; analisis yang lebih baru
 * tidak mengubahnya). Itulah "validasi ulang lalu ambil snapshot asli":
 * ID, status laga, alias, dan waktu mulai diperiksa terhadap data
 * terbaru sebelum draf dipercaya lagi.
 *
 * Pemulihan dua tingkat:
 * 1. cocok lewat pick_uid persis;
 * 2. bila pick_uid tak ditemukan (perwakilan edisi berganti), cocok
 *    lewat KUNCI SEMANTIK (laga fisik + pasar + garis + pilihan) —
 *    alias provider dari laga fisik yang sama berbagi kunci ini.
 * Entri yang tak pulih lewat keduanya dihitung `hilang` (laganya sudah
 * mulai sehingga umpan tak lagi memuatnya, atau kejadiannya dicabut) —
 * pemanggil menampilkannya sebagai keterangan, bukan diam-diam.
 */

/** Kunci penyimpanan perangkat untuk draf pilihan. */
export const KUNCI_DRAF = "bola:draf-pilihan";

/** Versi format draf; naikkan bila bentuk simpanan berubah. */
export const VERSI_DRAF = 1;

/** Batas pilihan unik dalam satu draf (kebijakan produk, brief §3D.2). */
export const MAKS_PILIHAN_DRAF = 12;

/**
 * Kunci semantik satu kejadian — bentuk yang sama dengan pengelompokan
 * umpan resmi di `lib/web/rekam.ts` (laga fisik + pasar + garis +
 * pilihan). Dua alias provider dari laga yang sama menghasilkan kunci
 * yang sama, jadi menambah lewat alias kedua bersifat idempoten.
 */
export function kunciSemantikPilihan(
  fixtureUid: string,
  market: string,
  line: string,
  selection: string,
): string {
  return `${fixtureUid}|${market}|${line}|${selection}`;
}

export interface EntriDraf {
  /** ID pilihan resmi (pick_uid) saat entri disimpan. */
  pickUid: string;
  /** Kunci semantik kejadian — jangkar pemulihan tingkat dua. */
  kunciSemantik: string;
}

export interface DrafTersimpan {
  versi: number;
  entri: EntriDraf[];
}

/** Bentuk minimal pilihan yang dibutuhkan pemulihan draf. */
export interface PilihanUntukDraf {
  key: string;
  kunciSemantik: string;
}

/** Serialkan draf untuk disimpan di perangkat. */
export function serialDraf(entri: EntriDraf[]): string {
  const unik = new Map<string, EntriDraf>();
  for (const e of entri) if (!unik.has(e.kunciSemantik)) unik.set(e.kunciSemantik, e);
  const draf: DrafTersimpan = {
    versi: VERSI_DRAF,
    entri: [...unik.values()].slice(0, MAKS_PILIHAN_DRAF),
  };
  return JSON.stringify(draf);
}

/**
 * Parse simpanan perangkat. Bentuk rusak, versi tak dikenal, atau isi
 * bukan array → null (pemanggil memperlakukannya sebagai "tidak ada
 * draf", keadaan yang bisa dipahami — bukan error).
 */
export function parseDraf(json: string | null | undefined): EntriDraf[] | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<DrafTersimpan>;
    if (raw.versi !== VERSI_DRAF || !Array.isArray(raw.entri)) return null;
    const out: EntriDraf[] = [];
    const terlihat = new Set<string>();
    for (const e of raw.entri) {
      if (
        e &&
        typeof e.pickUid === "string" &&
        typeof e.kunciSemantik === "string" &&
        !terlihat.has(e.kunciSemantik)
      ) {
        terlihat.add(e.kunciSemantik);
        out.push({ pickUid: e.pickUid, kunciSemantik: e.kunciSemantik });
      }
    }
    return out.slice(0, MAKS_PILIHAN_DRAF);
  } catch {
    return null;
  }
}

export interface HasilPulihDraf<T> {
  /** Pilihan yang pulih, dalam urutan draf tersimpan. */
  pulih: T[];
  /** Jumlah entri tersimpan yang tidak lagi tersedia di umpan terbaru. */
  hilang: number;
}

/**
 * Pulihkan draf terhadap umpan terbaru: setiap entri dicocokkan lewat
 * pick_uid, lalu lewat kunci semantik. Pilihan yang pulih adalah BARIS
 * UMPAN TERBARU itu sendiri (snapshot resmi saat terbit miliknya) —
 * bukan angka yang disimpan perangkat.
 */
export function pulihkanDraf<T extends PilihanUntukDraf>(
  entri: EntriDraf[],
  pilihan: T[],
): HasilPulihDraf<T> {
  const perUid = new Map(pilihan.map((p) => [p.key, p]));
  const perKunci = new Map(pilihan.map((p) => [p.kunciSemantik, p]));
  const pulih: T[] = [];
  const sudah = new Set<string>();
  let hilang = 0;
  for (const e of entri) {
    const p = perUid.get(e.pickUid) ?? perKunci.get(e.kunciSemantik);
    if (p && !sudah.has(p.kunciSemantik)) {
      sudah.add(p.kunciSemantik);
      pulih.push(p);
    } else if (!p) {
      hilang++;
    }
  }
  return { pulih, hilang };
}
