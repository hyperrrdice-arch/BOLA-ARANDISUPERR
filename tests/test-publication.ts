/**
 * SUITE PUBLIKASI — D05–D08 (PRD bab QA, kartu K2).
 *
 * Semua skenario berjalan lewat jalur produksi sebenarnya (beginPublication /
 * commitPublication / publishPicks / writePackage / recordOutcome /
 * cohortStats) dengan jam terinjeksi; crash dan paralelisme memakai worker
 * subprocess (tests/helpers/publish-worker.ts) pada DB sandbox yang sama.
 *
 *   D05 cutoff saat commit · D06 snapshot terbit vs terbaru + warisan ·
 *   D07 statistik cohort · D08 odds yang ditawarkan + crash/retry.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  openRo,
  runScript,
  settleFixtureEnv,
} from "./helpers/fixture-env";

const suite = new Suite("publication D05–D08");

const T = "2026-11-20T13:00:00.000Z"; // kickoff bersama acceptance.json
const DECISION = "2026-11-20T10:30:00.000Z";
const CUTOFF = "2026-11-20T10:00:00.000Z";

async function main(): Promise<void> {
  const env = createFixtureEnv("pub");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const pub = await import("../lib/picks/publication");
  const packages = await import("../lib/picks/packages");
  const cohort = await import("../lib/picks/cohort");
  const migration = await import("../lib/picks/publication-migration");
  const resolver = await import("../lib/identity/fixture-resolver");

  const picksCountFor = (matchId: string): number =>
    (
      openRo(env, "picks.db")
        .prepare("SELECT COUNT(*) AS n FROM picks WHERE match_id = ?")
        .get(matchId) as { n: number }
    ).n;
  const packagesCountFor = (matchId: string): number =>
    (
      openRo(env, "analysis_snapshots.db")
        .prepare("SELECT COUNT(*) AS n FROM packages WHERE match_id = ?")
        .get(matchId) as { n: number }
    ).n;

  let seq = 0;
  const makeInput = (
    over: Partial<import("../lib/picks/publication").PublishFixtureInput> = {},
    legOver: Partial<import("../lib/picks/publication").PublishLegInput> = {},
  ): import("../lib/picks/publication").PublishFixtureInput => {
    seq++;
    const matchId = `fx_t${seq}`;
    const leg: import("../lib/picks/publication").PublishLegInput = {
      market: "1x2",
      selection: "1",
      model_prob: 0.79,
      effective_prob: 0.74,
      effective_source: "lab-band",
      market_prob: 0.7,
      sm_prob: 0.72,
      grade: "B",
      gate_status: "calibrated",
      ...legOver,
    };
    return {
      series: "live-run",
      source_match_id: matchId,
      fixture_uid: `uid-${matchId}`,
      competition_canonical_id: "eng-premier",
      kickoff_utc: T,
      scheduled_cutoff_utc: CUTOFF,
      decision_at_utc: DECISION,
      model_version: "quant-package-v1",
      ratings_hash: "sha256:test",
      package: {
        trigger: "slate",
        gate_status: "calibrated",
        odds_captured_utc: "2026-11-20T09:00:00.000Z",
        payload: {
          kind: "quant-package",
          version: 1,
          legs: [
            {
              market: leg.market,
              selection: leg.selection,
              model_prob: leg.model_prob,
              effective_prob: leg.effective_prob ?? null,
            },
          ],
        },
      },
      legs: [leg],
      ...over,
    };
  };
  const scheduled = () => "scheduled";
  /**
   * Opsi commit dengan jam tetap + keadaan fixture tetap — semantik
   * pemanggil D05 yang lama (terbit di T−1 diterima, di T/T+1 ditolak),
   * kini lewat fungsi jam terinjeksi (review K8 butir 3A).
   */
  const optsAt = (
    nowIso: string,
    status: string | null = "scheduled",
    kickoff: string | null = T,
  ): import("../lib/picks/publication").CommitOptions => ({
    now: () => nowIso,
    fixture_state: () => ({ status, kickoff_utc: kickoff }),
  });

  // ======================================================================
  console.log("\n— D05: cutoff divalidasi saat COMMIT —");
  // ======================================================================
  {
    // T−1ms diterima.
    const inp = makeInput();
    const r = pub.publishPicks(inp, optsAt("2026-11-20T12:59:59.999Z"));
    suite.eq("D05 publish T-1ms diterima", r.status, "published");
    suite.eq("D05 T-1ms menulis 1 pick", picksCountFor(inp.source_match_id), 1);

    // Tepat T ditolak.
    const inpT = makeInput();
    const rT = pub.publishPicks(inpT, optsAt(T));
    suite.eq("D05 publish tepat T ditolak", rT.status, "rejected_cutoff");
    suite.eq("D05 tepat T: 0 pick", picksCountFor(inpT.source_match_id), 0);
    suite.eq(
      "D05 tepat T: paket tetap ada (analisis internal)",
      packagesCountFor(inpT.source_match_id),
      1,
    );

    // T+1ms ditolak.
    const inpT1 = makeInput();
    const rT1 = pub.publishPicks(inpT1, optsAt("2026-11-20T13:00:00.001Z"));
    suite.eq("D05 publish T+1ms ditolak", rT1.status, "rejected_cutoff");
    suite.eq("D05 T+1ms: 0 pick", picksCountFor(inpT1.source_match_id), 0);

    // Mulai sebelum T, commit lewat T → ditolak.
    const inpLate = makeInput();
    const begun = pub.beginPublication(inpLate, "2026-11-20T12:00:00.000Z");
    suite.eq("D05 begin sebelum T: paket tertulis", begun.state, "package_written");
    const rLate = pub.commitPublication(begun.operation_key, optsAt("2026-11-20T13:00:00.001Z"));
    suite.eq("D05 commit lewat T ditolak", rLate.status, "rejected_cutoff");
    suite.eq("D05 commit lewat T: 0 pick", picksCountFor(inpLate.source_match_id), 0);
    suite.eq(
      "D05 commit lewat T: paket tetap ada",
      packagesCountFor(inpLate.source_match_id),
      1,
    );

    // decision_at sesudah published_at → ditolak.
    const inpFut = makeInput({}, {});
    inpFut.decision_at_utc = "2026-11-20T12:30:00.000Z";
    inpFut.package.computed_utc = "2026-11-20T12:30:00.000Z";
    const rFut = pub.publishPicks(inpFut, optsAt("2026-11-20T12:00:00.000Z"));
    suite.eq("D05 decision>publish ditolak", rFut.status, "rejected_cutoff");
    suite.eq("D05 decision>publish: alasan", rFut.reason, "decision_after_publish");

    // Status fixture berubah sebelum commit → ditolak.
    const inpFlip = makeInput();
    const begunFlip = pub.beginPublication(inpFlip, "2026-11-20T11:00:00.000Z");
    const rFlip = pub.commitPublication(begunFlip.operation_key, optsAt("2026-11-20T12:00:00.000Z", "finished"));
    suite.eq("D05 status berubah ditolak", rFlip.status, "rejected_cutoff");
    suite.check(
      "D05 status berubah: alasan fixture_not_scheduled",
      (rFlip.reason ?? "").startsWith("fixture_not_scheduled"),
      rFlip.reason,
    );
    suite.eq("D05 status berubah: 0 pick", picksCountFor(inpFlip.source_match_id), 0);
  }

  // ---- Worker paralel: dua kombinasi identik bersamaan → satu kelompok.
  interface WorkerOut {
    code: number;
    json: Record<string, unknown> | null;
    stderr: string;
  }
  const runWorker = (
    specFile: string,
    mode: string,
  ): Promise<WorkerOut> =>
    new Promise((resolve) => {
      const tsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
      const child = spawn(
        tsx,
        [path.join(REPO_ROOT, "tests/helpers/publish-worker.ts"), specFile, mode],
        {
          cwd: env.root,
          env: { ...process.env, TZ: "UTC" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => {
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(out.trim().split("\n").pop() ?? "");
        } catch {
          json = null;
        }
        resolve({ code: code ?? 1, json, stderr: err });
      });
    });
  const writeSpec = (
    name: string,
    input: unknown,
    now: string,
    extra: Record<string, unknown> = {},
  ): string => {
    const p = path.join(env.root, `${name}.json`);
    fs.writeFileSync(
      p,
      JSON.stringify({ input, now, fixture_status: "scheduled", ...extra }),
    );
    return p;
  };

  {
    const inp = makeInput();
    const goFile = path.join(env.root, "go-d05");
    const spec = writeSpec("spec-d05", inp, "2026-11-20T12:00:00.000Z", {
      barrier_file: goFile,
    });
    const w1 = runWorker(spec, "publish");
    const w2 = runWorker(spec, "publish");
    await new Promise((r) => setTimeout(r, 700));
    fs.writeFileSync(goFile, "go");
    const [a, b] = await Promise.all([w1, w2]);
    suite.eq("D05 paralel: worker A exit 0", a.code, 0);
    suite.eq("D05 paralel: worker B exit 0", b.code, 0);
    suite.eq(
      "D05 paralel: operation key sama",
      a.json?.operation_key,
      b.json?.operation_key,
    );
    suite.eq(
      "D05 paralel: pick ids sama",
      a.json?.pick_ids,
      b.json?.pick_ids,
    );
    suite.check(
      "D05 paralel: status terbit/komit",
      ["published", "already_committed"].includes(String(a.json?.status)) &&
        ["published", "already_committed"].includes(String(b.json?.status)),
      `${a.json?.status}/${b.json?.status}`,
    );
    suite.eq(
      "D05 paralel: tepat 1 pick resmi",
      picksCountFor(inp.source_match_id),
      1,
    );
    const intents = openRo(env, "picks.db")
      .prepare(
        "SELECT COUNT(*) AS n FROM publication_intents WHERE operation_key = ?",
      )
      .get(String(a.json?.operation_key)) as { n: number };
    suite.eq("D05 paralel: tepat 1 intent", intents.n, 1);
  }

  // ======================================================================
  console.log("\n— D05-R: jam dibaca ulang di dalam lock (review K8 butir 3A) —");
  // ======================================================================
  {
    // (1) Pembacaan status otoritatif lambat: selesai 100 ms SESUDAH
    // kickoff walau statusnya masih mengaku scheduled, sementara jam
    // saat commit dimulai masih T−400 ms. Kode lama memvalidasi cap
    // T−400 itu dan menerbitkan; jalur baru membaca jam TERAKHIR, di
    // dalam lock, sesudah status dibaca → ditolak, NOL pick resmi.
    const inpSlow = makeInput();
    let clockSlow = "2026-11-20T12:59:59.600Z";
    const begunSlow = pub.beginPublication(inpSlow, clockSlow);
    const rSlow = pub.commitPublication(begunSlow.operation_key, {
      now: () => clockSlow,
      fixture_state: () => {
        clockSlow = "2026-11-20T13:00:00.100Z";
        return { status: "scheduled", kickoff_utc: T };
      },
    });
    suite.eq("3A-1 status lambat lewat kickoff: ditolak", rSlow.status, "rejected_cutoff");
    suite.eq("3A-1 alasan kickoff_reached", rSlow.reason, "kickoff_reached");
    suite.eq("3A-1 NOL pick resmi baru", picksCountFor(inpSlow.source_match_id), 0);

    // (2) Kickoff DIMAJUKAN sesudah scan: intent menyimpan kickoff T,
    // tetapi sumber otoritatif kini menyebut kickoff sudah lewat.
    // Cutoff diputuskan dari kickoff verifikasi akhir → NOL pick.
    const inpEarly = makeInput();
    const rEarly = pub.publishPicks(inpEarly, {
      now: () => "2026-11-20T12:30:00.000Z",
      fixture_state: () => ({ status: "scheduled", kickoff_utc: "2026-11-20T12:00:00.000Z" }),
    });
    suite.eq("3A-2 kickoff dimajukan sesudah scan: ditolak", rEarly.status, "rejected_cutoff");
    suite.eq("3A-2 alasan kickoff_reached", rEarly.reason, "kickoff_reached");
    suite.eq("3A-2 NOL pick resmi baru", picksCountFor(inpEarly.source_match_id), 0);

    // (3) Retry intent lama sesudah T — commit langsung maupun jalur
    // penuh publishPicks — tetap NOL pick resmi baru.
    const inpRetry = makeInput();
    const begunRetry = pub.beginPublication(inpRetry, "2026-11-20T11:00:00.000Z");
    suite.eq("3A-3 begin lama: package_written", begunRetry.state, "package_written");
    const rRetryOld = pub.commitPublication(begunRetry.operation_key, optsAt("2026-11-20T13:00:00.001Z"));
    suite.eq("3A-3 commit retry sesudah T: ditolak", rRetryOld.status, "rejected_cutoff");
    const rRetryFull = pub.publishPicks(inpRetry, optsAt("2026-11-20T13:05:00.000Z"));
    suite.eq("3A-3 publish ulang sesudah T: tetap ditolak", rRetryFull.status, "rejected_cutoff");
    suite.eq("3A-3 NOL pick resmi baru", picksCountFor(inpRetry.source_match_id), 0);

    // (4) Kasus sah T−1 ms: tepat SATU keputusan resmi, cap terbit =
    // nilai verifikasi akhir, retry mengembalikan keputusan yang sama.
    const inpOk = makeInput();
    const rOk = pub.publishPicks(inpOk, optsAt("2026-11-20T12:59:59.999Z"));
    suite.eq("3A-4 T-1ms sah: published", rOk.status, "published");
    suite.eq("3A-4 tepat 1 pick resmi", picksCountFor(inpOk.source_match_id), 1);
    const okRow = openRo(env, "picks.db")
      .prepare("SELECT published_at_utc FROM picks WHERE match_id = ?")
      .get(inpOk.source_match_id) as { published_at_utc: string };
    suite.eq("3A-4 cap terbit = nilai verifikasi akhir", okRow.published_at_utc, "2026-11-20T12:59:59.999Z");
    const rOk2 = pub.publishPicks(inpOk, optsAt("2026-11-20T12:59:59.999Z"));
    suite.eq("3A-4 retry: already_committed", rOk2.status, "already_committed");
    suite.eq("3A-4 retry: pick ids sama", rOk2.pick_ids, rOk.pick_ids);
    suite.eq("3A-4 retry: tetap tepat 1 pick", picksCountFor(inpOk.source_match_id), 1);

    // (5) Penulis kedua tertahan lock sampai melewati T: proses lain
    // memegang lock writer picks.db; commit yang dimulai pada T−400 ms
    // (jam palsu berbasis waktu nyata) harus MENUNGGU lock, lalu membaca
    // jam yang sudah melewati kickoff di dalam lock → ditolak, NOL pick.
    const inpLock = makeInput();
    const begunLock = pub.beginPublication(inpLock, "2026-11-20T12:59:59.000Z");
    const real0 = Date.now();
    const fake0 = Date.parse("2026-11-20T12:59:59.600Z");
    const clockLock = () => new Date(fake0 + (Date.now() - real0)).toISOString();
    const readyFile = path.join(env.root, "lock-ready");
    const holder = spawn(
      path.join(REPO_ROOT, "node_modules", ".bin", "tsx"),
      [
        path.join(REPO_ROOT, "tests/helpers/lock-holder.ts"),
        path.join(env.dataDir, "picks.db"),
        "900",
        readyFile,
      ],
      { cwd: env.root, stdio: "ignore" },
    );
    const holderDone = new Promise<void>((res) => holder.on("close", () => res()));
    const wait0 = Date.now();
    while (!fs.existsSync(readyFile) && Date.now() - wait0 < 15_000) {
      await new Promise((r) => setTimeout(r, 25));
    }
    suite.check("3A-5 lock penulis lain terpegang", fs.existsSync(readyFile));
    const tCommit = Date.now();
    const rLock = pub.commitPublication(begunLock.operation_key, {
      now: clockLock,
      fixture_state: () => ({ status: "scheduled", kickoff_utc: T }),
    });
    const elapsed = Date.now() - tCommit;
    await holderDone;
    suite.check(
      "3A-5 commit benar-benar menunggu lock (≥400 ms)",
      elapsed >= 400,
      `${elapsed}ms`,
    );
    suite.eq("3A-5 jam terbaca sesudah lock lewat T: ditolak", rLock.status, "rejected_cutoff");
    suite.eq("3A-5 alasan kickoff_reached", rLock.reason, "kickoff_reached");
    suite.eq("3A-5 NOL pick resmi baru", picksCountFor(inpLock.source_match_id), 0);
  }

  // ======================================================================
  console.log("\n— D06: peluang saat terbit beku; warisan tak tercatat —");
  // ======================================================================
  let legacyPickId = 0;
  {
    const inp = makeInput();
    const r = pub.publishPicks(inp, optsAt("2026-11-20T10:40:00.000Z"));
    suite.eq("D06 paket A terbit", r.status, "published");
    const pickId = r.pick_ids[0];
    const viewA = pub.getPickPublication(pickId);
    suite.eq("D06 terbit: published_prob 0.74", viewA?.published_prob, 0.74);
    suite.eq("D06 terbit: basis effective", viewA?.probability_basis, "effective");
    suite.eq("D06 terbit: package_id = A", viewA?.package_id, r.package_id);

    // Paket B (analisis terbaru) TIDAK mengubah jawaban saat-terbit.
    const pkgB = packages.writePackage({
      match_id: inp.source_match_id,
      competition_canonical_id: inp.competition_canonical_id ?? null,
      kickoff_utc: T,
      computed_utc: "2026-11-20T11:32:00.000Z",
      trigger: "slate",
      payload: {
        kind: "quant-package",
        version: 1,
        legs: [{ market: "1x2", selection: "1", model_prob: 0.85, effective_prob: 0.76 }],
      },
    });
    suite.check("D06 paket B id berbeda", pkgB.id !== r.package_id);
    suite.eq(
      "D06 analisis terbaru = B",
      packages.latestPackageFor(inp.source_match_id)?.id,
      pkgB.id,
    );
    const viewAfter = pub.getPickPublication(pickId);
    suite.eq("D06 sesudah B: published_prob tetap 0.74", viewAfter?.published_prob, 0.74);
    suite.eq("D06 sesudah B: package tetap A", viewAfter?.package_id, r.package_id);

    // effective_prob = 0 adalah nilai sah, bukan absen.
    const inpZero = makeInput(
      {},
      { market: "btts", selection: "no", model_prob: 0.3, effective_prob: 0 },
    );
    const rZero = pub.publishPicks(inpZero, optsAt("2026-11-20T10:40:00.000Z"));
    const viewZero = pub.getPickPublication(rZero.pick_ids[0]);
    suite.eq("D06 effective 0 terbit sebagai 0", viewZero?.published_prob, 0);
    suite.eq("D06 effective 0: basis effective", viewZero?.probability_basis, "effective");

    // Baris warisan tanpa bukti terbit → label + basis unknown_legacy
    // sesudah migrasi, dan keluar dari irisan probabilitas cohort.
    legacyPickId = ledger.recordPick({
      match_id: "fx_legacy_d06",
      kickoff_utc: T,
      market: "1x2",
      selection: "1",
      model_prob: 0.66,
      source: "live-run",
    });
    const viewLegacy0 = pub.getPickPublication(legacyPickId);
    suite.eq(
      "D06 warisan pra-migrasi: label tak tercatat",
      viewLegacy0?.published_display,
      pub.UNRECORDED_PROB_LABEL,
    );
    // Baris warisan TERIKAT paket: leg paket presisi penuh, baris tersimpan
    // pada presisi historis 4-dp → angka baris diselamatkan sebagai bukti
    // terbit (basis effective, nilai = angka baris sendiri).
    const salvagePkg = packages.writePackage({
      match_id: "fx_salvage_d06",
      kickoff_utc: T,
      computed_utc: "2026-11-20T09:00:00.000Z",
      trigger: "slate",
      payload: {
        kind: "quant-package",
        version: 1,
        legs: [
          { market: "1x2", selection: "2", model_prob: 0.61, effective_prob: 0.748303986475434 },
        ],
      },
    });
    const salvagePickId = ledger.recordPick({
      match_id: "fx_salvage_d06",
      kickoff_utc: T,
      market: "1x2",
      selection: "2",
      model_prob: 0.61,
      effective_prob: 0.7483,
      source: "live-run",
      package_id: salvagePkg.id,
    });
    const mig = migration.migratePublishedProb({
      picksDb: ledger.getPicksDb(),
      packagesDb: packages.getPackagesDb(),
      datasetDb: null,
    });
    suite.check("D06 migrasi memproses ≥1 baris", mig.processed >= 1, JSON.stringify(mig));
    const viewLegacy = pub.getPickPublication(legacyPickId);
    suite.eq("D06 warisan: basis unknown_legacy", viewLegacy?.probability_basis, "unknown_legacy");
    suite.eq("D06 warisan: published_prob null", viewLegacy?.published_prob, null);
    suite.eq(
      "D06 warisan: label 'Peluang terbit tidak tercatat'",
      viewLegacy?.published_display,
      "Peluang terbit tidak tercatat",
    );
    const viewSalvage = pub.getPickPublication(salvagePickId);
    suite.eq("D06 salvage 4-dp: basis effective", viewSalvage?.probability_basis, "effective");
    suite.eq(
      "D06 salvage 4-dp: published_prob = angka baris (0.7483)",
      viewSalvage?.published_prob,
      0.7483,
    );
    const mig2 = migration.migratePublishedProb({
      picksDb: ledger.getPicksDb(),
      packagesDb: packages.getPackagesDb(),
      datasetDb: null,
    });
    suite.eq("D06 migrasi idempoten: processed 0", mig2.processed, 0);
  }

  // ======================================================================
  console.log("\n— D08: odds yang ditawarkan + crash/retry —");
  // ======================================================================
  {
    // Quote prematch E0 2.10 masuk; closing + panel arsip TIDAK masuk odds.
    const inp = makeInput(
      {},
      {
        model_prob: 0.55,
        effective_prob: 0.52,
        sm_prob: null,
        odds_snapshots: [
          {
            source: "book",
            type: "prematch",
            available_utc: "2026-11-20T09:00:00.000Z",
            bookmaker: "test-book",
            decimal: 2.1,
          },
          {
            source: "book",
            type: "closing",
            available_utc: "2026-11-20T12:59:00.000Z",
            bookmaker: "test-book",
            decimal: 1.8,
          },
          {
            source: "archived_panel",
            type: "probability",
            available_utc: "2026-11-20T08:00:00.000Z",
            prob: 0.44,
          },
        ],
      },
    );
    const r = pub.publishPicks(inp, optsAt("2026-11-20T10:40:00.000Z"));
    suite.eq("D08 quote: terbit", r.status, "published");
    const row = openRo(env, "picks.db")
      .prepare("SELECT * FROM picks WHERE id = ?")
      .get(r.pick_ids[0]) as Record<string, unknown>;
    suite.eq("D08 odds_decimal = prematch 2.10", row.odds_decimal, 2.1);
    suite.eq("D08 odds_bookmaker", row.odds_bookmaker, "test-book");
    suite.eq("D08 odds_period prematch", row.odds_period, "prematch");
    suite.eq("D08 panel arsip → sm_prob 0.44 (bukan odds)", row.sm_prob, 0.44);

    // Harga invalid ditolak dengan catatan.
    const inpBad = makeInput(
      {},
      {
        odds_snapshots: [
          {
            source: "book",
            type: "prematch",
            available_utc: "2026-11-20T09:00:00.000Z",
            bookmaker: "test-book",
            decimal: 0.95,
          },
        ],
      },
    );
    const rBad = pub.publishPicks(inpBad, optsAt("2026-11-20T10:40:00.000Z"));
    const rowBad = openRo(env, "picks.db")
      .prepare("SELECT * FROM picks WHERE id = ?")
      .get(rBad.pick_ids[0]) as Record<string, unknown>;
    suite.eq("D08 harga invalid: odds null", rowBad.odds_decimal, null);
    suite.eq("D08 harga invalid: catatan", rowBad.odds_note, "invalid_price_rejected");

    // Crash sesudah package commit → intent terlihat rekonsiliasi; retry
    // menemukan paket yang sama dan menyelesaikan tepat satu publikasi.
    const inpCrash = makeInput();
    const specCrash = writeSpec("spec-d08-crash", inpCrash, "2026-11-20T11:00:00.000Z");
    const wCrash = runScript(env, "tests/helpers/publish-worker.ts", [specCrash, "begin-crash"]);
    suite.eq("D08 crash paket: worker exit 3", wCrash.code, 3);
    const crashInfo = JSON.parse(wCrash.stdout.trim()) as {
      operation_key: string;
      package_id: number;
    };
    const pending = pub.listPendingIntents();
    suite.check(
      "D08 rekonsiliasi: intent package_written terlihat",
      pending.some(
        (i) => i.operation_key === crashInfo.operation_key && i.state === "package_written",
      ),
      JSON.stringify(pending.map((i) => i.state)),
    );
    const rRetry = pub.publishPicks(inpCrash, optsAt("2026-11-20T11:05:00.000Z"));
    suite.eq("D08 retry crash paket: published", rRetry.status, "published");
    suite.eq("D08 retry: paket yang sama", rRetry.package_id, crashInfo.package_id);
    suite.eq("D08 retry: tepat 1 paket", packagesCountFor(inpCrash.source_match_id), 1);
    suite.eq("D08 retry: tepat 1 pick", picksCountFor(inpCrash.source_match_id), 1);
    suite.check(
      "D08 rekonsiliasi bersih sesudah retry",
      !pub.listPendingIntents().some((i) => i.operation_key === crashInfo.operation_key),
    );

    // Crash sesudah ledger commit → retry mengenali sukses yang sama.
    const inpCrash2 = makeInput();
    const specCrash2 = writeSpec("spec-d08-crash2", inpCrash2, "2026-11-20T11:00:00.000Z");
    const wCrash2 = runScript(env, "tests/helpers/publish-worker.ts", [
      specCrash2,
      "publish-crash-after-commit",
    ]);
    suite.eq("D08 crash ledger: worker exit 4", wCrash2.code, 4);
    const committedRows = openRo(env, "picks.db")
      .prepare("SELECT published_pick_ids FROM publication_intents WHERE source_match_id = ?")
      .get(inpCrash2.source_match_id) as { published_pick_ids: string } | undefined;
    const committedIds = JSON.parse(committedRows?.published_pick_ids ?? "[]") as number[];
    suite.eq("D08 crash ledger: 1 pick ter-commit", picksCountFor(inpCrash2.source_match_id), 1);
    const rRetry2 = pub.publishPicks(inpCrash2, optsAt("2026-11-20T11:06:00.000Z"));
    suite.eq("D08 retry crash ledger: already_committed", rRetry2.status, "already_committed");
    suite.eq("D08 retry crash ledger: pick ids sama", rRetry2.pick_ids, committedIds);
    suite.eq("D08 retry crash ledger: tetap 1 pick", picksCountFor(inpCrash2.source_match_id), 1);

    // Retry paralel sesudah crash paket → satu publikasi lengkap.
    const inpPar = makeInput();
    const specPar = writeSpec("spec-d08-par", inpPar, "2026-11-20T11:00:00.000Z");
    const wPar0 = runScript(env, "tests/helpers/publish-worker.ts", [specPar, "begin-crash"]);
    suite.eq("D08 paralel: begin-crash exit 3", wPar0.code, 3);
    const goFile = path.join(env.root, "go-d08");
    const specPar2 = writeSpec("spec-d08-par2", inpPar, "2026-11-20T11:10:00.000Z", {
      barrier_file: goFile,
    });
    const wp1 = runWorker(specPar2, "publish");
    const wp2 = runWorker(specPar2, "publish");
    await new Promise((r) => setTimeout(r, 700));
    fs.writeFileSync(goFile, "go");
    const [pa, pb] = await Promise.all([wp1, wp2]);
    suite.eq("D08 paralel: kedua retry exit 0", [pa.code, pb.code], [0, 0]);
    suite.eq("D08 paralel: pick ids sama", pa.json?.pick_ids, pb.json?.pick_ids);
    suite.eq("D08 paralel: tepat 1 pick", picksCountFor(inpPar.source_match_id), 1);
    suite.eq("D08 paralel: tepat 1 paket", packagesCountFor(inpPar.source_match_id), 1);
  }

  // ======================================================================
  console.log("\n— D07: statistik cohort dari sampel yang sama —");
  // ======================================================================
  {
    const NOW = "2026-11-21T00:00:00.000Z";
    const seed = (
      kickoff: string,
      over: Partial<import("../lib/picks/ledger").PickInput> = {},
    ): number =>
      ledger.recordPick({
        match_id: `coh_${Math.random().toString(36).slice(2, 9)}`,
        kickoff_utc: kickoff,
        market: "dc",
        selection: "1x",
        model_prob: 0.8,
        source: "cohort-test",
        ...over,
      });
    const setPublished = (id: number, p: number) => {
      ledger
        .getPicksDb()
        .prepare(
          "UPDATE picks SET published_prob = ?, probability_basis = 'effective' WHERE id = ?",
        )
        .run(p, id);
    };

    // 2 masa depan.
    seed("2026-11-22T13:00:00.000Z");
    seed("2026-11-22T13:00:00.000Z");
    // 4 dinilai: prob [0.8, 0.7, 0.6, 0.9], hit [1, 1, 0, 1].
    const settledIds: number[] = [];
    const probs = [0.8, 0.7, 0.6, 0.9];
    const scores: Array<[number, number]> = [
      [2, 0],
      [1, 0],
      [0, 2],
      [3, 1],
    ];
    for (let i = 0; i < 4; i++) {
      const id = seed("2026-11-20T13:00:00.000Z");
      setPublished(id, probs[i]);
      ledger.recordOutcome(id, scores[i][0], scores[i][1]);
      settledIds.push(id);
    }
    // 2 pending jatuh tempo (kickoff >6 jam lalu, tanpa outcome).
    const od1 = seed("2026-11-20T10:00:00.000Z");
    const od2 = seed("2026-11-20T10:00:00.000Z");
    // 1 void.
    const voidId = seed("2026-11-20T13:00:00.000Z");
    ledger.markPickVoid(voidId, {
      reason: "pertandingan dibatalkan (fixture D07)",
      policyVersion: resolver.SETTLEMENT_POLICY_VERSION,
    });

    const reasons = new Map<number, string>([
      [od1, "no_source"],
      [od2, "conflict"],
    ]);
    const cs = cohort.cohortStats({
      now_utc: NOW,
      filter: { source: "cohort-test" },
      pending_reasons: reasons,
    });
    suite.eq("D07 terbit 9", cs.issued, 9);
    suite.eq("D07 dinilai 4", cs.settled, 4);
    suite.eq("D07 tepat 3", cs.hits, 3);
    suite.eq("D07 meleset 1", cs.misses, 1);
    suite.eq("D07 rasio tepat 75%", cs.hit_ratio, 0.75);
    suite.eq("D07 penyebut cakupan 6", cs.due, 6);
    suite.eq("D07 cakupan [4,6]", cs.coverage, [4, 6]);
    suite.check(
      "D07 cakupan 66,7%",
      cs.coverage_ratio !== null && Math.abs(cs.coverage_ratio - 4 / 6) < 1e-9,
      String(cs.coverage_ratio),
    );
    suite.eq("D07 void 1", cs.voids, 1);
    suite.eq("D07 belum mulai 2", cs.not_started, 2);
    suite.eq("D07 jatuh tempo 2", cs.overdue_pending, 2);
    suite.eq("D07 alasan jatuh tempo", cs.overdue_by_reason, { no_source: 1, conflict: 1 });
    suite.eq("D07 irisan prob n=4", cs.prob_slice.n, 4);
    suite.eq("D07 AVG(published_prob)=0.75", cs.prob_slice.avg_published_prob, 0.75);
    suite.eq("D07 AVG(hit)=0.75", cs.prob_slice.avg_hit, 0.75);
    suite.eq("D07 warisan hit/miss-saja 0", cs.prob_slice.legacy_hitmiss_only, 0);

    // Koreksi skor membatalkan statistik lama (dihitung ulang dari ledger).
    ledger.recordOutcome(settledIds[3], 0, 2);
    const cs2 = cohort.cohortStats({
      now_utc: NOW,
      filter: { source: "cohort-test" },
      pending_reasons: reasons,
    });
    suite.eq("D07 koreksi: tepat turun ke 2", cs2.hits, 2);
    suite.eq("D07 koreksi: rasio 50%", cs2.hit_ratio, 0.5);

    // Cohort tanpa hasil → status kosong, BUKAN 0%.
    const seedEmpty = (
      kickoff: string,
    ): number =>
      ledger.recordPick({
        match_id: `coe_${Math.random().toString(36).slice(2, 9)}`,
        kickoff_utc: kickoff,
        market: "dc",
        selection: "1x",
        model_prob: 0.8,
        source: "cohort-empty",
      });
    seedEmpty("2026-11-22T13:00:00.000Z");
    seedEmpty("2026-11-22T13:00:00.000Z");
    const csEmpty = cohort.cohortStats({
      now_utc: NOW,
      filter: { source: "cohort-empty" },
    });
    suite.eq("D07 cohort kosong: hit_ratio null", csEmpty.hit_ratio, null);
    suite.eq("D07 cohort kosong: empty=true", csEmpty.empty, true);
    suite.eq("D07 label kosong", cohort.EMPTY_COHORT_LABEL, "Belum ada hasil");

    // Lima meleset → 0/5 = 0% persis (bukan status kosong).
    for (let i = 0; i < 5; i++) {
      const id = ledger.recordPick({
        match_id: `com_${Math.random().toString(36).slice(2, 9)}`,
        kickoff_utc: "2026-11-20T13:00:00.000Z",
        market: "dc",
        selection: "1x",
        model_prob: 0.8,
        source: "cohort-miss5",
      });
      ledger.recordOutcome(id, 0, 1);
    }
    const csMiss = cohort.cohortStats({
      now_utc: NOW,
      filter: { source: "cohort-miss5" },
    });
    suite.eq("D07 lima meleset: dinilai 5", csMiss.settled, 5);
    suite.eq("D07 lima meleset: rasio tepat 0", csMiss.hit_ratio, 0);
    suite.eq("D07 lima meleset: empty=false", csMiss.empty, false);
  }

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
