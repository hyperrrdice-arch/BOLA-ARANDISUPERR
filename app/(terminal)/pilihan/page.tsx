/**
 * PILIHAN — susun gabungan dari pilihan RESMI pra-laga.
 *
 * Server Component: membaca pilihan resmi yang diterbitkan jalur
 * publikasi K2 (daftarPilihanPraLaga — pick_uid terisi, peluang terbit
 * beku, belum sepak mula), lalu menyerahkan interaksi ke ParlayBuilder
 * (klien). Angka builder adalah peluang SAAT TERBIT, bukan analisis
 * terbaru. Slip yang disusun di sini adalah draf pengguna — tidak
 * masuk rekam hasil resmi (D4); tiket resmi hidup di /bukti.
 *
 * MUATAN AWAL (temuan #3 verifikasi produksi): yang dikirim hanya
 * ringkasan 20 kelompok laga pertama filter bawaan + total terfilter
 * — NOL matriks. Halaman berikutnya, pencarian, dan perubahan
 * saringan dilayani /api/pilihan; matriks diambil lazy per paket
 * lewat /api/pilihan/matriks; pemulihan draf divalidasi server lewat
 * /api/pilihan/pulih (semua memakai lib/web/pilihan-umpan.ts).
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import ParlayBuilder from "../../../components/pilihan/ParlayBuilder";
import { PageLoading } from "../../../components/ui";
import { daftarPilihanPraLaga } from "../../../lib/web/rekam";
import { FILTER_UMPAN_BAWAAN, halamanUmpan } from "../../../lib/web/pilihan-umpan";

export const metadata: Metadata = { title: "Pilihan pra-laga | Bola" };

export default function PilihanPage() {
  return (
    <Suspense fallback={<PageLoading label="Memuat pilihan…" />}>
      <PilihanContent />
    </Suspense>
  );
}

async function PilihanContent() {
  await connection();
  const umpan = daftarPilihanPraLaga(new Date().toISOString());
  const awal = halamanUmpan(umpan, FILTER_UMPAN_BAWAAN, 0);

  return (
    <div>
      <header className="mb-10">
        <h1 className="font-display text-[2.5rem] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Pilihan pra-laga
        </h1>
        <p className="mt-2 text-[15px] text-mid-gray">
          Peluang resmi saat terbit, digabung persis dari matriks skor.
        </p>
      </header>

      <ParlayBuilder awal={awal} totalUmpan={umpan.length} />
    </div>
  );
}
