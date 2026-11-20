import Link from "next/link";

/** 404 lokal untuk ID laga yang benar-benar asing (bab U3.6/U6). */
export default function LagaTidakDitemukan() {
  return (
    <div className="py-16 text-center">
      <p className="text-[17px] font-medium text-ink">Laga tidak ditemukan</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-mid-gray">
        Alamat ini tidak menunjuk pertandingan mana pun di jadwal.
      </p>
      <p className="mt-6">
        <Link href="/pertandingan" className="text-[15px] font-medium text-ink hover:text-accent">
          Kembali ke jadwal <span className="text-accent">→</span>
        </Link>
      </p>
    </div>
  );
}
