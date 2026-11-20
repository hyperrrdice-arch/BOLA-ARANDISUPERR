/**
 * Probe adapter untuk reproduksi redesain — dijalankan sebagai
 * SUBPROSES dari tests/test-redesain-repro.ts dengan cwd = sandbox.
 * Mengimpor modul repo persis seperti server produksi (cwd menentukan
 * direktori data) dan mencetak satu baris `PROBE_JSON {...}`.
 * Probe tidak menilai apa pun; suite yang menilai.
 *
 * Aksi: marseille | detail | status | arsip
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { combineSlip, type SlipPick } from "../../lib/web/parlay";
import { daftarPilihanPraLaga, ambilRekam, type FilterRekam } from "../../lib/web/rekam";
import { getMatchDetail, getMatchState, getPackageMatrix } from "../../lib/web/data";
import {
  displayStatus,
  labelStatus,
  LABEL_STATUS_TAMPIL,
  STATUS_LABEL_ID,
} from "../../lib/web/status";
import { getUidForMatchId } from "../../lib/identity/fixture-resolver";

const aksi = process.argv[2];

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

if (aksi === "marseille") {
  const now = "2026-11-21T00:00:00.000Z";
  const picks = daftarPilihanPraLaga(now);
  const perMatch = new Map<string, number>();
  for (const p of picks) perMatch.set(p.match_id, (perMatch.get(p.match_id) ?? 0) + 1);
  const ou15 = picks.filter((p) => p.market === "ou15" && p.selection === "over");
  const btts = picks.filter((p) => p.market === "btts");
  // Persis konstruksi ParlayBuilder: matchId SlipPick = fixtureUid laga.
  const slip: SlipPick[] = ou15.map((p) => ({
    key: p.pick_uid,
    matchId: p.fixture_uid,
    market: p.market,
    selection: p.selection,
    prob: p.published_prob,
    probBasis: p.probability_basis === "effective" ? "lab" : "model",
    matrix: p.package_id !== null ? getPackageMatrix(p.package_id) : null,
  }));
  const gabung = combineSlip(slip);
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"), {
    readOnly: true,
  });
  const uids: Record<string, string | null> = {};
  for (const id of ["sm_19715544", "mt_022917440", "mt_377265875", "sm_19715561", "mt_155794033", "sm_900001", "mt_900001"]) {
    try {
      uids[id] = getUidForMatchId(ds, id);
    } catch {
      uids[id] = null;
    }
  }
  ds.close();
  cetak({
    totalPicks: picks.length,
    perMatch: Object.fromEntries(perMatch),
    fixtureKeys: [...new Set(picks.map((p) => p.fixture_uid))],
    ou15: ou15.map((p) => ({ match_id: p.match_id, prob: p.published_prob, kunci: p.fixture_uid })),
    btts: btts.map((p) => ({ match_id: p.match_id, prob: p.published_prob })),
    gabungOu15: { kelompok: gabung.groups.length, gabungan: gabung.combined },
    uids,
  });
} else if (aksi === "detail") {
  const hasil: Record<string, unknown> = {};
  for (const id of ["sm_19726740", "sm_19719152"]) {
    try {
      const d = getMatchDetail(id);
      hasil[id] = d
        ? {
            ok: true,
            home: d.pkg.payload.fixture.home,
            away: d.pkg.payload.fixture.away,
            status: d.keadaan?.status ?? null,
            market: d.pkg.payload.market ?? null,
            p1x2home: d.pkg.payload.probabilities["1x2:1"] ?? null,
          }
        : { ok: false, alasan: "null (paket tidak ditemukan)" };
    } catch (e) {
      hasil[id] = { ok: false, alasan: e instanceof Error ? e.message : String(e) };
    }
  }
  cetak(hasil);
} else if (aksi === "status") {
  const state = getMatchState("sm_19879501");
  const status = displayStatus("scheduled");
  cetak({
    state,
    statusDariScheduled: status,
    label: STATUS_LABEL_ID[status],
    labelMenungguAda: (Object.values(STATUS_LABEL_ID) as string[]).includes(
      "Menunggu pembaruan pertandingan",
    ),
    // Langkah 2: label menunggu hidup di peta label TAMPIL (status dasar
    // tetap 7 anggota); label keadaan = labelStatus atas status tampil.
    labelTampilAda: (Object.values(LABEL_STATUS_TAMPIL) as string[]).includes(
      "Menunggu pembaruan pertandingan",
    ),
    labelKeadaan: state ? labelStatus(state.status, state.menit) : null,
  });
} else if (aksi === "arsip") {
  const now = "2026-11-21T12:00:00.000Z";
  const f19: FilterRekam = {
    pasar: null, kelas: null, liga: null,
    dari: "2026-11-19", sampai: "2026-11-19", tz: "Asia/Jakarta",
  };
  const r19 = ambilRekam(f19, now);
  const fAll: FilterRekam = {
    pasar: null, kelas: null, liga: null, dari: null, sampai: null, tz: "Asia/Jakarta",
  };
  const rAll = ambilRekam(fAll, now);
  cetak({
    f19: {
      issued: r19.stats.issued,
      settled: r19.stats.settled,
      hitRatio: r19.stats.hit_ratio,
      empty: r19.stats.empty,
      overdue: r19.stats.overdue_pending,
      notStarted: r19.stats.not_started,
      coverage: r19.stats.coverage,
      baris: r19.baris.length,
      keadaanUnik: [...new Set(r19.baris.map((b) => b.keadaan))],
    },
    semua: {
      barisPertama: rAll.baris[0]
        ? { kickoff: rAll.baris[0].kickoff_utc, keadaan: rAll.baris[0].keadaan }
        : null,
      belumMulaiDi200Awal: rAll.baris
        .slice(0, 200)
        .filter((b) => b.keadaan === "belum-mulai").length,
    },
  });
} else {
  console.error(`aksi tidak dikenal: ${aksi}`);
  process.exit(2);
}
