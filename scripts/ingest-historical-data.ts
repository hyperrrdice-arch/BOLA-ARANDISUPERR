import fs from "node:fs";
import path from "node:path";
import { getMasterDb, insertBatchMatches, getDatabaseSummary, MasterMatchRow } from "../lib/db/sqlite-master";
import { normalizeTeamName } from "../lib/quant/team-normalizer";

function parseCsvDateToIso(dateStr: string): string | null {
  if (!dateStr) return null;
  const parts = dateStr.trim().split(/[/.-]/);
  if (parts.length !== 3) return null;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  // Handle 2-digit years
  if (year < 100) {
    year = year < 50 ? 2000 + year : 1900 + year;
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseNumber(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseFloat(String(val).trim());
  return isNaN(num) ? null : num;
}

function parseInteger(val: any): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseInt(String(val).trim(), 10);
  return isNaN(num) ? null : num;
}

function parseCsvLines(csvContent: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };

  const rawHeaders = lines[0].split(",").map((h) => h.trim());
  const headers = rawHeaders.map((h) => h.replace(/^["']|["']$/g, ""));

  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma tapi menghargai quotes jika ada
    const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
    if (parts.length < headers.length * 0.5) continue; // Skip baris rusak

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = parts[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

function formatSeasonLabel(seasonCode: string): string {
  if (seasonCode.length === 4) {
    const y1 = seasonCode.slice(0, 2);
    const y2 = seasonCode.slice(2, 4);
    return `20${y1}/20${y2}`;
  }
  return seasonCode;
}

async function run() {
  console.log("==================================================================");
  console.log("📦 MEMULAI INGESTI DATASET HISTORIS KE SQLITE MASTER");
  console.log("==================================================================\n");

  const db = getMasterDb();
  const rawDir = path.join(process.cwd(), "data", "historical", "raw");
  const manualDir = path.join(process.cwd(), "data", "historical");

  const filesToProcess: { filePath: string; divHint?: string; seasonHint?: string }[] = [];

  // 1. Kumpulkan file dari raw/
  if (fs.existsSync(rawDir)) {
    const rawFiles = fs.readdirSync(rawDir).filter((f) => f.endsWith(".csv"));
    for (const f of rawFiles) {
      const parts = f.replace(".csv", "").split("_");
      filesToProcess.push({
        filePath: path.join(rawDir, f),
        divHint: parts[0],
        seasonHint: parts[1],
      });
    }
  }

  // 2. Kumpulkan file manual tambahan langsung di data/historical/ (selain README)
  if (fs.existsSync(manualDir)) {
    const manualFiles = fs.readdirSync(manualDir).filter((f) => f.endsWith(".csv"));
    for (const f of manualFiles) {
      filesToProcess.push({
        filePath: path.join(manualDir, f),
      });
    }
  }

  console.log(`🔍 Ditemukan ${filesToProcess.length} file CSV untuk diproses.\n`);

  let totalParsed = 0;
  let totalInserted = 0;
  let skipped = 0;

  for (let idx = 0; idx < filesToProcess.length; idx++) {
    const item = filesToProcess[idx];
    const fileName = path.basename(item.filePath);
    process.stdout.write(`  [${idx + 1}/${filesToProcess.length}] Memproses ${fileName.padEnd(20)}... `);

    try {
      const content = fs.readFileSync(item.filePath, "utf-8");
      const { rows } = parseCsvLines(content);

      const batch: MasterMatchRow[] = [];

      for (const r of rows) {
        const div = r.Div || item.divHint || "UNKNOWN";
        const isoDate = parseCsvDateToIso(r.Date);
        const homeRaw = r.HomeTeam || r.Home || r["Home Team"];
        const awayRaw = r.AwayTeam || r.Away || r["Away Team"];
        const fthg = parseInteger(r.FTHG || r.HG || r["Full Time Home Goals"]);
        const ftag = parseInteger(r.FTAG || r.AG || r["Full Time Away Goals"]);
        const ftr = (r.FTR || r.Res || (fthg !== null && ftag !== null ? (fthg > ftag ? "H" : fthg < ftag ? "A" : "D") : "D")).toUpperCase() as "H" | "D" | "A";

        if (!isoDate || !homeRaw || !awayRaw || fthg === null || ftag === null) {
          skipped++;
          continue;
        }

        const homeTeam = normalizeTeamName(homeRaw);
        const awayTeam = normalizeTeamName(awayRaw);
        const season = item.seasonHint ? formatSeasonLabel(item.seasonHint) : "HISTORICAL";

        batch.push({
          div,
          season,
          date: isoDate,
          time: r.Time || null,
          home_team: homeTeam,
          away_team: awayTeam,
          fthg,
          ftag,
          ftr,
          hthg: parseInteger(r.HTHG),
          htag: parseInteger(r.HTAG),
          htr: r.HTR || null,
          referee: r.Referee || null,
          h_xg: parseNumber(r.HxG || r.HXG || r.HomeXG),
          a_xg: parseNumber(r.AxG || r.AXG || r.AwayXG),
          hs: parseInteger(r.HS),
          as_shots: parseInteger(r.AS),
          hst: parseInteger(r.HST),
          ast: parseInteger(r.AST),
          psh: parseNumber(r.PSH),
          psd: parseNumber(r.PSD),
          psa: parseNumber(r.PSA),
          b365h: parseNumber(r.B365H),
          b365d: parseNumber(r.B365D),
          b365a: parseNumber(r.B365A),
          max_over_2_5: parseNumber(r["Max>2.5"] || r["P>2.5"]),
          max_under_2_5: parseNumber(r["Max<2.5"] || r["P<2.5"]),
        });
      }

      totalParsed += batch.length;
      const inserted = insertBatchMatches(db, batch);
      totalInserted += inserted;

      console.log(`✅ ${batch.length} baris (Baru: ${inserted})`);
    } catch (err: any) {
      console.log(`❌ ERROR: ${err.message}`);
    }
  }

  console.log("\n==================================================================");
  console.log("📊 RINGKASAN DATABASE SQLITE MASTER:");
  const summary = getDatabaseSummary(db);
  console.log(`🏆 Total Laga Tersimpan : ${summary.totalMatches.toLocaleString()} pertandingan`);
  console.log(`✨ Total Record Baru    : ${totalInserted.toLocaleString()}`);
  if (skipped > 0) {
    console.log(`⚠️ Baris Dilewati (Kosong/Corrupt) : ${skipped.toLocaleString()}`);
  }
  console.log("------------------------------------------------------------------");
  console.log("Rincian per Divisi:");
  for (const s of summary.divStats) {
    console.log(`  - [${s.div.padEnd(4)}] : ${String(s.count).padStart(5)} laga (${s.earliestDate} s/d ${s.latestDate})`);
  }
  console.log("==================================================================\n");
}

run().catch((err) => {
  console.error("FATAL ERROR INGEST:", err);
  process.exit(1);
});
