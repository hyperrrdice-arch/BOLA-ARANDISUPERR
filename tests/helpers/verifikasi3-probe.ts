/**
 * Probe subproses suite temuan #3 verifikasi produksi (beban awal
 * /pilihan). Dijalankan dengan cwd = sandbox fixture-env; mencetak
 * satu baris "PROBE_JSON <json>" per aksi. Getter DB repo meng-cache
 * koneksi per proses, jadi lapisan web + route dibaca di sini.
 *
 * Aksi:
 * - umpan → ukuran umpan, halaman awal/berikutnya, pencarian server,
 *   saringan kelas/tanggal, dan perbandingan ukuran rakitan lama
 *   (semua pilihan + semua matriks) vs baru (halaman pertama saja).
 * - rute  → route /api/pilihan, /api/pilihan/matriks, dan
 *   /api/pilihan/pulih dipanggil sebagai handler; matematika gabungan
 *   dihitung dari matriks yang dikembalikan route matriks.
 */
import { daftarPilihanPraLaga } from "../../lib/web/rekam";
import { getPackageMatrix } from "../../lib/web/data";
import {
  FILTER_UMPAN_BAWAAN,
  halamanUmpan,
  kelompokkanPilihan,
  saringUmpan,
  keBuilderPick,
} from "../../lib/web/pilihan-umpan";
import { kunciSemantikPilihan } from "../../lib/web/draf";
import { kunciTanggal } from "../../lib/web/format";
import { combineSlip, type SlipPick } from "../../lib/web/parlay";

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

const aksi = process.argv[2];
const NOW = new Date().toISOString();

async function main(): Promise<void> {
if (aksi === "umpan") {
  const umpan = daftarPilihanPraLaga(NOW);
  const awal = halamanUmpan(umpan, FILTER_UMPAN_BAWAAN, 0);
  const kedua = halamanUmpan(umpan, FILTER_UMPAN_BAWAAN, 20);
  const kelasA = halamanUmpan(umpan, { kelas: "A", q: "", tanggal: "" }, 0);
  const semua = halamanUmpan(umpan, { kelas: "ALL", q: "", tanggal: "" }, 0);
  const cariKoge = halamanUmpan(umpan, { kelas: "AB", q: "koge", tanggal: "" }, 0);
  const cariKogeAksen = halamanUmpan(umpan, { kelas: "AB", q: "køge", tanggal: "" }, 0);

  // Posisi kelompok Køge pada pengelompokan penuh (bukti di luar 20 pertama).
  const kelompokPenuh = kelompokkanPilihan(saringUmpan(umpan, FILTER_UMPAN_BAWAAN).map(keBuilderPick));
  const indeksKoge = kelompokPenuh.findIndex((g) => g[0]?.home === "Køge BK");

  // Saringan tanggal memakai kunci tanggal laga Køge sendiri (atas
  // hasil saringan penuh, bukan halaman pertama).
  const koge = umpan.find((p) => p.home === "Køge BK");
  const perTanggal = koge
    ? (() => {
        const kunci = kunciTanggal(koge.kickoff_utc);
        const hasil = saringUmpan(umpan, { kelas: "ALL", q: "", tanggal: kunci });
        return {
          nHasil: hasil.length,
          memuatKoge: hasil.some((p) => p.home === "Køge BK"),
          semuaSatuTanggal: hasil.every((p) => kunciTanggal(p.kickoff_utc) === kunci),
        };
      })()
    : null;

  // Rakitan LAMA (props sebelum perbaikan): semua pilihan + semua matriks.
  const packageIds = new Set<number>();
  for (const p of umpan) if (p.package_id !== null) packageIds.add(p.package_id);
  const matrices: Record<number, number[][]> = {};
  let nNilai = 0;
  for (const pid of packageIds) {
    const m = getPackageMatrix(pid);
    if (m) {
      matrices[pid] = m;
      nNilai += m.flat().length;
    }
  }
  const byteLama = Buffer.byteLength(
    JSON.stringify({ picks: umpan.map(keBuilderPick), matrices }),
  );
  const byteBaru = Buffer.byteLength(JSON.stringify(awal));
  // Tanda tangan baris pertama matriks regresi tidak boleh muncul di halaman awal.
  const tandaMatriks = "0.06,0.07,0.055";
  const halamanMengandungMatriks = JSON.stringify(awal).includes(tandaMatriks);

  cetak({
    totalUmpan: umpan.length,
    awal: {
      nPilihan: awal.pilihan.length,
      totalPilihan: awal.totalPilihan,
      totalLaga: awal.totalLaga,
      grup: kelompokkanPilihan(awal.pilihan).length,
    },
    kedua: { nPilihan: kedua.pilihan.length, totalLaga: kedua.totalLaga },
    kelasA: { totalPilihan: kelasA.totalPilihan, totalLaga: kelasA.totalLaga },
    semua: { totalPilihan: semua.totalPilihan, totalLaga: semua.totalLaga },
    cariKoge: {
      totalLaga: cariKoge.totalLaga,
      nPilihan: cariKoge.pilihan.length,
      home: cariKoge.pilihan[0]?.home ?? null,
    },
    cariKogeAksen: { totalLaga: cariKogeAksen.totalLaga },
    indeksKoge,
    perTanggal,
    ukuran: {
      byteLama,
      byteBaru,
      nMatriksLama: Object.keys(matrices).length,
      nNilai,
      halamanMengandungMatriks,
    },
  });
} else if (aksi === "rute") {
  const ruteDaftar = await import("../../app/api/pilihan/route");
  const ruteMatriks = await import("../../app/api/pilihan/matriks/route");
  const rutePulih = await import("../../app/api/pilihan/pulih/route");
  const umpan = daftarPilihanPraLaga(NOW);
  const beng = umpan.find((p) => p.pick_uid === "pk_t_b1");
  const sha = umpan.find((p) => p.pick_uid === "pk_t_s1");
  if (!beng || !sha || beng.package_id === null || sha.package_id === null) {
    throw new Error("fixture regresi tidak lengkap");
  }

  const daftar = await ruteDaftar.GET(new Request("http://uji/api/pilihan?kelas=AB"));
  const daftarJson = (await daftar.json()) as {
    pilihan: unknown[];
    totalPilihan: number;
    totalLaga: number;
  };
  const daftarKoge = await ruteDaftar.GET(
    new Request("http://uji/api/pilihan?q=koge"),
  );
  const daftarKogeJson = (await daftarKoge.json()) as { totalLaga: number };
  const daftarHal2 = await ruteDaftar.GET(
    new Request("http://uji/api/pilihan?kelas=AB&offset=20"),
  );
  const daftarHal2Json = (await daftarHal2.json()) as { pilihan: unknown[] };

  const idBeng = beng.package_id;
  const idSha = sha.package_id;
  const mat = await ruteMatriks.GET(
    new Request(
      `http://uji/api/pilihan/matriks?paket=${idBeng},${idSha},999999,${idBeng}`,
    ),
  );
  const matJson = (await mat.json()) as {
    matriks: Record<string, number[][] | null>;
  };

  // Matematika gabungan dari matriks HASIL ROUTE (jalur lazy penuh):
  // Bengaluru dua pilihan → 52,9%; tambah Shabab → 46,1%.
  const slip: SlipPick[] = [
    { key: "pk_t_b1", matchId: beng.fixture_uid, market: "team_over05_home", selection: "yes", prob: 0.761, probBasis: "lab", matrix: matJson.matriks[String(idBeng)] },
    { key: "pk_t_b2", matchId: beng.fixture_uid, market: "ou35", selection: "under", prob: 0.749, probBasis: "lab", matrix: matJson.matriks[String(idBeng)] },
  ];
  const gabDua = combineSlip(slip);
  const gabTiga = combineSlip([
    ...slip,
    { key: "pk_t_s1", matchId: sha.fixture_uid, market: "team_over05_home", selection: "yes", prob: 0.872, probBasis: "lab", matrix: null },
  ]);
  // Jalur kegagalan: matriks null untuk irisan satu laga → tidak tersedia.
  const gabGagal = combineSlip(slip.map((s) => ({ ...s, matrix: null })));

  const kunci = (uid: string, market: string, line: string, selection: string) =>
    kunciSemantikPilihan(uid, market, line, selection);
  const pulih = await rutePulih.POST(
    new Request("http://uji/api/pilihan/pulih", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entri: [
          { pickUid: "pk_t_b1", kunciSemantik: kunci(beng.fixture_uid, "team_over05_home", "", "yes") },
          { pickUid: "pk_sudah_tidak_ada", kunciSemantik: kunci(sha.fixture_uid, "team_over05_home", "", "yes") },
          { pickUid: "pk_asing", kunciSemantik: "uid-asing|dc||1x" },
        ],
      }),
    }),
  );
  const pulihJson = (await pulih.json()) as {
    pilihan: { key: string }[];
    hilang: number;
  };
  const pulihRusak = await rutePulih.POST(
    new Request("http://uji/api/pilihan/pulih", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entri: "bukan-array" }),
    }),
  );
  const pulihBukanJson = await rutePulih.POST(
    new Request("http://uji/api/pilihan/pulih", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );

  cetak({
    daftar: {
      status: daftar.status,
      totalPilihan: daftarJson.totalPilihan,
      totalLaga: daftarJson.totalLaga,
      nPilihan: daftarJson.pilihan.length,
    },
    daftarKoge: { totalLaga: daftarKogeJson.totalLaga },
    daftarHal2: { nPilihan: daftarHal2Json.pilihan.length },
    matriks: {
      status: mat.status,
      kunci: Object.keys(matJson.matriks).sort(),
      bengSama: JSON.stringify(matJson.matriks[String(idBeng)]) ===
        JSON.stringify(getPackageMatrix(idBeng)),
      shaNull: matJson.matriks[String(idSha)] === null,
      asingNull: matJson.matriks["999999"] === null,
    },
    gabungan: {
      dua: gabDua.combined,
      tiga: gabTiga.combined,
      gagalNull: gabGagal.combined === null,
      gagalAlasan: gabGagal.alasanGabungan,
    },
    pulih: {
      status: pulih.status,
      keys: pulihJson.pilihan.map((p) => p.key),
      hilang: pulihJson.hilang,
      statusRusak: pulihRusak.status,
      statusBukanJson: pulihBukanJson.status,
    },
  });
} else {
  console.error(`aksi tak dikenal: ${aksi}`);
  process.exit(2);
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
