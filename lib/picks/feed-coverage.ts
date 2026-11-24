import fs from "node:fs";
import path from "node:path";
import { FD_DIVISION_CODES } from "../feeds/football-data";

// ============================================================================
// CAKUPAN FEED HASIL per kompetisi (PR 2 — data & publikasi)
// ----------------------------------------------------------------------------
// Skor baru HANYA masuk lewat satu jalur: import-free-feed mengunduh CSV
// hasil per divisi football-data.co.uk (FD_DIVISIONS, 22 divisi) pada
// setiap refresh. Arsip Sportmonks berhenti 2026-11-07 dan feed mt_
// berhenti Okt 2026 — keduanya tidak lagi membawa hasil baru (terukur
// PR 1A F7/F8 + verifikasi empiris PR 2: seluruh laga berskor sesudah
// 2026-11-07 di dataset ber-prefix fd_ dan competition_id-nya persis
// 22 kode divisi itu).
//
// Kompetisi kanonik dinyatakan BERFEED bila registri liga
// (data/league-canonical.json) memetakannya ke salah satu divisi aktif
// itu lewat alias `legacy-div` — atau ID kanoniknya sendiri adalah kode
// divisi (mis. SC1). Kompetisi yang registri kenal SUMBER-sumbernya
// (punya alias sistem apa pun) tetapi tidak satu pun terpetakan ke
// divisi aktif tidak punya jalur hasil: pick-nya yang jatuh tempo tidak
// akan pernah settle lewat jalur mana pun yang hidup hari ini. (Di
// registri produksi 250 liga: 22 berfeed, 228 bersumber-tanpa-feed,
// 0 tanpa alias sama sekali.)
//
// Klasifikasi ini KONSERVATIF dan reversibel:
//  - registri hilang/tidak terbaca → semua "tidak-diketahui" (klasifikasi
//    terminal nonaktif; perilaku lama persis — penting untuk sandbox tes);
//  - ID kompetisi tidak dikenal registri, ATAU dikenal tetapi registri
//    tidak mencatat satu pun alias sumbernya → "tidak-diketahui", BUKAN
//    "tanpa-feed": yang tidak bisa dibuktikan tidak ditebak;
//  - klasifikasi dihitung saat baca dari registri + daftar divisi aktif,
//    jadi bila feed bertambah, baris yang sama otomatis kembali pending.
// ============================================================================

export type StatusFeedKompetisi = "berfeed" | "tanpa-feed" | "tidak-diketahui";

interface RegistriLiga {
  leagues: {
    canonical_id: string;
    aliases: { system: string; id: string }[];
  }[];
}

interface KeadaanFeed {
  sig: string;
  /** Kompetisi yang registri kenal sumbernya (≥1 alias sistem tercatat). */
  bersumber: Set<string>;
  berfeed: Set<string>;
}

let cache: KeadaanFeed | null = null;

function muatKeadaanFeed(): KeadaanFeed {
  const p = path.join(process.cwd(), "data", "league-canonical.json");
  let sig = "absen";
  try {
    const s = fs.statSync(p);
    sig = `${s.mtimeMs}:${s.size}`;
  } catch {
    /* registri absen → sig tetap "absen" */
  }
  if (cache && cache.sig === sig) return cache;
  const bersumber = new Set<string>();
  const berfeed = new Set<string>();
  if (sig !== "absen") {
    try {
      const reg = JSON.parse(fs.readFileSync(p, "utf8")) as RegistriLiga;
      const divisiAktif = new Set(FD_DIVISION_CODES);
      for (const lg of reg.leagues ?? []) {
        if (!lg || typeof lg.canonical_id !== "string") continue;
        const aliases = lg.aliases ?? [];
        if (aliases.length > 0) bersumber.add(lg.canonical_id);
        const divAlias = aliases.some(
          (a) => a.system === "legacy-div" && divisiAktif.has(a.id),
        );
        if (divAlias || divisiAktif.has(lg.canonical_id)) {
          berfeed.add(lg.canonical_id);
        }
      }
    } catch {
      /* registri rusak → kedua himpunan kosong: semua tidak-diketahui */
      bersumber.clear();
      berfeed.clear();
    }
  }
  cache = { sig, bersumber, berfeed };
  return cache;
}

/**
 * Status feed hasil satu kompetisi kanonik:
 *  - "berfeed"       — terpetakan ke divisi hasil aktif;
 *  - "tanpa-feed"    — registri kenal sumber-sumbernya TETAPI tidak satu
 *                      pun terpetakan ke divisi aktif: tidak ada jalur
 *                      hasil yang hidup untuk kompetisi ini;
 *  - "tidak-diketahui" — ID null/tidak terdaftar/tanpa alias sumber/
 *                      registri tak terbaca.
 */
export function statusFeedKompetisi(
  competitionCanonicalId: string | null | undefined,
): StatusFeedKompetisi {
  if (!competitionCanonicalId) return "tidak-diketahui";
  const k = muatKeadaanFeed();
  if (k.berfeed.has(competitionCanonicalId)) return "berfeed";
  if (k.bersumber.has(competitionCanonicalId)) return "tanpa-feed";
  return "tidak-diketahui";
}

/** Sidik keadaan feed (untuk kunci cache statistik cohort). */
export function sidikFeedHasil(): string {
  const k = muatKeadaanFeed();
  return `${k.sig}#${k.berfeed.size}/${k.bersumber.size}`;
}
