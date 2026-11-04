import type { Metadata } from "next";
import { Geist, Geist_Mono, Archivo_Narrow } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Archivo_Narrow({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PILIHAN AMAN — Mesin Probabilitas Sepak Bola",
  description:
    "Alat bantu menaikkan keyakinan: probabilitas terkalibrasi dari model kuantitatif deterministik, dibandingkan lintas sumber, dengan bukti hasil yang tercatat. Bukan tipster, bukan janji menang.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink selection:bg-accent selection:text-accent-ink">
        <a
          href="#konten-utama"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-accent focus:text-accent-ink focus:text-xs focus:font-bold"
        >
          Lewati ke konten utama
        </a>
        {children}
      </body>
    </html>
  );
}
