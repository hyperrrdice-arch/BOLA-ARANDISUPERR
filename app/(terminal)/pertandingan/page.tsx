/**
 * JADWAL — daftar pertandingan murni info laga (kickoff, status,
 * jadwal ulang, tim, logo, skor) dari fondasi daftar bersama
 * components/jadwal/DaftarLaga mode "jadwal". Footer halaman membawa
 * teks status penyegaran data (B2.2). Halaman ini tidak menghitung
 * model apa pun dan tidak membaca pick khusus Analisa.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import { PageLoading } from "@/components/ui";
import DaftarLaga from "@/components/jadwal/DaftarLaga";

export const metadata: Metadata = { title: "Jadwal pertandingan | Bola" };

export default function PertandinganPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageLoading label="Memuat jadwal…" />}>
      <DaftarLaga mode="jadwal" searchParams={searchParams} />
    </Suspense>
  );
}
