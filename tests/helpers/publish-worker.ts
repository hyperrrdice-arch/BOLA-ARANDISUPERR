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
}

function printAndExit(obj: unknown, code: number): never {
  fs.writeSync(1, JSON.stringify(obj) + "\n");
  process.exit(code);
}

function main(): void {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Spec;
  const mode = process.argv[3] ?? "publish";
  if (spec.barrier_file) {
    const t0 = Date.now();
    const sab = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(spec.barrier_file)) {
      if (Date.now() - t0 > 30_000) process.exit(9);
      Atomics.wait(sab, 0, 0, 10);
    }
  }
  const commitOpts = {
    now_utc: spec.now,
    fixture_status: () => spec.fixture_status,
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
  printAndExit(r, 0);
}

main();
