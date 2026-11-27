"use client";
/**
 * TAUTAN KEMBALI 404 — tujuan kembali pada halaman Detail yang tidak
 * ditemukan (brief tindak lanjut §2.3).
 *
 * Halaman not-found tidak menerima searchParams dari server, padahal
 * konteks asal (`asal=analisa|jadwal` + filter `kembali` tersanitasi)
 * ada di URL yang sama. Komponen klien ini membaca query URL lewat
 * useSyncExternalStore (snapshot server "" → perilaku lama persis:
 * "Kembali ke jadwal" ke /pertandingan; snapshot klien membaca query
 * string URL yang gagal itu sendiri) dan menghitung tujuan dengan
 * fungsi yang PERSIS sama dengan jalur server
 * (`tujuanKembaliDariDetail`: asal hanya dari allowlist internal,
 * `kembali` disanitasi ulang lewat parseFilterJadwal). Jadi tidak ada
 * target kembali yang rusak atau keluar origin pada keadaan apa pun;
 * konteks hanya memperbaikinya bila terbukti ada di URL.
 */
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { tujuanKembaliDariDetail } from "@/lib/web/jadwal";

function langgananDiam(): () => void {
  return () => {};
}

export default function TautanKembali404() {
  const search = useSyncExternalStore(
    langgananDiam,
    () => window.location.search,
    () => "",
  );
  const sp = new URLSearchParams(search);
  const tujuan = tujuanKembaliDariDetail(sp.get("asal"), sp.get("kembali"));
  return (
    <Link
      href={tujuan.href}
      className="text-[15px] font-medium text-ink hover:text-accent"
    >
      {tujuan.label} <span className="text-accent">→</span>
    </Link>
  );
}
