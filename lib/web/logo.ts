/**
 * LOGO — resolver aset logo kompetisi/tim berdasarkan ID kanonik
 * (Addendum Jadwal per Liga, 2026-11-23).
 *
 * Satu-satunya sumber URL adalah data/logo-assets.json (pemetaan
 * canonical_id → URL). Audit sumber yang sudah tersedia di repo:
 * registry kanonik (league/team-canonical.json) tidak membawa kolom
 * logo, DB katalog/dataset tidak punya kolom logo/crest, dan URL logo
 * feed 1xBet berkunci namespace 1xBet tanpa pemetaan ke ID kanonik
 * (logo timnya bahkan tidak tersimpan) — jadi pemetaan saat ini KOSONG
 * dan resolver mengembalikan null; permukaan merender monogram di slot
 * yang sama. Mengisi logo-assets.json di kemudian hari langsung
 * menghidupkan logo tanpa perubahan kode.
 *
 * Berkas ini murni baca-saja dan bebas impor Next supaya dapat diuji
 * langsung (pola lib/web/jadwal.ts).
 */
import fs from "node:fs";
import path from "node:path";

interface LogoAssetsFile {
  kompetisi?: Record<string, string>;
  tim?: Record<string, string>;
}

let cache: LogoAssetsFile | null = null;

function muat(): LogoAssetsFile {
  if (cache) return cache;
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "logo-assets.json"), "utf8"),
    ) as LogoAssetsFile;
    cache = { kompetisi: raw.kompetisi ?? {}, tim: raw.tim ?? {} };
  } catch {
    /* tanpa berkas pemetaan: semua logo kosong → monogram */
    cache = { kompetisi: {}, tim: {} };
  }
  return cache;
}

function bersih(url: string | undefined): string | null {
  if (typeof url !== "string") return null;
  const u = url.trim();
  return u === "" ? null : u;
}

/** URL logo kompetisi untuk ID kanonik; null = tidak ada aset → monogram. */
export function urlLogoKompetisi(canonicalId: string | null | undefined): string | null {
  if (!canonicalId) return null;
  return bersih(muat().kompetisi?.[canonicalId]);
}

/** URL logo (crest) tim untuk ID kanonik; null = tidak ada aset → monogram. */
export function urlLogoTim(canonicalId: string | null | undefined): string | null {
  if (!canonicalId) return null;
  return bersih(muat().tim?.[canonicalId]);
}

/* Monogram tinggal di modul murni bebas-fs (ikut bundel klien lewat
   Crest); diekspor ulang di sini untuk pemanggil sisi server. */
export { monogram } from "./monogram";
