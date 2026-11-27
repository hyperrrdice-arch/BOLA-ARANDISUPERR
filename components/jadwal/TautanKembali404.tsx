"use client";
/**
 * TAUTAN KEMBALI 404 — tujuan kembali pada halaman Detail yang tidak
 * ditemukan (brief tindak lanjut §2.3).
 *
 * Halaman not-found tidak menerima searchParams dari server, padahal
 * konteks asal (`asal=analisa|jadwal` + filter `kembali` tersanitasi)
 * ada di URL yang sama. Komponen klien ini membaca query URL sesudah
 * hidrasi dan menghitung tujuan dengan fungsi yang PERSIS sama dengan
 * jalur server (`tujuanKembaliDariDetail`: asal hanya dari allowlist
 * internal, `kembali` disanitasi ulang lewat parseFilterJadwal).
 * Render awal (SSR + sebelum hidrasi) identik dengan perilaku lama —
 * "Kembali ke jadwal" ke /pertandingan — jadi tidak ada target rusak
 * pada keadaan apa pun; konteks hanya memperbaikinya bila terbukti
 * ada di URL.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { tujuanKembaliDariDetail } from "@/lib/web/jadwal";

export default function TautanKembali404() {
  const [tujuan, setTujuan] = useState<{ href: string; label: string }>({
    href: "/pertandingan",
    label: "Kembali ke jadwal",
  });
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setTujuan(tujuanKembaliDariDetail(sp.get("asal"), sp.get("kembali")));
  }, []);
  return (
    <Link
      href={tujuan.href}
      className="text-[15px] font-medium text-ink hover:text-accent"
    >
      {tujuan.label} <span className="text-accent">→</span>
    </Link>
  );
}
