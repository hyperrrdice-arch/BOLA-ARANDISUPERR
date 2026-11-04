/**
 * TEAM IDENTITY — resolusi tim lewat registry kanonik
 * (data/team-canonical.json, dibangun scripts/build-team-canonical.ts),
 * pasangan dari lib/quant/league-identity.ts.
 *
 * Acuan pakem identitas tim (perintah owner 2026-11-05): satu
 * canonical_id per tim nyata. Semua id sumber (Sportmonks numerik,
 * TheStats tm_*, football-data fd_*, baris sintetis standings/fixture)
 * terdaftar sebagai members; semua bentuk nama tersimpan + alias yang
 * diputuskan tercatat sebagai aliases. Konsumen TIDAK lagi menebak
 * identitas dari nama mentah atau memilih satu id namespace secara
 * arbitrer — tanya registry ini.
 */
import fs from "node:fs";
import path from "node:path";

export interface CanonicalTeam {
  canonical_id: string;
  name: string;
  country: string | null;
  members: { system: string; team_id: string; name_as_stored: string }[];
  aliases: string[];
  contested_name: boolean;
  resolution_notes?: string[];
  distinct_from?: { canonical_id: string; reason: string }[];
  name_unknown?: boolean;
}

interface CanonicalFile {
  version: number;
  teams: CanonicalTeam[];
}

let cached: CanonicalFile | null = null;
let cacheFailed = false;
let byMemberId: Map<string, string> | null = null;
let byName: Map<string, string> | null = null;

export function loadCanonicalTeams(): CanonicalTeam[] {
  if (cached) return cached.teams;
  if (cacheFailed) return [];
  try {
    const p = path.join(process.cwd(), "data/team-canonical.json");
    cached = JSON.parse(fs.readFileSync(p, "utf-8")) as CanonicalFile;
    return cached.teams;
  } catch {
    cacheFailed = true;
    return [];
  }
}

function buildIndexes(): void {
  if (byMemberId && byName) return;
  byMemberId = new Map();
  byName = new Map();
  for (const t of loadCanonicalTeams()) {
    for (const m of t.members) byMemberId.set(m.team_id, t.canonical_id);
    if (!byName.has(t.name)) byName.set(t.name, t.canonical_id);
    for (const a of t.aliases) if (!byName.has(a)) byName.set(a, t.canonical_id);
  }
}

/** Id sumber apa pun (SM numerik / tm_* / fd_* / sintetis) → canonical_id. */
export function canonicalIdForTeamId(teamId: string): string | null {
  buildIndexes();
  return byMemberId!.get(teamId) ?? null;
}

/** Nama tersimpan / alias yang diputuskan → canonical_id (exact match). */
export function canonicalIdForTeamName(name: string): string | null {
  buildIndexes();
  return byName!.get(name) ?? null;
}

/** Semua id sumber milik satu tim kanonik (untuk query lintas namespace). */
export function memberIdsForCanonical(canonicalId: string): string[] {
  const t = loadCanonicalTeams().find((x) => x.canonical_id === canonicalId);
  return t ? t.members.map((m) => m.team_id) : [];
}
