/**
 * GET /api/pilihan/matriks?paket=1,2,3 — matriks skor paket, LAZY.
 *
 * Temuan #3 verifikasi produksi: matriks hanya diambil untuk edisi
 * yang benar-benar dirujuk builder — saat menggabungkan dua kejadian
 * satu laga, atau memulihkan draf yang memuatnya. Permintaan
 * dikelompokkan (banyak id dalam satu panggilan); id yang sama tidak
 * perlu diminta ulang oleh klien (hasil dipakai ulang dari cache-nya).
 *
 * Paket tak dikenal / paket tanpa matriks → null untuk id itu (bukan
 * error): builder menerjemahkannya menjadi jalur pesan yang sudah ada,
 * "Peluang gabungan belum tersedia" untuk irisan laga itu.
 */
import { jsonResponse } from "@/lib/http-json";
import { getPackageMatrix } from "@/lib/web/data";

/** Batas id per panggilan — slip maksimal 12 pilihan, jadi 24 longgar. */
const MAKS_PAKET = 24;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const ids = [
    ...new Set(
      (searchParams.get("paket") ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ].slice(0, MAKS_PAKET);

  const matriks: Record<number, number[][] | null> = {};
  for (const id of ids) matriks[id] = getPackageMatrix(id);
  return jsonResponse(req, { matriks });
}
