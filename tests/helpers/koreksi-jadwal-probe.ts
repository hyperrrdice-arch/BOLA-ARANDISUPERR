/**
 * KOREKSI-JADWAL PROBE — subprocess pembaca adapter Jadwal untuk suite
 * koreksi kickoff. Dijalankan dengan cwd = root env fixture; memanggil
 * listSchedule asli (lib/web/data.ts) untuk daftar jendela [dari, sampai)
 * yang diberikan sebagai argumen JSON, lalu mencetak satu baris
 * "PROBE_JSON " berisi per-jendela daftar item ringkas. Probe tidak
 * menilai apa pun — assertion hidup di suite pemanggil.
 *
 * Pakai: tsx tests/helpers/koreksi-jadwal-probe.ts '[["<dari>","<sampai>"], ...]'
 */
import { listSchedule } from "../../lib/web/data";

function main(): void {
  const windows = JSON.parse(process.argv[2] ?? "[]") as [string, string][];
  const out = windows.map(([dari, sampai]) =>
    listSchedule(dari, sampai).map((i) => ({
      match_id: i.match_id,
      fixture_uid: i.fixture_uid,
      kickoff_utc: i.kickoff_utc,
      package_id: i.package_id,
    })),
  );
  console.log(`PROBE_JSON ${JSON.stringify(out)}`);
}

main();
