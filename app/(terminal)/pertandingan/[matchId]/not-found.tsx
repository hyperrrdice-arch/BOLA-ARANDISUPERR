import TautanKembali404 from "@/components/jadwal/TautanKembali404";

/**
 * 404 lokal untuk ID laga yang benar-benar asing (bab U3.6/U6).
 * Tautan kembali menghormati konteks asal daftar (asal + filter
 * tersanitasi) lewat komponen klien TautanKembali404 — halaman
 * not-found sendiri tidak menerima searchParams dari server.
 */
export default function LagaTidakDitemukan() {
  return (
    <div className="py-16 text-center">
      <p className="text-[17px] font-medium text-ink">Pertandingan tidak ditemukan</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
        Alamat ini tidak menunjuk pertandingan mana pun di jadwal.
      </p>
      <p className="mt-6">
        <TautanKembali404 />
      </p>
    </div>
  );
}
