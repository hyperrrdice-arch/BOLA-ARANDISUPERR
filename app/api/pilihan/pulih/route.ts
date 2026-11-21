/**
 * POST /api/pilihan/pulih — pemulihan draf pilihan di server.
 *
 * Temuan #3 verifikasi produksi: draf perangkat hanya menyimpan versi
 * + ID pilihan + kunci semantik (lib/web/draf.ts). Route ini
 * memvalidasi entri itu terhadap umpan resmi terbaru dan
 * mengembalikan baris umpan yang pulih (snapshot resmi saat terbit)
 * beserta hitungan yang hilang. Matriks TIDAK diambil di sini —
 * builder memintanya lazy lewat /api/pilihan/matriks hanya untuk laga
 * terpulih yang benar-benar digabungkan.
 *
 * Badan: { entri: [{ pickUid, kunciSemantik }] } — maksimal 12 entri
 * (batas draf produk). Bentuk badan yang rusak → 400.
 */
import { jsonResponse } from "@/lib/http-json";
import { daftarPilihanPraLaga } from "@/lib/web/rekam";
import { pulihkanDariUmpan } from "@/lib/web/pilihan-umpan";
import { MAKS_PILIHAN_DRAF, type EntriDraf } from "@/lib/web/draf";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(req, { error: "badan permintaan bukan JSON" }, { status: 400 });
  }
  const mentah = (body as { entri?: unknown } | null)?.entri;
  if (!Array.isArray(mentah)) {
    return jsonResponse(req, { error: "entri wajib berupa array" }, { status: 400 });
  }
  const entri: EntriDraf[] = [];
  for (const e of mentah.slice(0, MAKS_PILIHAN_DRAF)) {
    if (
      e !== null &&
      typeof e === "object" &&
      typeof (e as { pickUid?: unknown }).pickUid === "string" &&
      typeof (e as { kunciSemantik?: unknown }).kunciSemantik === "string"
    ) {
      entri.push({
        pickUid: (e as { pickUid: string }).pickUid,
        kunciSemantik: (e as { kunciSemantik: string }).kunciSemantik,
      });
    }
  }

  const umpan = daftarPilihanPraLaga(new Date().toISOString());
  return jsonResponse(req, pulihkanDariUmpan(entri, umpan));
}
