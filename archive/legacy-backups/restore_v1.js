const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const backupDir = path.join(rootDir, "backup_v1");

if (!fs.existsSync(backupDir)) {
  console.error("[Restore V1] Error: Folder backup_v1 tidak ditemukan!");
  process.exit(1);
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (stats.isFile()) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
  }
}

console.log("[Restore V1] Memulai proses fallback / pemulihan ke Version 1.0.0...");
const backupEntries = fs.readdirSync(backupDir);
for (const entry of backupEntries) {
  const srcPath = path.join(backupDir, entry);
  const destPath = path.join(rootDir, entry);
  copyRecursive(srcPath, destPath);
}

console.log("[Restore V1] Pemulihan SUKSES! Seluruh file telah dikembalikan ke status Version 1.0.0.");
