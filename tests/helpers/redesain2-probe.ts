/**
 * Probe adapter untuk KEANDALAN redesain — Langkah 2 (branch
 * redesain/bola). Dijalankan sebagai SUBPROSES dari
 * tests/test-redesain-keandalan.ts dengan cwd = sandbox. Mengimpor
 * modul repo persis seperti server produksi dan mencetak `PROBE_JSON`.
 *
 * Aksi: umpan | status | status-unit | isolasi
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { combineSlip, type SlipPick } from "../../lib/web/parlay";
import { daftarPilihanPraLaga } from "../../lib/web/rekam";
import {
  getForm,
  getMatchDetail,
  getMatchState,
  getPackageMatrix,
  listSchedule,
} from "../../lib/web/data";
import {
  labelStatus,
  menitDariStatusMentah,
  statusTampil,
  terapkanWaktu,
  displayStatus,
} from "../../lib/web/status";
import { getUidForMatchId } from "../../lib/identity/fixture-resolver";
import { dbPath } from "../../lib/db/paths";

const aksi = process.argv[2];

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

if (aksi === "umpan") {
  const now = "2026-11-21T00:00:00.000Z";
  const picks = daftarPilihanPraLaga(now);
  const ringkas = picks.map((p) => ({
    market: p.market,
    selection: p.selection,
    line: p.line,
    prob: p.published_prob,
    match_id: p.match_id,
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
  // Slip persis konstruksi builder: SlipPick dari umpan, matchId = UID
  // fisik. Kejadian OU1.5 ditambah DUA KALI (seolah lewat dua alias)
  // dengan kunci baris berbeda — gabungan tidak boleh mengkuadratkan.
  const ou = picks.find((p) => p.market === "ou15" && p.selection === "over");
  let gabungOu: unknown = null;
  if (ou) {
    // Persis konstruksi ParlayBuilder: matriks skor paket ikut serta,
    // sehingga kejadian yang sama dihitung dari matriks SATU kali.
    const mk = (key: string): SlipPick => ({
      key,
      matchId: ou.fixture_uid,
      market: ou.market,
      selection: ou.selection,
      prob: ou.published_prob,
      probBasis: "lab",
      matrix: ou.package_id !== null ? getPackageMatrix(ou.package_id) : null,
    });
    const g = combineSlip([mk("alias-sm"), mk("alias-mt")]);
    gabungOu = { kelompok: g.groups.length, hitungGrup: g.groups[0]?.count, gabungan: g.combined };
  }
  // Slip gabungan dari SEMUA pilihan yang bisa digabung (konflik absen).
  const bisa = picks.filter((p) => p.konflik === null);
  const slipSemua: SlipPick[] = bisa.map((p) => ({
    key: p.pick_uid,
    matchId: p.fixture_uid,
    market: p.market,
    selection: p.selection,
    prob: p.published_prob,
    probBasis: "lab",
    matrix: p.package_id !== null ? getPackageMatrix(p.package_id) : null,
  }));
  const gSemua = combineSlip(slipSemua);
  const ds = new DatabaseSync(dbPath("thestats_dataset.db"), {
    readOnly: true,
  });
  const uids: Record<string, string | null> = {};
  for (const id of ["sm_19715544", "mt_022917440", "mt_377265875", "sm_19715561", "mt_155794033"]) {
    try {
      uids[id] = getUidForMatchId(ds, id);
    } catch {
      uids[id] = null;
    }
  }
  ds.close();
  cetak({
    totalKejadian: picks.length,
    kejadian: ringkas,
    gabungOu,
    gabungSemua: {
      pilihan: slipSemua.length,
      kelompok: gSemua.groups.length,
      gabungan: gSemua.combined,
    },
    uids,
  });
} else if (aksi === "status") {
  // Jam beku terhadap kickoff Barcelona W 2026-11-19T20:00Z dan
  // Rostov 2026-11-20T16:30Z — katalog sumber tetap 'scheduled'.
  const barca = "sm_19879501";
  const rostov = "sm_19726740";
  const ko19 = Date.parse("2026-11-19T20:00:00.000Z");
  const koRos = Date.parse("2026-11-20T16:30:00.000Z");
  const keadaan = (id: string, nowMs: number) => {
    const k = getMatchState(id, nowMs);
    return k ? { status: k.status, label: labelStatus(k.status, k.menit), menit: k.menit } : null;
  };
  const jadwal = listSchedule("2026-11-19T00:00:00.000Z", "2026-11-21T00:00:00.000Z");
  const itemBarca = jadwal.find((i) => i.match_id === barca);
  cetak({
    barcaSebelum: keadaan(barca, ko19 - 60_000),
    barcaTepat: keadaan(barca, ko19),
    barca24jam: keadaan(barca, ko19 + 24 * 3_600_000),
    rostov35jam: keadaan(rostov, koRos + 3.5 * 3_600_000),
    rostovSebelum: keadaan(rostov, koRos - 60_000),
    jadwalBarca: itemBarca
      ? { status: itemBarca.status, label: labelStatus(itemBarca.status) }
      : null,
  });
} else if (aksi === "status-unit") {
  const ko = "2026-11-20T16:30:00.000Z";
  const koMs = Date.parse(ko);
  const kasus: Record<string, unknown> = {};
  const uji = (
    nama: string,
    mentah: string | null,
    kickoff: string | null,
    nowMs: number,
  ) => {
    const s = statusTampil(mentah, kickoff, nowMs);
    kasus[nama] = { status: s, label: labelStatus(s) };
  };
  uji("sebelum", "scheduled", ko, koMs - 60_000);
  uji("tepat-kickoff", "scheduled", ko, koMs);
  uji("plus-3.5jam", "scheduled", ko, koMs + 3.5 * 3_600_000);
  uji("plus-24jam", "scheduled", ko, koMs + 24 * 3_600_000);
  uji("live-sumber", "live", ko, koMs + 30 * 60_000);
  kasus["menit-dari-mentah"] = menitDariStatusMentah("63'");
  kasus["menit-null"] = menitDariStatusMentah("live");
  kasus["label-live-menit"] = labelStatus("live", 63);
  uji("ditunda", "postponed", ko, koMs + 24 * 3_600_000);
  uji("dibatalkan", "cancelled", ko, koMs + 24 * 3_600_000);
  uji("ft", "FT", ko, koMs + 3 * 3_600_000);
  uji("selesai-tanpa-skor", "finished", ko, koMs + 3 * 3_600_000);
  uji("tak-dikenal-lewat", "apa-ini", ko, koMs + 3_600_000);
  uji("terjadwal-tanpa-kickoff", "scheduled", null, koMs + 3_600_000);
  kasus["terapkan-scheduled"] = terapkanWaktu(displayStatus("scheduled"), ko, koMs - 1);
  cetak(kasus);
} else if (aksi === "isolasi") {
  // Dataset sandbox TIDAK punya team_match_logs_canonical (tabel bantu
  // telemetri belum dibangun) — keadaan persis temuan samping L1.
  const ds = new DatabaseSync(dbPath("thestats_dataset.db"), {
    readOnly: true,
  });
  let tabelFormAda = true;
  try {
    ds.prepare("SELECT 1 FROM team_match_logs_canonical LIMIT 1").get();
  } catch {
    tabelFormAda = false;
  }
  ds.close();
  let formLangsung: unknown = "melempar";
  try {
    formLangsung = getForm("Rostov", "2026-11-20T16:30:00.000Z").length;
  } catch (e) {
    formLangsung = `melempar: ${e instanceof Error ? e.message : String(e)}`;
  }
  let detail: unknown = null;
  try {
    const d = getMatchDetail("sm_19726740");
    detail = d
      ? {
          ok: true,
          home: d.pkg.payload.fixture.home,
          market: d.pkg.payload.market ?? null,
          p1x2home: d.pkg.payload.probabilities["1x2:1"] ?? null,
          formHome: d.formHome.length,
          formAway: d.formAway.length,
          keadaanStatus: d.keadaan?.status ?? null,
        }
      : { ok: false, alasan: "null" };
  } catch (e) {
    detail = { ok: false, alasan: e instanceof Error ? e.message : String(e) };
  }
  cetak({ tabelFormAda, formLangsung, detail });
} else {
  console.error(`aksi tidak dikenal: ${aksi}`);
  process.exit(2);
}
