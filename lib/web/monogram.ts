/**
 * MONOGRAM — inisial fallback crest (murni, TANPA impor Node: modul ini
 * ikut ke bundel klien lewat komponen Crest, jadi tidak boleh menyentuh
 * fs/path — resolver URL-nya tinggal di lib/web/logo.ts sisi server).
 */

/**
 * Monogram fallback: inisial huruf pertama dari dua kata pertama nama
 * (satu kata → satu huruf). Deterministik dari nama tampil; dipakai di
 * slot crest yang sama persis supaya baris tidak bergeser.
 */
export function monogram(nama: string): string {
  const kata = nama
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (kata.length === 0) return "?";
  if (kata.length === 1) return kata[0].slice(0, 1).toUpperCase();
  return (kata[0].slice(0, 1) + kata[1].slice(0, 1)).toUpperCase();
}
