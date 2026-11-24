// PR 1B harness parity: snapshot keluaran jalur baca Beranda pada jam
// beku terhadap data staging yang TETAP (cwd = worktree, data/ = salinan
// produksi). Dua mode:
//   dump    — cetak JSON keluaran jalur LAMA (sorotanBeranda +
//             jadwalBerikutnya + ambilRekam) untuk disimpan sebagai
//             snapshot-sebelum; sesudah perubahan, dump ulang harus
//             menghasilkan berkas yang identik (diff kosong).
//   banding — dalam satu proses, bandingkan jalur BARU
//             (berandaSorotanDanJadwal + ambilRingkasanRekam) terhadap
//             jalur LAMA dengan serialisasi kanonik (kunci terurut);
//             keluar 1 bila ada selisih.
// Read-only terhadap data staging.
import * as data from "../../lib/web/data";
import * as rekam from "../../lib/web/rekam";
import type { FixtureListItem } from "../../lib/web/data";

const NOW_ISO = "2026-11-24T02:00:00.000Z";
const now = new Date(NOW_ISO);

function ringkasItem(i: FixtureListItem) {
  return {
    match_id: i.pkg.match_id,
    package_id: i.pkg.id,
    kickoff_utc: i.pkg.kickoff_utc,
    computed_utc: i.pkg.computed_utc,
    gate_status: i.pkg.gate_status,
    fixture: i.pkg.payload.fixture,
    pickCounts: i.pickCounts,
    topLeg: i.topLeg,
    result: i.result,
  };
}

function snapshotLama() {
  const sorotan = data.sorotanBeranda(now);
  const berikut = data.jadwalBerikutnya(sorotan, now);
  const r = rekam.ambilRekam(rekam.parseFilterRekam({}), NOW_ISO);
  return {
    now: NOW_ISO,
    sorotan,
    berikut: berikut.map(ringkasItem),
    rekam: { stats: r.stats, laga_dinilai_unik: r.laga_dinilai_unik },
  };
}

function snapshotBaru() {
  const gabung = (
    data as unknown as {
      berandaSorotanDanJadwal: (n: Date) => {
        sorotan: ReturnType<typeof data.sorotanBeranda>;
        berikut: FixtureListItem[];
      };
    }
  ).berandaSorotanDanJadwal(now);
  const ringkas = (
    rekam as unknown as {
      ambilRingkasanRekam: (
        f: ReturnType<typeof rekam.parseFilterRekam>,
        n: string,
      ) => { stats: unknown; laga_dinilai_unik: number };
    }
  ).ambilRingkasanRekam(rekam.parseFilterRekam({}), NOW_ISO);
  return {
    now: NOW_ISO,
    sorotan: gabung.sorotan,
    berikut: gabung.berikut.map(ringkasItem),
    rekam: { stats: ringkas.stats, laga_dinilai_unik: ringkas.laga_dinilai_unik },
  };
}

/** Serialisasi kanonik: kunci objek terurut rekursif. */
function kanonik(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(kanonik).join(",")}]`;
  if (v && typeof v === "object") {
    const ent = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${ent.map(([k, x]) => `${JSON.stringify(k)}:${kanonik(x)}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const mode = process.argv[2] ?? "dump";
if (mode === "dump") {
  console.log(JSON.stringify(snapshotLama(), null, 2));
} else if (mode === "banding") {
  const lama = kanonik(snapshotLama());
  const baru = kanonik(snapshotBaru());
  if (lama === baru) {
    console.log("PARITY OK: jalur baru identik dengan jalur lama pada jam beku + data tetap");
  } else {
    console.error("PARITY GAGAL: ada selisih jalur baru vs lama");
    // Tampilkan konteks selisih pertama.
    let i = 0;
    while (i < Math.min(lama.length, baru.length) && lama[i] === baru[i]) i++;
    console.error(`selisih pertama @${i}:`);
    console.error(`  lama: …${lama.slice(Math.max(0, i - 80), i + 120)}`);
    console.error(`  baru: …${baru.slice(Math.max(0, i - 80), i + 120)}`);
    process.exit(1);
  }
} else {
  console.error(`mode tak dikenal: ${mode} (pakai dump|banding)`);
  process.exit(2);
}
