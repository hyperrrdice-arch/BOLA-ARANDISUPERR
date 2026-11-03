import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MENCARI UANG DARI PARLAY // Quant Terminal",
  description: "Pre-match tactical football analytics, Dixon-Coles quant engine & multi-agent syndicate debate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0a0a12] text-[#f4f4f6] selection:bg-[#b8b0ff] selection:text-[#17131f]">
        <a
          href="#konten-utama"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-[12px] focus:bg-[#b8b0ff] focus:text-[#17131f] focus:text-xs focus:font-bold"
        >
          Lewati ke konten utama
        </a>
        {children}
      </body>
    </html>
  );
}
