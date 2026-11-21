/**
 * Probe adapter untuk VERIFIKASI PRODUKSI temuan #1 — dijalankan
 * sebagai SUBPROSES dari tests/test-verifikasi-genclerbirligi.ts
 * dengan cwd = sandbox. Mengimpor modul repo persis seperti server
 * produksi dan mencetak `PROBE_JSON`.
 *
 * Aksi: umpan | identitas
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { combineSlip, type SlipPick } from "../../lib/web/parlay";
import { daftarPilihanPraLaga } from "../../lib/web/rekam";
import { getPackageMatrix } from "../../lib/web/data";
import {
  getFixtureByUid,
  getSiblingIds,
  getUidForMatchId,
  resolveFixtureIdentity,
} from "../../lib/identity/fixture-resolver";
import { FD_06, FD_21, SM_06, SM_21, UID_FD_06, UID_FD_21 } from "./verifikasi-seeds";

const aksi = process.argv[2];

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

const IDS = [
  FD_21, SM_21, FD_06, SM_06,
  "fd_T1_20270418_genclerbirligi_gaziantep", "sm_19746999",
  "sm_910001", "sm_910002", "sm_910003", "sm_910004",
];

function bukaDataset(): DatabaseSync {
  return new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"), {
    readOnly: true,
  });
}

if (aksi === "umpan") {
  // Jam beku SEBELUM kickoff 10:30Z (persis syarat reproduksi pemilik:
  // jam sebelum 17.30 WIB 21 Nov).
  const now = "2026-11-21T00:00:00.000Z";
  const picks = daftarPilihanPraLaga(now);
  const kejadian = picks.map((p) => ({
    market: p.market,
    selection: p.selection,
    line: p.line,
    prob: p.published_prob,
    match_id: p.match_id,
    pick_uid: p.pick_uid,
    fixture_uid: p.fixture_uid,
    konflik:
      p.konflik === null
        ? null
        : p.konflik.nilai.map((n) => ({
            prob: n.published_prob,
            match_id: n.match_id,
            pick_uid: n.pick_uid,
          })),
  }));
  const keSlip = (p: (typeof picks)[number], key: string): SlipPick => ({
    key,
    matchId: p.fixture_uid,
    market: p.market,
    selection: p.selection,
    prob: p.published_prob,
    probBasis: "lab",
    matrix: p.package_id !== null ? getPackageMatrix(p.package_id) : null,
  });
  // Alur pemilik: kejadian "tim kandang mencetak gol" ditambah dari
  // SETIAP baris yang menampilkannya (pra-perbaikan: dua baris).
  const target = picks.filter(
    (p) => p.market === "team_over05_home" && p.selection === "yes",
  );
  const gTarget = combineSlip(target.map((p) => keSlip(p, p.pick_uid)));
  // Tambah dua kali kejadian yang sama (kunci baris berbeda, kejadian
  // semantik sama) — tidak boleh dikuadratkan.
  let ganda: unknown = null;
  if (target.length > 0) {
    const g = combineSlip([keSlip(target[0], "alias-fd"), keSlip(target[0], "alias-sm")]);
    ganda = { kelompok: g.groups.length, gabungan: g.combined };
  }
  // Slip semua kejadian tanpa konflik.
  const bisa = picks.filter((p) => p.konflik === null);
  const gSemua = combineSlip(bisa.map((p) => keSlip(p, p.pick_uid)));

  const ds = bukaDataset();
  const uids: Record<string, string | null> = {};
  for (const id of IDS) {
    try {
      uids[id] = getUidForMatchId(ds, id);
    } catch {
      uids[id] = null;
    }
  }
  const saudaraSm = getSiblingIds(ds, SM_21);
  const saudaraFd = getSiblingIds(ds, FD_21);
  ds.close();
  cetak({
    totalKejadian: picks.length,
    kejadian,
    target: {
      jumlah: target.length,
      kelompok: gTarget.groups.length,
      gabungan: gTarget.combined,
    },
    ganda,
    gabungSemua: {
      pilihan: bisa.length,
      kelompok: gSemua.groups.length,
      gabungan: gSemua.combined,
    },
    uids,
    saudaraSm,
    saudaraFd,
  });
} else if (aksi === "identitas") {
  const ds = new DatabaseSync(path.join(process.cwd(), "data", "thestats_dataset.db"));
  const fx21 = getFixtureByUid(ds, UID_FD_21);
  const fx06 = getFixtureByUid(ds, UID_FD_06);
  // Observasi resolver PASCA-penautan: kedua sumber harus 'known' ke
  // fixture yang sudah ada — bukan ambigu, bukan fixture baru.
  const sekarang = "2026-11-21T01:00:00.000Z";
  const obsSm = resolveFixtureIdentity(
    ds,
    {
      source: "sportmonks", sourceMatchId: SM_21, competitionId: "sm:600",
      homeCid: "sm:286", awayCid: "sm:4192",
      homeName: "Gençlerbirliği", awayName: "Gaziantep F.K.",
      kickoffUtc: "2026-11-21T10:30:00.000Z", kickoffPrecision: "exact",
    },
    sekarang,
  );
  const obsFd = resolveFixtureIdentity(
    ds,
    {
      source: "football-data", sourceMatchId: FD_21, competitionId: "T1",
      homeCid: "sm:286", awayCid: "sm:4192",
      homeName: "Genclerbirligi", awayName: "Gaziantep",
      kickoffUtc: "2026-11-21T10:30:00.000Z", kickoffPrecision: "exact",
    },
    sekarang,
  );
  const obsSm06 = resolveFixtureIdentity(
    ds,
    {
      source: "sportmonks", sourceMatchId: SM_06, competitionId: "sm:600",
      homeCid: "sm:4192", awayCid: "sm:1071",
      homeName: "Gaziantep F.K.", awayName: "Kasımpaşa",
      kickoffUtc: "2026-11-06T17:00:00.000Z", kickoffPrecision: "exact",
    },
    sekarang,
  );
  ds.close();
  cetak({
    fx21: fx21
      ? { competition_id: fx21.competition_id, home_cid: fx21.home_cid, away_cid: fx21.away_cid, state: fx21.state }
      : null,
    fx06: fx06
      ? { competition_id: fx06.competition_id, home_cid: fx06.home_cid, away_cid: fx06.away_cid, state: fx06.state }
      : null,
    obsSm,
    obsFd,
    obsSm06,
  });
} else {
  console.error(`aksi tidak dikenal: ${aksi}`);
  process.exit(2);
}
