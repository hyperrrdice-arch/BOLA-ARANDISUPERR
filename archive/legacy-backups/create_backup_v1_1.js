const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const backupDir = path.join(rootDir, "backup_v1.1");

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  "backup_v1",
  "backup_v1.1",
  ".git",
  ".gemini"
]);

const EXCLUDE_FILES = new Set([
  "football-agent-v1.0.0.zip",
  "football-agent-v1.1.0.zip",
  "tsconfig.tsbuildinfo"
]);

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    const base = path.basename(src);
    if (EXCLUDE_DIRS.has(base)) return;
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (stats.isFile()) {
    const base = path.basename(src);
    if (EXCLUDE_FILES.has(base)) return;
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

console.log("[Backup V1.1] Menyiapkan direktori backup_v1.1...");
if (fs.existsSync(backupDir)) {
  fs.rmSync(backupDir, { recursive: true, force: true });
}
fs.mkdirSync(backupDir, { recursive: true });

console.log("[Backup V1.1] Menyalin file sumber ke backup_v1.1/...");
const rootEntries = fs.readdirSync(rootDir);
for (const entry of rootEntries) {
  if (EXCLUDE_DIRS.has(entry) || EXCLUDE_FILES.has(entry)) continue;
  copyRecursive(path.join(rootDir, entry), path.join(backupDir, entry));
}

console.log("[Backup V1.1] Direktori backup_v1.1 berhasil dibuat!");

// Buat zip file menggunakan PowerShell Compress-Archive
const zipPath = path.join(rootDir, "football-agent-v1.1.0.zip");
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log("[Backup V1.1] Mengompresi backup_v1.1/ ke football-agent-v1.1.0.zip...");
try {
  const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${backupDir}\\*' -DestinationPath '${zipPath}' -Force"`;
  execSync(psCmd, { stdio: "inherit" });
  console.log("[Backup V1.1] File zip berhasil dibuat di:", zipPath);
} catch (e) {
  console.warn("[Backup V1.1] Peringatan kompresi PowerShell:", e.message);
}

console.log("[Backup V1.1] Selesai dengan sukses!");
