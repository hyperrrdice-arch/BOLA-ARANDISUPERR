/**
 * GET /api/pilihan — satu halaman daftar pilihan resmi pra-laga.
 *
 * Temuan #3 verifikasi produksi: halaman /pilihan tidak lagi mengirim
 * seluruh umpan + semua matriks sebagai props. Route ini menjalankan
 * saringan yang sama di server atas SELURUH umpan (pencarian menjangkau
 * hasil di luar halaman pertama) dan mengembalikan ringkasan
 * `batas` kelompok laga utuh mulai dari `offset` (kelompok), plus
 * total terfilter. Matriks tidak pernah ikut di sini.
 *
 * Parameter: kelas=AB|A|ALL, q=<teks>, tanggal=YYYY-MM-DD,
 * offset=<kelompok>, batas=<kelompok per halaman>.
 */
import { jsonResponse } from "@/lib/http-json";
import { daftarPilihanPraLaga } from "@/lib/web/rekam";
import {
  halamanUmpan,
  LAGA_PER_HALAMAN,
  type FilterUmpan,
} from "@/lib/web/pilihan-umpan";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const kelasMentah = searchParams.get("kelas") ?? "AB";
  const kelas: FilterUmpan["kelas"] =
    kelasMentah === "A" || kelasMentah === "ALL" ? kelasMentah : "AB";
  const filter: FilterUmpan = {
    kelas,
    q: searchParams.get("q") ?? "",
    tanggal: searchParams.get("tanggal") ?? "",
  };
  const offset = Math.max(0, Math.floor(Number(searchParams.get("offset")) || 0));
  const batasMentah = Math.floor(Number(searchParams.get("batas")) || LAGA_PER_HALAMAN);
  const batas = Math.min(Math.max(batasMentah, 1), 100);

  const umpan = daftarPilihanPraLaga(new Date().toISOString());
  return jsonResponse(req, halamanUmpan(umpan, filter, offset, batas));
}
