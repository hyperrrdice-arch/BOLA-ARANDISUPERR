/**
 * Deklarasi modul aset gambar untuk impor statis (hero Beranda).
 *
 * `next-env.d.ts` (yang merujuk next/image-types/global) ter-generate
 * lokal dan ter-gitignore, sedangkan CI menjalankan `tsc --noEmit`
 * SEBELUM `next build` pada checkout bersih — tanpa deklarasi ini
 * impor `./bola-hero-grafit.webp` gugur TS2307 di sana. Bentuknya
 * sengaja identik dengan deklarasi bawaan Next supaya penggabungan
 * deklarasi (declaration merging) bebas konflik saat keduanya ada.
 */
declare module "*.webp" {
  const src: import("next/image").StaticImageData;
  export default src;
}
