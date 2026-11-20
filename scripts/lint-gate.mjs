#!/usr/bin/env node
/**
 * Gerbang lint berbasis BASELINE EKSPLISIT (Fix-6 butir 6 §2).
 *
 * Kandidat mewarisi 92 error lint dari kode lama (sebagian di berkas
 * read-only yang tidak boleh diubah di kartu review ini). Daripada
 * membiarkan CI merah permanen — atau melonggarkan aturan — baseline
 * per (berkas, aturan) direkam di lint-baseline.json (ter-commit, dapat
 * diaudit). Gerbang ini GAGAL hanya bila ada error BARU:
 *   - hitungan error suatu (berkas, aturan) MELEBIHI baseline, atau
 *   - error muncul di berkas/aturan yang tidak ada di baseline.
 * Baseline MENYUSUT selalu lolos (dan dilaporkan sebagai info supaya
 * baseline bisa diperbarui saat utang lint dibayar). Warning dicatat
 * di baseline untuk audit tetapi tidak menggerbangi.
 *
 * Pakai: node scripts/lint-gate.mjs [--update]  (--update menulis ulang
 * baseline dari keadaan lint saat ini — hanya untuk pembayaran utang
 * yang disengaja, ditinjau lewat diff git.)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "lint-baseline.json");
const update = process.argv.includes("--update");

const eslintBin = path.join(root, "node_modules", "eslint", "bin", "eslint.js");
if (!existsSync(eslintBin)) {
  console.error("[lint-gate] eslint tidak ditemukan — jalankan npm ci dulu.");
  process.exit(2);
}
const run = spawnSync(process.execPath, [eslintBin, ".", "--format", "json"], {
  cwd: root,
  maxBuffer: 64 * 1024 * 1024,
  encoding: "utf8",
});
if (run.error) {
  console.error("[lint-gate] gagal menjalankan eslint:", run.error.message);
  process.exit(2);
}
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("[lint-gate] keluaran eslint bukan JSON yang sah.");
  console.error((run.stdout || "").slice(0, 500), (run.stderr || "").slice(0, 500));
  process.exit(2);
}

const files = {};
let totalErrors = 0;
let totalWarnings = 0;
for (const f of report) {
  const rel = path.relative(root, f.filePath);
  const errors = {};
  const warnings = {};
  for (const m of f.messages) {
    const rule = m.ruleId ?? "(tanpa-aturan)";
    if (m.severity === 2) {
      errors[rule] = (errors[rule] ?? 0) + 1;
      totalErrors++;
    } else if (m.severity === 1) {
      warnings[rule] = (warnings[rule] ?? 0) + 1;
      totalWarnings++;
    }
  }
  if (Object.keys(errors).length || Object.keys(warnings).length) {
    files[rel] = { errors, warnings };
  }
}

if (update) {
  const baseline = {
    version: 1,
    generated_from: "diperbarui manual via npm run lint:gate -- --update",
    tool: "eslint (npm run lint)",
    total_errors: totalErrors,
    total_warnings: totalWarnings,
    files,
  };
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  console.log(
    `[lint-gate] baseline ditulis ulang: ${totalErrors} error, ${totalWarnings} warning, ${Object.keys(files).length} berkas.`,
  );
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error("[lint-gate] lint-baseline.json tidak ada — gerbang tidak bisa menilai.");
  process.exit(2);
}
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const baru = [];
const menyusut = [];
const semuaFile = new Set([...Object.keys(baseline.files ?? {}), ...Object.keys(files)]);
for (const file of semuaFile) {
  const baseErr = baseline.files?.[file]?.errors ?? {};
  const nowErr = files[file]?.errors ?? {};
  const rules = new Set([...Object.keys(baseErr), ...Object.keys(nowErr)]);
  for (const rule of rules) {
    const b = baseErr[rule] ?? 0;
    const n = nowErr[rule] ?? 0;
    if (n > b) baru.push(`${file} ${rule}: ${b} → ${n} (+${n - b} BARU)`);
    else if (n < b) menyusut.push(`${file} ${rule}: ${b} → ${n}`);
  }
}

console.log(
  `[lint-gate] lint saat ini: ${totalErrors} error, ${totalWarnings} warning; baseline: ${baseline.total_errors} error.`,
);
for (const s of menyusut) console.log(`[lint-gate] menyusut (boleh): ${s}`);
if (baru.length > 0) {
  console.error(`[lint-gate] GAGAL — ${baru.length} error lint BARU di luar baseline:`);
  for (const s of baru) console.error(`  - ${s}`);
  console.error(
    "[lint-gate] Perbaiki error baru itu, atau (hanya untuk pembayaran utang yang disengaja) perbarui baseline dan tinjau diff-nya.",
  );
  process.exit(1);
}
console.log("[lint-gate] LOLOS — tidak ada error lint baru di luar baseline.");
