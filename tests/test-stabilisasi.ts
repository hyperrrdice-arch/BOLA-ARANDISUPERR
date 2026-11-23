/**
 * TEST:STABILISASI — brief stabilisasi watchdog (2026-11-24), opsi 1 + 6
 * diagnosis hang 2026-11-23.
 *
 * Cakupan murni + penjaga statis (tanpa server, tanpa DB):
 * - Keputusan log timing (perluLog): request lambat selalu dicatat,
 *   request normal dicatat per sampel 1-dari-N, sampleN <= 1 = semua.
 * - Format baris [timing] persis (durasi tak tersedia -> "-").
 * - Normalisasi templat rute untuk onRequestError: segmen grup rute
 *   "(...)" dibuang, segmen dinamis "[...]" dipertahankan.
 * - Penjaga /healthz: graf impor handler hanya next/server (tanpa
 *   lapisan data/SQLite/fs), kontrak no-store + 200 tertulis di kode.
 * - Penjaga pemasangan: tiga halaman prioritas memakai helper timing,
 *   instrumentation-node memakai monitorEventLoopDelay.
 *
 * Perilaku hidup (healthz cepat, urutan restart tiruan, simulasi
 * jalur data gagal) dibuktikan terpisah di panggung uji dan dicatat
 * di tasks/reports/stabilisasi-watchdog-report.md.
 *
 * Pakai: npx tsx tests/test-stabilisasi.ts
 */
import fs from "node:fs";
import path from "node:path";
import { Suite } from "./helpers/fixture-env";
import {
  formatBarisTiming,
  normalisasiTemplatRute,
  perluLog,
} from "../lib/web/timing";

const suite = new Suite("stabilisasi");
const akar = path.join(__dirname, "..");
const baca = (rel: string) => fs.readFileSync(path.join(akar, rel), "utf8");

/* ------------------------------------------------------- perluLog */
suite.check("perluLog: lambat selalu dicatat walau bukan giliran sampel",
  perluLog(2500, 2000, 100, 37) === true);
suite.check("perluLog: tepat di ambang lambat dicatat",
  perluLog(2000, 2000, 100, 37) === true);
suite.check("perluLog: normal pada giliran sampel dicatat",
  perluLog(120, 2000, 100, 200) === true);
suite.check("perluLog: normal di luar giliran sampel dilewati",
  perluLog(120, 2000, 100, 37) === false);
suite.check("perluLog: sampleN=1 mencatat semua",
  perluLog(120, 2000, 1, 37) === true);
suite.check("perluLog: sampleN=0 mencatat semua",
  perluLog(120, 2000, 0, 37) === true);
suite.check("perluLog: ambang env dihormati (lambat di 500ms bila slowMs=500)",
  perluLog(600, 500, 100, 37) === true);

/* ------------------------------------------------- format baris */
suite.eq(
  "formatBarisTiming: baris rute lengkap",
  formatBarisTiming("2026-11-24T00:00:00.000Z", "/pertandingan", 200, 1234),
  "[timing] ts=2026-11-24T00:00:00.000Z route=/pertandingan status=200 dur_ms=1234",
);
suite.eq(
  "formatBarisTiming: durasi tak tersedia menjadi '-'",
  formatBarisTiming("2026-11-24T00:00:00.000Z", "/", 500, null),
  "[timing] ts=2026-11-24T00:00:00.000Z route=/ status=500 dur_ms=-",
);
suite.check(
  "formatBarisTiming: tidak ada tempat untuk query string pada format",
  !formatBarisTiming("t", "/pertandingan", 200, 1).includes("?"),
);

/* ------------------------------------------- normalisasi templat */
suite.eq("normalisasi: grup (terminal) dibuang, [matchId] dipertahankan",
  normalisasiTemplatRute("/(terminal)/pertandingan/[matchId]"),
  "/pertandingan/[matchId]");
suite.eq("normalisasi: beranda tetap '/'",
  normalisasiTemplatRute("/"), "/");
suite.eq("normalisasi: rute api tidak berubah",
  normalisasiTemplatRute("/api/pilihan"), "/api/pilihan");
suite.eq("normalisasi: grup di tengah dibuang",
  normalisasiTemplatRute("/(terminal)/bukti"), "/bukti");
suite.eq("normalisasi: tanpa garis miring awal tetap dinormalisasi",
  normalisasiTemplatRute("(terminal)/pertandingan"), "/pertandingan");

/* ------------------------------------------------- penjaga healthz */
const healthz = baca("app/healthz/route.ts");
const imporHealthz = [...healthz.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
suite.eq("healthz: satu-satunya impor adalah next/server",
  imporHealthz, ["next/server"]);
suite.check("healthz: tidak menyentuh sqlite/fs/lapisan data",
  !/node:sqlite|node:fs|lib\/web\/data|lib\/web\/rekam/.test(healthz));
suite.check("healthz: kontrak Cache-Control no-store tertulis",
  healthz.includes('"Cache-Control": "no-store"'));
suite.check("healthz: kontrak status 200 tertulis",
  /status:\s*200/.test(healthz));

/* --------------------------------------- penjaga pemasangan timing */
for (const [rel, templat] of [
  ["app/page.tsx", '"/"'],
  ["app/(terminal)/pertandingan/page.tsx", '"/pertandingan"'],
  ["app/(terminal)/pertandingan/[matchId]/page.tsx", '"/pertandingan/[matchId]"'],
] as const) {
  const isi = baca(rel);
  suite.check(`${rel}: mengimpor helper timing`,
    isi.includes("lib/web/timing"));
  suite.check(`${rel}: mencatat templat ${templat}`,
    isi.includes(`selesaikanTimerRute(${templat}, t0Timer)`));
  suite.check(`${rel}: memulai timer sesudah connection()`,
    isi.indexOf("mulaiTimerRute()") > isi.indexOf("await connection()"));
}

const timingTs = baca("lib/web/timing.ts");
suite.check("timing.ts: tidak mengimpor lapisan data",
  !/node:sqlite|from\s+"[^"]*web\/data"|from\s+"[^"]*web\/rekam"/.test(timingTs));

const instrNode = baca("instrumentation-node.ts");
suite.check("instrumentation-node: memakai monitorEventLoopDelay",
  instrNode.includes("monitorEventLoopDelay"));
suite.check("instrumentation-node: interval diringkas per 30 detik",
  instrNode.includes("30_000"));

const instr = baca("instrumentation.ts");
suite.check("instrumentation: onRequestError mencatat lewat catatRuteError",
  instr.includes("onRequestError") && instr.includes("catatRuteError"));

suite.finish();
