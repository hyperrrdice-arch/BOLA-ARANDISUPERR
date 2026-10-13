import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "data", "historical", "raw");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Konfigurasi Divisi & Nama Resmi
const LEAGUES = [
  // Top 5 Liga Utama
  { code: "E0", name: "English Premier League", country: "England" },
  { code: "SP1", name: "Spanish La Liga", country: "Spain" },
  { code: "I1", name: "Italian Serie A", country: "Italy" },
  { code: "D1", name: "German Bundesliga", country: "Germany" },
  { code: "F1", name: "French Ligue 1", country: "France" },

  // Kasta Kedua (Promosi / Degradasi)
  { code: "E1", name: "English Championship", country: "England" },
  { code: "SP2", name: "Spanish Segunda Division", country: "Spain" },
  { code: "I2", name: "Italian Serie B", country: "Italy" },
  { code: "D2", name: "German 2. Bundesliga", country: "Germany" },
  { code: "F2", name: "French Ligue 2", country: "France" },

  // Liga Utama Eropa Lainnya
  { code: "N1", name: "Dutch Eredivisie", country: "Netherlands" },
  { code: "B1", name: "Belgian First Division A", country: "Belgium" },
  { code: "P1", name: "Portuguese Primeira Liga", country: "Portugal" },
  { code: "SC0", name: "Scottish Premiership", country: "Scotland" },
  { code: "T1", name: "Turkish Super Lig", country: "Turkey" },
  { code: "G1", name: "Greek Super League", country: "Greece" },
];

// Musim yang diunduh (4 Musim Terakhir)
const SEASONS = [
  { code: "2425", label: "2024/2025" },
  { code: "2324", label: "2023/2024" },
  { code: "2223", label: "2022/2023" },
  { code: "2122", label: "2021/2022" },
];

const BASE_URL = "https://www.football-data.co.uk/mmz4281";

async function fetchWithRetry(url, retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/csv,text/plain,*/*",
        },
      });
      if (res.status === 200) {
        const text = await res.text();
        if (text && text.length > 500 && text.includes(",")) {
          return text;
        }
      }
      if (res.status === 404) {
        return null; // File memang tidak tersedia
      }
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

function countRows(csvText) {
  const lines = csvText.trim().split("\n");
  // Baris pertama header, sisa baris data
  return Math.max(0, lines.length - 1);
}

async function run() {
  console.log("==================================================================");
  console.log("🚀 MEMULAI DOWNLOAD DATASET HISTORIS FOOTBALL-DATA.CO.UK");
  console.log(`📁 Direktori Output: ${outputDir}`);
  console.log(`🏆 Total Liga: ${LEAGUES.length} | 📅 Total Musim: ${SEASONS.length}`);
  console.log("==================================================================\n");

  let totalDownloaded = 0;
  let totalMatches = 0;
  let totalBytes = 0;
  let skipped = 0;

  for (const season of SEASONS) {
    console.log(`\n📅 Memproses Musim: ${season.label} (Kode: ${season.code})...`);
    console.log("------------------------------------------------------------------");

    for (const league of LEAGUES) {
      const url = `${BASE_URL}/${season.code}/${league.code}.csv`;
      const fileName = `${league.code}_${season.code}.csv`;
      const filePath = path.join(outputDir, fileName);

      process.stdout.write(`  [${league.code}] ${league.name.padEnd(28)}: Mengunduh... `);

      try {
        const csvContent = await fetchWithRetry(url);

        if (!csvContent) {
          console.log(`⚠️ TIDAK DITEMUKAN (404/Kosong)`);
          skipped++;
          continue;
        }

        fs.writeFileSync(filePath, csvContent, "utf-8");
        const rows = countRows(csvContent);
        const bytes = Buffer.byteLength(csvContent);

        totalDownloaded++;
        totalMatches += rows;
        totalBytes += bytes;

        console.log(`✅ OK (${rows} match, ${(bytes / 1024).toFixed(1)} KB)`);
      } catch (err) {
        console.log(`❌ GAGAL: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log("\n==================================================================");
  console.log("🎉 PROSES DOWNLOAD SELESAI!");
  console.log(`✅ Berhasil diunduh : ${totalDownloaded} file CSV`);
  console.log(`📊 Estimasi Total Laga : ${totalMatches.toLocaleString()} pertandingan`);
  console.log(`💾 Total Ukuran Data  : ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
  if (skipped > 0) {
    console.log(`ℹ️ Dilewati / 404   : ${skipped} file (divisi tidak tersedia di musim tertentu)`);
  }
  console.log(`📁 File tersimpan di : ${outputDir}`);
  console.log("==================================================================\n");
}

run().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
