/**
 * WORKER PUBLIKASI — subprocess untuk tes D05/D08 (crash + paralel).
 *
 * Dijalankan suite dengan cwd = sandbox fixture; membaca spesifikasi JSON
 * dari argv[2]. Mode (argv[3]):
 *   publish                  — publishPicks penuh, cetak hasil JSON.
 *   begin-crash              — beginPublication lalu exit(3): simulasi crash
 *                              sesudah paket commit, sebelum ledger commit.
 *   publish-crash-after-commit — begin + commitPublication lalu exit(4)
 *                              TANPA melaporkan hasil: retry harus mengenali
 *                              operation key yang sudah sukses.
 * spec.barrier_file: worker menunggu file itu muncul sebelum mulai
 * (gerbang lepas bersama untuk dua worker paralel).
 * spec.ready_file: bila diisi bersama barrier_file, worker menulis
 * file ini SEBELUM menunggu — bukti tiba di gerbang yang bisa
 * diverifikasi pemanggil (ia melepas barrier hanya sesudah SEMUA
 * ready_file ada, bukan sesudah tidur tetap). Hasil mode publish
 * lalu membawa `barrier_waited_ms` sebagai bukti ikut menunggu.
 */
import fs from "node:fs";
import {
  beginPublication,
  commitPublication,
  publishPicks,
  type PublishFixtureInput,
} from "../../lib/picks/publication";

interface Spec {
  input: PublishFixtureInput;
  now: string;
  fixture_status: string;
  barrier_file?: string;
  ready_file?: string;
}

function printAndExit(obj: unknown, code: number): never {
  fs.writeSync(1, JSON.stringify(obj) + "\n");
  process.exit(code);
}

function main(): void {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Spec;
  const mode = process.argv[3] ?? "publish";
  let barrierWaitedMs: number | null = null;
  if (spec.barrier_file) {
    if (spec.ready_file) fs.writeFileSync(spec.ready_file, String(process.pid));
    const t0 = Date.now();
    const sab = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(spec.barrier_file)) {
      if (Date.now() - t0 > 30_000) process.exit(9);
      Atomics.wait(sab, 0, 0, 10);
    }
    barrierWaitedMs = Date.now() - t0;
  }
  const commitOpts = {
    now: () => spec.now,
    fixture_state: () => ({
      status: spec.fixture_status,
      kickoff_utc: spec.input.kickoff_utc,
    }),
  };
  if (mode === "begin-crash") {
    const b = beginPublication(spec.input, spec.now);
    printAndExit(b, 3);
  }
  if (mode === "publish-crash-after-commit") {
    const b = beginPublication(spec.input, spec.now);
    commitPublication(b.operation_key, commitOpts);
    process.exit(4);
  }
  const r = publishPicks(spec.input, commitOpts);
  printAndExit(
    barrierWaitedMs === null ? r : { ...r, barrier_waited_ms: barrierWaitedMs },
    0,
  );
}

main();
