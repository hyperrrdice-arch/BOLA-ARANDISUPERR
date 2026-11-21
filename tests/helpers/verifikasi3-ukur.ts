/**
 * Pengukur muatan /pilihan untuk temuan #3 verifikasi produksi.
 * Dijalankan dengan cwd = direktori panggung (getter DB membaca data
 * relatif terhadap cwd). Mencetak satu baris "UKUR_JSON <json>".
 *
 * Mode:
 * - lama → rakitan halaman SEBELUM perbaikan: seluruh pilihan resmi +
 *   matriks SEMUA paket (persis page.tsx lama), di-JSON-kan sebagai
 *   props serial builder.
 * - baru → rakitan SESUDAH perbaikan: ringkasan 20 kelompok pertama
 *   filter bawaan + total terfilter; nol matriks.
 *
 * Angka yang dilaporkan: byte JSON mentah, byte sesudah gzip (perkiraan
 * transfer), jumlah pilihan, jumlah matriks, jumlah nilai matriks.
 */
import { gzipSync } from "node:zlib";
import { daftarPilihanPraLaga } from "../../lib/web/rekam";
import { getPackageMatrix } from "../../lib/web/data";

const mode = process.argv[2];
const now = new Date().toISOString();
let picks: ReturnType<typeof daftarPilihanPraLaga> = [];

function lapor(label: string, payload: unknown, nMatriks: number, nNilai: number): void {
  const json = JSON.stringify(payload);
  console.log(
    `UKUR_JSON ${JSON.stringify({
      mode: label,
      byteMentah: Buffer.byteLength(json),
      byteGzip: gzipSync(json).length,
      nPilihan: picks.length,
      nMatriks,
      nNilai,
    })}`,
  );
}

async function main(): Promise<void> {
  picks = daftarPilihanPraLaga(now);
  if (mode === "lama") {
  // Persis rakitan page.tsx sebelum perbaikan temuan #3.
  const packageIds = new Set<number>();
  for (const p of picks) if (p.package_id !== null) packageIds.add(p.package_id);
  const matrices: Record<number, number[][]> = {};
  let nNilai = 0;
  for (const pid of packageIds) {
    const m = getPackageMatrix(pid);
    if (m) {
      matrices[pid] = m;
      nNilai += m.flat().length;
    }
  }
  const builderPicks = picks.map((p) => ({
    key: p.pick_uid,
    matchId: p.match_id,
    fixtureUid: p.fixture_uid,
    kickoffUtc: p.kickoff_utc,
    home: p.home,
    away: p.away,
    competitionName: p.competition_name,
    gateStatus: p.gate_status,
    grade: p.grade,
    market: p.market,
    selection: p.selection,
    line: p.line,
    prob: p.published_prob,
    probBasis: p.probability_basis === "effective" ? "lab" : "model",
    basisTerbit: p.probability_basis,
    publishedAtUtc: p.published_at_utc,
    modelProb: p.model_prob,
    sourcesAgree: p.sources_agree,
    packageId: p.package_id,
    konflik: p.konflik
      ? { nilai: p.konflik.nilai.map((n) => ({ prob: n.published_prob, matchId: n.match_id })) }
      : null,
  }));
    lapor("lama", { picks: builderPicks, matrices }, Object.keys(matrices).length, nNilai);
  } else if (mode === "baru") {
    const { halamanUmpan } = await import("../../lib/web/pilihan-umpan");
    const hal = halamanUmpan(picks, { kelas: "AB", q: "", tanggal: "" }, 0);
    lapor(
      "baru",
      { pilihan: hal.pilihan, totalPilihan: hal.totalPilihan, totalLaga: hal.totalLaga },
      0,
      0,
    );
  } else {
    console.error(`mode tak dikenal: ${mode} (pakai "lama" atau "baru")`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
