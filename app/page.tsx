/**
 * BERANDA — satu hero AMOLED (brief frontend Beranda/Analisa/Jadwal §3).
 *
 * Halaman berakhir sesudah hero: wordmark + navigasi global di kepala,
 * lalu satu kolom terpusat — judul Archivo dua baris, subteks, CTA
 * pill "Lihat Analisa" ke /analisa, dan bola grafit statis di bawah.
 * Tidak ada pembaca data di rute ini: sorotan, jadwal berikutnya, dan
 * ringkasan hasil TIDAK lagi dirender di sini (fungsi bacanya tetap
 * hidup untuk /bukti dan tes parity); teks status penyegaran pindah
 * ke footer Jadwal. Tanpa canvas/Three.js/GSAP — gerak maksimal
 * reveal CSS singkat pada artwork, hormat prefers-reduced-motion
 * lewat override global.
 */
import Link from "next/link";
import Image from "next/image";
import { TopBar } from "../components/Nav";
import bolaGrafit from "./bola-hero-grafit.webp";

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-kertas text-tinta">
      <TopBar denganCari={false} />

      <main id="main-content" className="flex-1">
        <section className="shell-x mx-auto flex w-full max-w-[1200px] flex-col items-center pt-12 pb-[calc(52px+env(safe-area-inset-bottom)+2.5rem)] text-center sm:pt-14 md:pb-20 lg:pt-20">
          <h1 className="font-sans text-[38px] leading-[1.02] font-bold tracking-[-0.02em] text-tinta min-[390px]:text-[43px] md:text-[68px]">
            <span className="block">Baca laga.</span>
            <span className="block">Susun parlay.</span>
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-sekunder md:text-[17px]">
            Cek peluang tiap laga sebelum menyusun tiket.
          </p>
          <p className="mt-7">
            <Link
              href="/analisa"
              prefetch={false}
              className="inline-flex min-h-[48px] items-center gap-1.5 rounded-full bg-jingga px-7 text-[15px] font-semibold whitespace-nowrap text-accent-ink transition-opacity duration-[var(--duration-micro)] hover:opacity-90"
            >
              Lihat Analisa <span aria-hidden="true">›</span>
            </Link>
          </p>
          <div className="hero-masuk mt-10 lg:mt-12">
            <Image
              src={bolaGrafit}
              alt=""
              width={760}
              height={630}
              priority
              sizes="(min-width: 1024px) 520px, (min-width: 640px) 380px, 350px"
              className="h-auto w-[min(350px,92vw)] sm:w-[380px] lg:w-[520px] [@media(max-height:760px)]:w-[270px]"
            />
          </div>
        </section>
      </main>
    </div>
  );
}
