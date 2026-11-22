/**
 * lib/picks/slate-identity.ts — identitas fixture FISIK untuk pick-slate
 * (Lanjut-4, branch fix/lanjut-verifikasi).
 *
 * Masalah yang diperbaiki: pick-slate mengelompokkan laga dengan
 * group_key = nama tim ternormalisasi + kickoff. Normalizer tidak
 * menyatukan ejaan alias ("ADO Den Haag" vs "Den Haag", "Dynamo Dresden"
 * vs "Dresden", "Union Saint-Gilloise" vs "St. Gilloise", "Göztepe" vs
 * "Goztep"), sehingga pasangan katalog yang SUDAH tertaut di
 * data/fixture-links.json tetap masuk slate sebagai dua laga terpisah:
 * di-rate dua kali, menulis paket + pick dua kali, dan contoh parlay
 * bisa memuat dua unit dari laga fisik yang sama (produksi 22 Nov 2026:
 * 14 pasangan; "Alternatif" berisi dua unit dc/1x Ajax). Saringan
 * kembar lama (Fase 0 R-03) hanya mencakup kelas mt_.
 *
 * Modul ini adalah satu-satunya sumber kebenaran slate untuk identitas
 * fisik, dari sumber yang sama dengan UI (fixture-links):
 *
 *   - decideSlateFixture: baris kembar (twin_id) tidak di-rate; baris
 *     kanoniknya (canonical_id) yang mewakili laga fisik. Kelas mt_
 *     mempertahankan perilaku R-03 persis (dilewati tanpa syarat);
 *     kelas lain (fd_/sm_) dilewati bila kanoniknya ikut terpindai pada
 *     run yang sama — bila kanonik tidak hadir, kembar tetap di-rate
 *     agar tidak ada kehilangan cakupan.
 *   - slateGroupKey: kunci grup berbasis identitas fisik untuk baris
 *     tertaut (`fx:<canonical_id>` — sama untuk kembar dan kanoniknya);
 *     baris tak tertaut mempertahankan formula nama warisan persis.
 *   - physicalKey(Set): dedupe titik tulis ledger berbasis laga fisik,
 *     supaya pencatatan lewat id kembar memblokir penulisan lewat id
 *     kanoniknya (dan sebaliknya) untuk laga fisik yang sama.
 *   - takeDistinctByGroup: seleksi contoh parlay "satu unit per grup"
 *     (diangkat verbatim dari pick-slate agar teruji di sini).
 *
 * Pasangan tak tertaut berperilaku persis seperti sebelum modul ini ada.
 */

import { normalizeTeamName } from "../quant/team-normalizer";

export interface SlateFixtureLink {
  twin_id: string;
  canonical_id: string;
  kickoff_utc?: string;
}

/**
 * Parse isi data/fixture-links.json secara gagal-lembut: berkas rusak /
 * bentuk tak dikenal → daftar kosong (perilaku warisan loadMtTwinMap:
 * saringan kembar dilewati, bukan ditebak).
 */
export function parseSlateLinks(text: string): SlateFixtureLink[] {
  try {
    const parsed = JSON.parse(text) as { links?: unknown };
    if (!Array.isArray(parsed.links)) return [];
    return parsed.links.filter(
      (l): l is SlateFixtureLink =>
        typeof l === "object" &&
        l !== null &&
        typeof (l as SlateFixtureLink).twin_id === "string" &&
        typeof (l as SlateFixtureLink).canonical_id === "string",
    );
  } catch {
    return [];
  }
}

/** Peta identitas fisik dari tautan fixture-links (twin → kanonik). */
export class SlateIdentity {
  private readonly twinOf = new Map<string, string>();
  private readonly canonicalTargets = new Set<string>();

  constructor(links: SlateFixtureLink[]) {
    for (const l of links) {
      this.twinOf.set(l.twin_id, l.canonical_id);
      this.canonicalTargets.add(l.canonical_id);
    }
  }

  /** Kanonik akar dari sebuah id kembar; null bila id bukan kembar. */
  canonicalOf(matchId: string): string | null {
    let cur = matchId;
    const seen = new Set<string>();
    while (this.twinOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = this.twinOf.get(cur) as string;
    }
    return cur === matchId ? null : cur;
  }

  isTwin(matchId: string): boolean {
    return this.twinOf.has(matchId);
  }

  /** True bila id ini adalah canonical_id dari setidaknya satu tautan. */
  hasTwins(matchId: string): boolean {
    return this.canonicalTargets.has(matchId);
  }

  /** True bila id ikut serta dalam tautan mana pun (kembar atau kanonik). */
  isLinked(matchId: string): boolean {
    return this.isTwin(matchId) || this.hasTwins(matchId);
  }

  /** Kunci laga fisik: kanonik akar untuk kembar, id itu sendiri selain itu. */
  physicalKey(matchId: string): string {
    return this.canonicalOf(matchId) ?? matchId;
  }

  /** Petakan sekumpulan match_id ke himpunan kunci fisiknya. */
  physicalKeySet(ids: Iterable<string>): Set<string> {
    const out = new Set<string>();
    for (const id of ids) out.add(this.physicalKey(id));
    return out;
  }
}

export type SlateFixtureDecision =
  | { action: "rate" }
  | { action: "skip"; canonical_id: string; kind: "mt-r03" | "linked" };

/**
 * Keputusan slate untuk satu baris fixture:
 *  - bukan kembar → rate.
 *  - kembar mt_ → skip selalu (Fase 0 R-03, perilaku dipertahankan).
 *  - kembar lain → skip bila kanoniknya ikut terpindai pada run ini;
 *    bila kanonik absen dari pindaian, kembar di-rate (satu-satunya
 *    wakil laga fisik yang tersedia — tidak ada kehilangan cakupan).
 */
export function decideSlateFixture(
  matchId: string,
  identity: SlateIdentity,
  scannedIds: ReadonlySet<string>,
): SlateFixtureDecision {
  const canonical = identity.canonicalOf(matchId);
  if (!canonical) return { action: "rate" };
  if (matchId.startsWith("mt_")) {
    return { action: "skip", canonical_id: canonical, kind: "mt-r03" };
  }
  if (scannedIds.has(canonical)) {
    return { action: "skip", canonical_id: canonical, kind: "linked" };
  }
  return { action: "rate" };
}

export interface SlateFixtureNames {
  match_id: string;
  home_team_name: string;
  away_team_name: string;
  utc_date: string;
}

/**
 * Kunci grup slate: baris tertaut memakai identitas fisik
 * (`fx:<kunci fisik>` — kembar dan kanoniknya berbagi kunci yang sama);
 * baris tak tertaut memakai formula warisan persis
 * (nama ternormalisasi kandang|tamu|kickoff).
 */
export function slateGroupKey(
  fx: SlateFixtureNames,
  identity: SlateIdentity,
): string {
  if (identity.isLinked(fx.match_id)) {
    return `fx:${identity.physicalKey(fx.match_id)}`;
  }
  return `${normalizeTeamName(fx.home_team_name)}|${normalizeTeamName(fx.away_team_name)}|${fx.utc_date}`;
}

/**
 * Ambil hingga n item dari pool, paling banyak satu per kunci grup,
 * melewati grup pada excludeGroups. Semantik identik dengan
 * takeDistinct lama di pick-slate (diangkat agar teruji).
 */
export function takeDistinctByGroup<T>(
  pool: readonly T[],
  n: number,
  keyOf: (item: T) => string,
  excludeGroups: ReadonlySet<string> = new Set<string>(),
): T[] {
  const used = new Set<string>(excludeGroups);
  const picked: T[] = [];
  for (const item of pool) {
    const key = keyOf(item);
    if (used.has(key)) continue;
    used.add(key);
    picked.push(item);
    if (picked.length === n) break;
  }
  return picked;
}
