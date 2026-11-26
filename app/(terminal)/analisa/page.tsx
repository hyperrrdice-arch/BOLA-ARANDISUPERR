/**
 * ANALISA — daftar laga berorientasi prediksi dari fondasi daftar
 * bersama components/jadwal/DaftarLaga mode "analisa": isi Jadwal
 * lama yang membawa paket/edisi terbit, peluang event, kelas, dan
 * status penilaian, dengan tata letak tanggal → grup liga → baris
 * laga yang sama dengan Jadwal. Laga tanpa prediksi resmi tetap
 * tampil bertanda "Analisa belum tersedia". Halaman ini tidak
 * menghitung model apa pun.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageLoading } from "@/components/ui";
import DaftarLaga from "@/components/jadwal/DaftarLaga";

export const metadata: Metadata = { title: "Analisa | Bola" };

export default function AnalisaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageLoading label="Memuat analisa…" />}>
      <DaftarLaga mode="analisa" searchParams={searchParams} />
    </Suspense>
  );
}
