/**
 * BUILD TEAM CANONICAL — membangun acuan pakem identitas tim
 * (data/team-canonical.json), pasangan dari data/league-canonical.json.
 *
 * Perintah owner 2026-11-05: beresin KESELURUHAN database jadi satu acuan
 * pakem permanen — satu identitas resmi per tim; semua baris dari sumber
 * mana pun ngacunya ke situ; sumber masa depan wajib lewat acuan ini.
 *
 * Prinsip penggabungan (KONSERVATIF — gabung hanya bukti kuat):
 *   - Nama ternormalisasi sama (normalizeTeamName proyek, termasuk kamus
 *     alias) DAN negara tidak bertentangan → satu tim kanonik.
 *   - Nama yang muncul di ≥2 negara berbeda = nama sengketa: baris tanpa
 *     negara TIDAK ikut digabung (ditandai, diputuskan di fase resolusi).
 *   - TANPA gabung fuzzy/jarak-edit di sini. Pasangan mirip dicatat sebagai
 *     KANDIDAT di laporan (tasks/team-canonical-report.md) untuk diputuskan
 *     di fase resolusi — nama benar diputuskan dari bukti (web bila perlu).
 *
 * Id kanonik: anggota Sportmonks menang (`sm:<angka>`); selain itu id
 * sumber tertua yang ada (tm_* lalu fd_*). Nama kanonik: nama tersimpan
 * anggota SM, dinormalisasi lewat kamus alias proyek; fallback nama
 * tersimpan terbanyak.
 *
 * Pakai: npx tsx scripts/build-team-canonical.ts
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { normalizeTeamName, sanitizeString } from "../lib/quant/team-normalizer";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "data/team-canonical.json");
const REPORT = path.join(ROOT, "tasks/team-canonical-report.md");

type System = "sportmonks" | "thestats" | "football-data" | "other";
interface Member { system: System; team_id: string; name_as_stored: string }
interface CanonTeam {
  canonical_id: string;
  name: string;
  country: string | null;
  members: Member[];
  aliases: string[];
  contested_name: boolean;
}

function systemOf(teamId: string): System {
  if (/^\d+$/.test(teamId)) return "sportmonks";
  if (teamId.startsWith("tm_")) return "thestats";
  if (teamId.startsWith("fd_")) return "football-data";
  return "other";
}

/** Kunci nama longgar untuk kandidat: buang diakritik + token generik. */
function looseKey(name: string): string {
  return sanitizeString(name)
    .toLowerCase()
    .replace(/\b(fc|afc|sc|cf|club|sv|ssc|ac|as|cd|ud|rc|1899|1900|1904|04|05|09)\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function main() {
  const ds = new DatabaseSync(path.join(ROOT, "data/thestats_dataset.db"), { readOnly: true });
  const rows = ds.prepare("SELECT team_id, name, country FROM teams").all() as unknown as {
    team_id: string; name: string; country: string | null;
  }[];
  ds.close();

  // Negara yang diketahui per nama ternormalisasi (untuk deteksi sengketa).
  const countriesByName = new Map<string, Set<string>>();
  for (const r of rows) {
    const n = normalizeTeamName(r.name);
    if (!countriesByName.has(n)) countriesByName.set(n, new Set());
    if (r.country) countriesByName.get(n)!.add(r.country);
  }

  // Kelompokkan: kunci = nama ternormalisasi + (negara bila nama sengketa).
  const groups = new Map<string, { name: string; members: (typeof rows)[number][]; contested: boolean }>();
  for (const r of rows) {
    const n = normalizeTeamName(r.name);
    const contested = (countriesByName.get(n)?.size ?? 0) >= 2;
    const key = contested ? `${n}||${r.country ?? "?"}` : n;
    if (!groups.has(key)) groups.set(key, { name: n, members: [], contested });
    groups.get(key)!.members.push(r);
  }

  const teams: CanonTeam[] = [];
  for (const g of groups.values()) {
    const members: Member[] = g.members.map((m) => ({
      system: systemOf(m.team_id), team_id: m.team_id, name_as_stored: m.name,
    }));
    const sm = members.find((m) => m.system === "sportmonks");
    const tm = members.find((m) => m.system === "thestats");
    const canonical_id = sm ? `sm:${sm.team_id}` : tm ? tm.team_id : members[0].team_id;
    const baseName = sm?.name_as_stored ?? members[0].name_as_stored;
    const country =
      g.members.find((m) => m.country)?.country ?? null;
    const aliases = [...new Set(members.map((m) => m.name_as_stored))].sort();
    teams.push({
      canonical_id,
      name: normalizeTeamName(baseName),
      country,
      members,
      aliases,
      contested_name: g.contested,
    });
  }
  teams.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));

  // Kandidat pasangan mirip (TIDAK digabung): kunci longgar sama tapi beda grup.
  const byLoose = new Map<string, CanonTeam[]>();
  for (const t of teams) {
    const k = looseKey(t.name);
    if (!byLoose.has(k)) byLoose.set(k, []);
    byLoose.get(k)!.push(t);
  }
  const candidates: { loose: string; ids: string[]; names: string[] }[] = [];
  for (const [k, ts] of byLoose) {
    if (k.length >= 4 && ts.length > 1) {
      candidates.push({ loose: k, ids: ts.map((t) => t.canonical_id), names: ts.map((t) => t.name) });
    }
  }

  const merged = teams.filter((t) => t.members.length > 1);
  const multiSystem = teams.filter((t) => new Set(t.members.map((m) => m.system)).size > 1);
  const contested = teams.filter((t) => t.contested_name);
  const out = {
    version: 1,
    generated_at: new Date().toISOString(),
    generator: "scripts/build-team-canonical.ts",
    note: "Acuan pakem identitas tim: satu canonical_id per tim nyata. members = id per sistem sumber; aliases = semua bentuk nama tersimpan. Penggabungan konservatif (nama ternormalisasi sama + negara tidak bertentangan); pasangan kandidat yang belum digabung ada di tasks/team-canonical-report.md.",
    teams,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  const lines: string[] = [];
  lines.push("# Registry Kanonik Tim — Laporan Build");
  lines.push("");
  lines.push(`Dibangun: ${out.generated_at}`);
  lines.push("");
  lines.push("## Angka");
  lines.push("");
  lines.push(`- Baris tim sumber (tabel teams): **${rows.length}**`);
  lines.push(`- Tim kanonik hasil: **${teams.length}**`);
  lines.push(`- Grup tergabung (>1 baris sumber): **${merged.length}** (menyerap ${merged.reduce((s, t) => s + t.members.length - 1, 0)} baris ekstra)`);
  lines.push(`- Grup lintas sistem (>1 sumber): **${multiSystem.length}**`);
  lines.push(`- Tim bernama sengketa (≥2 negara): **${contested.length}** entri`);
  lines.push(`- Pasangan kandidat mirip BELUM digabung: **${candidates.length}**`);
  lines.push("");
  lines.push("## Contoh grup lintas sistem");
  lines.push("");
  for (const t of multiSystem.slice(0, 15)) {
    lines.push(`- \`${t.canonical_id}\` ${t.name} (${t.country ?? "?"}): ${t.members.map((m) => `${m.system}:${m.team_id}="${m.name_as_stored}"`).join(" · ")}`);
  }
  lines.push("");
  lines.push("## Kandidat mirip (keputusan fase resolusi)");
  lines.push("");
  for (const c of candidates.slice(0, 60)) {
    lines.push(`- kunci "${c.loose}": ${c.ids.map((id, i) => `\`${id}\` ${c.names[i]}`).join("  vs  ")}`);
  }
  if (candidates.length > 60) lines.push(`- …dan ${candidates.length - 60} lagi (lihat data/team-canonical.json untuk turunan penuh).`);
  lines.push("");
  fs.writeFileSync(REPORT, lines.join("\n"));

  console.log(`teams sumber=${rows.length} kanonik=${teams.length} grup-tergabung=${merged.length} lintas-sistem=${multiSystem.length} sengketa=${contested.length} kandidat=${candidates.length}`);
  console.log(`tertulis: ${OUT} + ${REPORT}`);
}

main();
