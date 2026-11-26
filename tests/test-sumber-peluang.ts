/**
 * SUITE SUMBER PELUANG (B2.2b) — label basis peluang + pembanding pasar.
 *
 * Yang diverifikasi (kriteria brief B2.2):
 *  - Proyeksi murni `labelSumberPeluang` atas bukti beku satu baris:
 *    lab-band vs stated-fallback vs legacy (copy persis tabel brief);
 *    quote valid terikat garis + edisi yang benar; quote future /
 *    closing / garis beda / cap kosong / desimal ≤ 1 / decision ==
 *    kickoff TIDAK dilabeli valid; batas captured == decision sah;
 *    pasar tanpa garis menolak quote bergaris; bukti pasar di level
 *    peluang tanpa metadata quote → belum terverifikasi; panel saja →
 *    tanpa keterangan; `panelArsipAdaNilai` (0 sah, kosong/invalid
 *    tidak).
 *  - Umpan nyata (probe subprocess): `daftarPilihanPraLaga` memproyeksi
 *    dari baris edisi perwakilan; SSR/`/api/pilihan` (`halamanUmpan`)
 *    dan pulih draf (`pulihkanDariUmpan`) membawa label yang sama;
 *    konflik edisi dipertahankan; peluang lama 0 tetap 0; payload
 *    daftar TANPA raw odds/matriks (delta ukuran per pilihan diukur);
 *    paket terbaru berbeda (bookmaker umpan "DecoyBet" di payload
 *    paket terbaru) TIDAK menukar label resmi baris Detail maupun
 *    Pilihan — keduanya membaca quote beku barisnya sendiri.
 *
 * Suite terdaftar di test:web — proyeksi + pembacanya hidup di lapisan
 * web (lib/web/*), pola yang sama dengan test-keputusan-fix4 (B2.1).
 *
 * Pakai: npm run test:web (atau langsung: npx tsx tests/test-sumber-peluang.ts)
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  Suite,
  buildCoreSchemas,
  createFixtureEnv,
  runScript,
  settleFixtureEnv,
  type FixtureEnv,
} from "./helpers/fixture-env";
import {
  labelSumberPeluang,
  panelArsipAdaNilai,
  teksPembanding,
  type BuktiPeluangResmi,
} from "../lib/web/sumber-peluang";
import type { BuilderPick, HalamanUmpan } from "../lib/web/pilihan-umpan";
import type { LabelSumberPeluang } from "../lib/web/sumber-peluang";

const suite = new Suite("sumber-peluang (B2.2b)");

/* ------------------------------------------------------- proyeksi murni */

const BUKTI_VALID: BuktiPeluangResmi = {
  probability_basis: "effective",
  effective_source: "lab-band",
  evidence_source: "market",
  market_prob: 0.74,
  line: "2.5",
  odds_bookmaker: "Bet365",
  odds_period: "prematch",
  odds_line: "2.5",
  odds_decimal: 1.95,
  odds_captured_utc: "2026-11-26T09:15:00.000Z",
  decision_at_utc: "2026-11-26T09:30:00.000Z",
  kickoff_at_issue_utc: "2026-11-26T19:00:00.000Z",
};
const varian = (u: Partial<BuktiPeluangResmi>): BuktiPeluangResmi => ({
  ...BUKTI_VALID,
  ...u,
});

{
  const lab = labelSumberPeluang(BUKTI_VALID);
  suite.eq("proyeksi: lab-band → label 'Peluang saat terbit'", lab.label_basis, "Peluang saat terbit");
  suite.eq(
    "proyeksi: lab-band → keterangan 'Disesuaikan dari uji historis'",
    lab.keterangan_basis,
    "Disesuaikan dari uji historis",
  );
  suite.eq("proyeksi: quote valid → pembanding valid", lab.pembanding.jenis, "valid");
  suite.eq(
    "proyeksi: teks pembanding valid (bookmaker + cap WIB dari row)",
    teksPembanding(lab.pembanding),
    "Pembanding pasar · Bet365 · Tercatat 16.15 WIB",
  );

  const fb = labelSumberPeluang(varian({ effective_source: "stated-fallback" }));
  suite.eq(
    "proyeksi: stated-fallback (basis effective) → 'Peluang model saat terbit'",
    fb.label_basis,
    "Peluang model saat terbit",
  );
  suite.eq(
    "proyeksi: stated-fallback → keterangan model, BUKAN klaim uji historis",
    fb.keterangan_basis,
    "Dihitung dari model skor.",
  );

  const modelOnly = labelSumberPeluang(
    varian({
      probability_basis: "model",
      effective_source: null,
      evidence_source: "model-only",
      market_prob: null,
      line: "",
      odds_bookmaker: null,
      odds_period: null,
      odds_line: null,
      odds_decimal: null,
      odds_captured_utc: null,
    }),
  );
  suite.eq("proyeksi: basis model → 'Peluang model saat terbit'", modelOnly.label_basis, "Peluang model saat terbit");
  suite.eq("proyeksi: model-only tanpa pembanding → 'Model saja'", teksPembanding(modelOnly.pembanding), "Model saja");

  const effTakTercatat = labelSumberPeluang(
    varian({
      effective_source: null,
      evidence_source: null,
      market_prob: null,
      odds_bookmaker: null,
      odds_period: null,
      odds_line: null,
      odds_decimal: null,
      odds_captured_utc: null,
    }),
  );
  suite.eq(
    "proyeksi: effective tanpa sumber koreksi → 'Peluang saat terbit' tanpa klaim",
    [effTakTercatat.label_basis, effTakTercatat.keterangan_basis],
    ["Peluang saat terbit", null],
  );
  suite.eq(
    "proyeksi: tanpa bukti apa pun → tanpa keterangan pembanding",
    teksPembanding(effTakTercatat.pembanding),
    null,
  );

  const legacy = labelSumberPeluang(
    varian({ probability_basis: "unknown_legacy", effective_source: null }),
  );
  suite.eq(
    "proyeksi: legacy → label warisan dipertahankan",
    legacy.label_basis,
    "Peluang terbit tidak tercatat",
  );

  const takValid = (nama: string, u: Partial<BuktiPeluangResmi>) => {
    suite.eq(
      `proyeksi: ${nama} → tidak dilabeli valid`,
      labelSumberPeluang(varian(u)).pembanding.jenis,
      "belum-terverifikasi",
    );
  };
  takValid("quote future (captured > decision)", { odds_captured_utc: "2026-11-26T09:45:00.000Z" });
  takValid("quote closing", { odds_period: "closing" });
  takValid("garis berbeda (3.5 vs 2.5)", { odds_line: "3.5" });
  takValid("cap kosong", { odds_captured_utc: null });
  takValid("bookmaker kosong", { odds_bookmaker: "  " });
  takValid("desimal = 1", { odds_decimal: 1 });
  takValid("desimal NaN", { odds_decimal: NaN });
  takValid("decision == kickoff", { decision_at_utc: "2026-11-26T19:00:00.000Z" });
  takValid("decision hilang", { decision_at_utc: null });

  suite.eq(
    "proyeksi: batas captured == decision tetap valid (<=)",
    labelSumberPeluang(varian({ odds_captured_utc: "2026-11-26T09:30:00.000Z" })).pembanding.jenis,
    "valid",
  );
  suite.eq(
    "proyeksi: garis ekuivalen numerik ('2.50') tetap valid",
    labelSumberPeluang(varian({ odds_line: "2.50" })).pembanding.jenis,
    "valid",
  );
  suite.eq(
    "proyeksi: pasar tanpa garis + quote tanpa garis → valid",
    labelSumberPeluang(varian({ line: "", odds_line: null })).pembanding.jenis,
    "valid",
  );
  takValid("pasar tanpa garis + quote bergaris", { line: "", odds_line: "2.5" });

  suite.eq(
    "proyeksi: market_prob tercatat tanpa metadata quote → belum terverifikasi",
    labelSumberPeluang(
      varian({
        odds_bookmaker: null,
        odds_period: null,
        odds_line: null,
        odds_decimal: null,
        odds_captured_utc: null,
        evidence_source: null,
      }),
    ).pembanding.jenis,
    "belum-terverifikasi",
  );
  suite.eq(
    "proyeksi: panel saja (tanpa pasar) → tanpa keterangan pembanding",
    labelSumberPeluang(
      varian({
        evidence_source: "panel",
        market_prob: null,
        odds_bookmaker: null,
        odds_period: null,
        odds_line: null,
        odds_decimal: null,
        odds_captured_utc: null,
      }),
    ).pembanding.jenis,
    "tidak-ada",
  );

  /* Panel arsip */
  suite.eq("panel: satu nilai sah → dipertahankan", panelArsipAdaNilai({ probs: { "1x2:1": 0.5 } }), true);
  suite.eq("panel: nilai 0 sah → dipertahankan", panelArsipAdaNilai({ probs: { "1x2:1": 0 } }), true);
  suite.eq("panel: kosong → tidak ada nilai", panelArsipAdaNilai({ probs: {} }), false);
  suite.eq("panel: semua di luar [0,1] → tidak ada nilai", panelArsipAdaNilai({ probs: { "1x2:1": 2.5 } }), false);
  suite.eq("panel: null → tidak ada nilai", panelArsipAdaNilai(null), false);
}

/* ------------------------------------------------------------ umpan nyata */

interface ProbeOut {
  umpan: {
    pick_uid: string;
    match_id: string;
    published_prob: number;
    konflik: boolean;
    sumber: LabelSumberPeluang | null;
  }[];
  halaman: HalamanUmpan;
  pulih: { pilihan: BuilderPick[]; hilang: number };
  detail: {
    officialPicks: (BuktiPeluangResmi & {
      pick_uid: string;
      published_prob: number | null;
    })[];
  } | null;
}

function probe(env: FixtureEnv, nowUtc: string, detailId?: string): ProbeOut {
  const args = detailId ? [nowUtc, detailId] : [nowUtc];
  const res = runScript(env, "tests/helpers/b22-umpan-probe.ts", args);
  const line = res.stdout.split("\n").find((l) => l.startsWith("PROBE_JSON "));
  if (!line) {
    throw new Error(
      `b22-umpan-probe tidak menghasilkan PROBE_JSON (exit=${res.code}): ${res.stdout} ${res.stderr}`,
    );
  }
  return JSON.parse(line.slice("PROBE_JSON ".length)) as ProbeOut;
}

const NOW = "2026-11-26T10:00:00.000Z";
const KICKOFF = "2026-11-27T19:00:00.000Z";
const DECISION = "2026-11-26T09:30:00.000Z";
const CAPTURED = "2026-11-26T09:15:00.000Z";

async function main(): Promise<void> {
  const env = createFixtureEnv("sumber-peluang");
  process.chdir(env.root);
  const { ledger } = await buildCoreSchemas();
  const publication = await import("../lib/picks/publication");
  const db = ledger.getPicksDb();
  publication.ensurePublicationSchema(db);

  /* Paket penerbit (nama laga) + paket Detail (terbit vs terbaru). */
  const snap = new DatabaseSync(path.join(env.dataDir, "analysis_snapshots.db"));
  const insPaket = snap.prepare(
    `INSERT INTO packages (match_id, computed_utc, trigger, payload_json)
     VALUES (?, ?, 'slate', ?)`,
  );
  const paketNama = (m: string, home: string, away: string): number =>
    Number(
      insPaket.run(
        m,
        DECISION,
        JSON.stringify({
          fixture: { home, away, competition_name: "Liga Uji", kickoff_utc: KICKOFF },
        }),
      ).lastInsertRowid,
    );
  const pkgA = paketNama("b22_a", "Alpha FC", "Beta United");
  const pkgB = paketNama("b22_b", "Gamma City", "Delta Rovers");
  const pkgC = paketNama("b22_c", "Epsilon", "Zeta");
  const pkgD = paketNama("b22_d", "Eta", "Theta");
  const pkgE = paketNama("b22_e", "Iota", "Kappa");
  const pkgE2 = paketNama("b22_e2", "Iota", "Kappa");
  const payloadDetail = (bookmakers: string[]) =>
    JSON.stringify({
      fixture: {
        home: "Detail Home",
        away: "Detail Away",
        competition_name: "Liga Detail",
        kickoff_utc: KICKOFF,
      },
      probabilities: { "1x2:1": 0.81, "1x2:x": 0.12, "1x2:2": 0.07 },
      market: {
        probs: { "1x2:1": 0.79 },
        captured_utc: CAPTURED,
        bookmakers,
      },
      sm_panel: { probs: { "1x2:1": 0.55 }, batch_utc: "2026-11-25T00:00:00.000Z" },
      score_matrix: [],
    });
  const pkgTerbit = Number(
    insPaket.run("b22_detail", DECISION, payloadDetail(["Bet365"])).lastInsertRowid,
  );
  // Paket TERBARU laga yang sama — bookmaker payload-nya umpan; label
  // resmi tidak boleh tertukar olehnya.
  insPaket.run(
    "b22_detail",
    "2026-11-26T15:00:00.000Z",
    payloadDetail(["DecoyBet"]),
  );
  snap.close();

  const insPick = db.prepare(
    `INSERT INTO picks (created_utc, match_id, competition_canonical_id, kickoff_utc,
                        market, selection, model_prob, market_prob, sm_prob, gate_status,
                        grade, source, package_id, effective_prob, effective_source,
                        pick_uid, fixture_uid, line, decision_at_utc, published_at_utc,
                        kickoff_at_issue_utc, published_prob, probability_basis,
                        evidence_source, odds_bookmaker, odds_period, odds_line,
                        odds_decimal, odds_captured_utc)
     VALUES (?, ?, 'liga_uji', ?, ?, ?, ?, ?, ?, 'calibrated', ?, 'live-run', ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  type SeedPick = {
    uid: string; match: string; market: string; sel: string; line: string;
    model: number; marketProb: number | null; sm: number | null; grade: string;
    pkg: number; effProb: number | null; effSource: string | null;
    fixtureUid: string; publishedAt: string; publishedProb: number; basis: string;
    evidence: string | null; bookmaker: string | null; period: string | null;
    oddsLine: string | null; decimal: number | null; captured: string | null;
  };
  const tanam = (p: SeedPick): void => {
    insPick.run(
      DECISION, p.match, KICKOFF, p.market, p.sel, p.model, p.marketProb, p.sm,
      p.grade, p.pkg, p.effProb, p.effSource, p.uid, p.fixtureUid, p.line,
      DECISION, p.publishedAt, KICKOFF, p.publishedProb, p.basis, p.evidence,
      p.bookmaker, p.period, p.oddsLine, p.decimal, p.captured,
    );
  };
  const dasar: SeedPick = {
    uid: "", match: "", market: "1x2", sel: "1", line: "", model: 0.8,
    marketProb: null, sm: null, grade: "A", pkg: pkgA, effProb: null,
    effSource: null, fixtureUid: "", publishedAt: DECISION, publishedProb: 0.8,
    basis: "model", evidence: "model-only", bookmaker: null, period: null,
    oddsLine: null, decimal: null, captured: null,
  };
  tanam({ ...dasar, uid: "pk_b22_model", match: "b22_a", fixtureUid: "fx-b22-a" });
  tanam({
    ...dasar, uid: "pk_b22_lab", match: "b22_b", market: "ou25", sel: "over",
    line: "2.5", model: 0.75, marketProb: 0.74, grade: "A", pkg: pkgB,
    effProb: 0.77, effSource: "lab-band", fixtureUid: "fx-b22-b",
    publishedProb: 0.77, basis: "effective", evidence: "market",
    bookmaker: "Bet365", period: "prematch", oddsLine: "2.5", decimal: 1.95,
    captured: CAPTURED,
  });
  tanam({
    ...dasar, uid: "pk_b22_fb", match: "b22_c", market: "dc", sel: "1x",
    model: 0.74, marketProb: 0.72, sm: 0.7, grade: "B", pkg: pkgC,
    effProb: 0.74, effSource: "stated-fallback", fixtureUid: "fx-b22-c",
    publishedProb: 0.74, basis: "effective", evidence: "market+panel",
    bookmaker: "Bet365", period: "closing", decimal: 1.9, captured: CAPTURED,
  });
  tanam({
    ...dasar, uid: "pk_b22_nol", match: "b22_d", sel: "2", model: 0, grade: "B",
    pkg: pkgD, fixtureUid: "fx-b22-d", publishedProb: 0, basis: "effective",
    evidence: null,
  });
  tanam({
    ...dasar, uid: "pk_b22_konflik1", match: "b22_e", pkg: pkgE,
    fixtureUid: "fx-b22-konflik", publishedProb: 0.7,
  });
  tanam({
    ...dasar, uid: "pk_b22_konflik2", match: "b22_e2", pkg: pkgE2,
    fixtureUid: "fx-b22-konflik", publishedAt: "2026-11-26T09:35:00.000Z",
    publishedProb: 0.66,
  });
  tanam({
    ...dasar, uid: "pk_b22_detail", match: "b22_detail", model: 0.8,
    marketProb: 0.79, pkg: pkgTerbit, effProb: 0.81, effSource: "lab-band",
    fixtureUid: "fx-b22-detail", publishedProb: 0.81, basis: "effective",
    evidence: "market", bookmaker: "Bet365", period: "prematch", decimal: 1.92,
    captured: CAPTURED,
  });

  const hasil = probe(env, NOW, "b22_detail");
  const umpanBy = new Map(hasil.umpan.map((p) => [p.pick_uid, p]));

  /* Umpan: proyeksi dari baris perwakilan */
  suite.eq("umpan: model-only → label model", umpanBy.get("pk_b22_model")?.sumber?.label_basis, "Peluang model saat terbit");
  suite.eq("umpan: model-only → pembanding model-saja", umpanBy.get("pk_b22_model")?.sumber?.pembanding.jenis, "model-saja");
  suite.eq("umpan: lab-band → label + keterangan uji historis",
    [umpanBy.get("pk_b22_lab")?.sumber?.label_basis, umpanBy.get("pk_b22_lab")?.sumber?.keterangan_basis],
    ["Peluang saat terbit", "Disesuaikan dari uji historis"]);
  suite.eq("umpan: lab-band → pembanding valid Bet365", umpanBy.get("pk_b22_lab")?.sumber?.pembanding,
    { jenis: "valid", bookmaker: "Bet365", tercatat_utc: CAPTURED });
  suite.eq("umpan: stated-fallback → label model (bukan lab)", umpanBy.get("pk_b22_fb")?.sumber?.label_basis, "Peluang model saat terbit");
  suite.eq("umpan: quote closing → belum terverifikasi", umpanBy.get("pk_b22_fb")?.sumber?.pembanding.jenis, "belum-terverifikasi");
  suite.eq("umpan: peluang 0 tetap 0", umpanBy.get("pk_b22_nol")?.published_prob, 0);
  suite.eq("umpan: peluang 0 → label terbit tanpa keterangan pembanding",
    [umpanBy.get("pk_b22_nol")?.sumber?.label_basis, umpanBy.get("pk_b22_nol")?.sumber?.pembanding.jenis],
    ["Peluang saat terbit", "tidak-ada"]);

  /* Konflik edisi: satu kejadian, perwakilan terbit pertama */
  const konflikRows = hasil.umpan.filter((p) => p.konflik);
  suite.eq("umpan: dua edisi beda angka → tepat satu kejadian berkonflik", konflikRows.length, 1);
  suite.eq("umpan: perwakilan konflik = terbit pertama (0,70)", konflikRows[0]?.published_prob, 0.7);

  /* Halaman (SSR + /api/pilihan): label yang sama lewat BuilderPick */
  const halBy = new Map(hasil.halaman.pilihan.map((p) => [p.key, p]));
  suite.eq("halaman: lab-band labelBasis", halBy.get("pk_b22_lab")?.labelBasis, "Peluang saat terbit");
  suite.eq("halaman: lab-band keteranganBasis", halBy.get("pk_b22_lab")?.keteranganBasis, "Disesuaikan dari uji historis");
  suite.eq(
    "halaman: teks pembanding valid dari row resmi (bukan paket terbaru)",
    halBy.get("pk_b22_lab")?.teksPembanding,
    "Pembanding pasar · Bet365 · Tercatat 16.15 WIB",
  );
  suite.eq("halaman: model-only teks 'Model saja'", halBy.get("pk_b22_model")?.teksPembanding, "Model saja");
  suite.eq(
    "halaman: closing teks belum terverifikasi",
    halBy.get("pk_b22_fb")?.teksPembanding,
    "Waktu atau sumber pembanding belum terverifikasi",
  );
  suite.eq("halaman: peluang 0 tetap 0 di BuilderPick", halBy.get("pk_b22_nol")?.prob, 0);
  suite.eq("halaman: peluang 0 tanpa teks pembanding", halBy.get("pk_b22_nol")?.teksPembanding, null);
  suite.check(
    "halaman: pick berkonflik tetap ditandai konflik",
    (halBy.get("pk_b22_konflik1")?.konflik?.nilai.length ?? 0) === 2,
  );

  /* Pulih draf: label konsisten dengan halaman */
  const pulihBy = new Map(hasil.pulih.pilihan.map((p) => [p.key, p]));
  suite.eq("pulih: tidak ada yang hilang", hasil.pulih.hilang, 0);
  for (const uid of ["pk_b22_model", "pk_b22_lab", "pk_b22_fb", "pk_b22_nol"]) {
    suite.eq(
      `pulih: label ${uid} konsisten dengan halaman`,
      [
        pulihBy.get(uid)?.labelBasis,
        pulihBy.get(uid)?.keteranganBasis,
        pulihBy.get(uid)?.teksPembanding,
      ],
      [
        halBy.get(uid)?.labelBasis,
        halBy.get(uid)?.keteranganBasis,
        halBy.get(uid)?.teksPembanding,
      ],
    );
  }

  /* Payload: ringkas, tanpa raw odds / matriks; delta terukur */
  const jsonPenuh = JSON.stringify(hasil.halaman);
  suite.check("payload: tanpa field raw odds", !/"odds_/.test(jsonPenuh), jsonPenuh.slice(0, 200));
  suite.check("payload: tanpa matriks (tetap lazy)", !jsonPenuh.includes("matriks"));
  const stripped = {
    ...hasil.halaman,
    pilihan: hasil.halaman.pilihan.map((p) => {
      const c: Record<string, unknown> = { ...(p as unknown as Record<string, unknown>) };
      delete c.labelBasis;
      delete c.keteranganBasis;
      delete c.teksPembanding;
      return c;
    }),
  };
  const deltaPerPilihan =
    (jsonPenuh.length - JSON.stringify(stripped).length) /
    Math.max(1, hasil.halaman.pilihan.length);
  console.log(
    `  [payload] /api/pilihan fixture: ${jsonPenuh.length} byte, ` +
      `delta label B2.2b ≈ ${deltaPerPilihan.toFixed(1)} byte/pilihan`,
  );
  suite.check(
    "payload: delta label per pilihan kecil (< 220 byte)",
    deltaPerPilihan > 0 && deltaPerPilihan < 220,
    `delta=${deltaPerPilihan}`,
  );

  /* Detail: bukti beku dari row edisi terbit, bukan paket terbaru */
  const det = hasil.detail?.officialPicks ?? [];
  suite.eq("detail: satu pilihan resmi terbaca", det.length, 1);
  suite.eq(
    "detail: bookmaker dari row edisi terbit (Bet365, bukan DecoyBet paket terbaru)",
    det[0]?.odds_bookmaker,
    "Bet365",
  );
  if (det[0]) {
    const proyeksi = labelSumberPeluang(det[0]);
    suite.eq("detail: proyeksi dari row → pembanding valid Bet365", proyeksi.pembanding,
      { jenis: "valid", bookmaker: "Bet365", tercatat_utc: CAPTURED });
    suite.eq("detail: proyeksi dari row → label lab-band", proyeksi.label_basis, "Peluang saat terbit");
  }

  settleFixtureEnv(env, suite.failedCount > 0);
  suite.finish();
}

main().catch((e) => {
  console.error("GAGAL BESAR:", e);
  process.exit(1);
});
