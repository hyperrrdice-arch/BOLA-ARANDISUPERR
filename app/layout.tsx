import type { Metadata } from "next";
import { Archivo, Barlow_Condensed } from "next/font/google";
import "./globals.css";

/* Tipografi brief redesain §2: Archivo untuk isi/kontrol/angka
   (400/600/700 per brief; 500 ikut dimuat karena kelas font-medium
   memang terpakai lintas halaman), Barlow Condensed 700 untuk judul,
   nama tim sorotan, dan wordmark (miring untuk wordmark). Keduanya
   self-host oleh next/font dengan font-display: swap. */
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["700"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bola — jadwal, peluang, dan rekam hasil pertandingan",
  description:
    "Probabilitas pertandingan dari model terkalibrasi. Setiap pilihan tercatat sebelum sepak mula dan dinilai dari skor akhir.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${archivo.variable} ${barlow.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink selection:bg-accent selection:text-accent-ink">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-accent focus:text-accent-ink focus:text-xs focus:font-semibold"
        >
          Lewati ke isi
        </a>
        {children}
      </body>
    </html>
  );
}
