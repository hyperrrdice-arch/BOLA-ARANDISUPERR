/**
 * TEST:REDESAIN-PETA — penerimaan §9 brief redesain (peta peluang skor).
 *
 * Semua angka adalah angka penerimaan brief yang dapat direproduksi
 * dari matriks demo Persada FC vs Rawa United (per-seribu):
 *   1–1 = 15,1% · 2–1 = 12,5% · kandang 43,3% · seri 30,5% ·
 *   tamu 26,2% · seri dalam peta 30,4% + 0,1% di luar · cakupan
 *   tampilan 97,1% · di luar peta 2,9%.
 * Plus kontrak validasi matriks di batas data, format sel, navigasi
 * keyboard (diagonal pada filter Seri), gerbang gerak papan skor,
 * bacaan skor akhir di luar peta, dan palet panas baru.
 *
 * Pakai: npx tsx tests/test-redesain-peta.ts (dirantai di test:web)
 */
import {
  MATRIKS_DEMO_PER_SERIBU,
  adaptasiMatriks,
  bacaSkorAkhir,
  formatPeluangSel,
  peluangSel,
  perluGerakSkor,
  ringkasMatriks,
  selDalamFilter,
  selSesuaiFilter,
  selTetangga,
} from "../lib/web/peta-skor";
import { heatStyle } from "../components/ui";
import { Suite } from "./helpers/fixture-env";

const suite = new Suite("redesain-peta");
const dekat = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/* ---------------------------------------------------------- adapter */
const demo = adaptasiMatriks(MATRIKS_DEMO_PER_SERIBU);
suite.check("adapter: matriks demo dikenali per-seribu", demo?.versi === "per-seribu");
const m = demo!.matrix;
suite.check("adapter: sel 1–1 menjadi proporsi 0,151", dekat(peluangSel(m, 1, 1)!, 0.151));
suite.check("adapter: sel 2–1 menjadi proporsi 0,125", dekat(peluangSel(m, 2, 1)!, 0.125));

const ketat = adaptasiMatriks([
  [0.25, 0.25],
  [0.25, 0.25],
]);
suite.eq("adapter: proporsi ketat", ketat?.versi, "proporsi-ketat");
const bulat = adaptasiMatriks([
  [0.33, 0.33],
  [0.33, 0.005],
]);
suite.eq("adapter: proporsi bulat historis diterima apa adanya", bulat?.versi, "proporsi-bulat");
suite.eq("adapter: array kosong → tidak tersedia", adaptasiMatriks([]), null);
suite.eq("adapter: baris timpang → tidak tersedia", adaptasiMatriks([[0.5, 0.5], [1]]), null);
suite.eq("adapter: nilai negatif → tidak tersedia", adaptasiMatriks([[1.1, -0.1]]), null);
suite.eq("adapter: NaN → tidak tersedia", adaptasiMatriks([[Number.NaN, 1]]), null);
suite.eq("adapter: sel null → tidak tersedia", adaptasiMatriks([[null, 1]]), null);
suite.eq("adapter: total jauh dari 1 → tidak tersedia", adaptasiMatriks([[0.2, 0.2]]), null);
suite.eq("adapter: bukan array → tidak tersedia", adaptasiMatriks("matriks"), null);

/* ------------------------------------------------- angka penerimaan */
const r = ringkasMatriks(m);
suite.check("penerimaan: total matriks 1", dekat(r.total, 1), `total=${r.total}`);
suite.check("penerimaan: Persada menang 43,3%", dekat(r.pKandang, 0.433), `${r.pKandang}`);
suite.check("penerimaan: seri 30,5%", dekat(r.pSeri, 0.305), `${r.pSeri}`);
suite.check("penerimaan: Rawa menang 26,2%", dekat(r.pTamu, 0.262), `${r.pTamu}`);
suite.check("penerimaan: cakupan tampilan 97,1%", dekat(r.cakupan, 0.971), `${r.cakupan}`);
suite.check("penerimaan: di luar peta 2,9%", dekat(r.sisa, 0.029), `${r.sisa}`);
suite.check("penerimaan: seri dalam peta 30,4%", dekat(r.seriDalamPeta, 0.304), `${r.seriDalamPeta}`);
suite.check("penerimaan: seri luar peta 0,1%", dekat(r.seriLuarPeta, 0.001), `${r.seriLuarPeta}`);
suite.check(
  "penerimaan: skor teratas 1–1 lalu 2–1",
  r.top[0].h === 1 && r.top[0].a === 1 && r.top[1].h === 2 && r.top[1].a === 1,
  JSON.stringify(r.top.slice(0, 2)),
);
suite.check("penerimaan: maks bidang = sel 1–1", dekat(r.maksBidang, 0.151));

/* ------------------------------------------------------------ format */
suite.eq("format: nol persis → 0%", formatPeluangSel(0), "0%");
suite.eq("format: positif <0,1% → <0,1%", formatPeluangSel(0.0005), "<0,1%");
suite.eq("format: 15,1%", formatPeluangSel(0.151), "15,1%");
suite.eq("format: 12,5%", formatPeluangSel(0.125), "12,5%");
suite.eq("format: 0,7%", formatPeluangSel(0.007), "0,7%");

/* ------------------------------------------------------------ filter */
suite.check("filter: 2–1 anggota kandang", selDalamFilter(2, 1, "kandang"));
suite.check("filter: 2–1 bukan anggota seri", !selDalamFilter(2, 1, "seri"));
const pindahSeri = selSesuaiFilter(m, "seri", { h: 2, a: 1 });
suite.check(
  "filter: keluar himpunan → pilihan pindah ke seri tertinggi (1–1)",
  pindahSeri?.h === 1 && pindahSeri?.a === 1,
  JSON.stringify(pindahSeri),
);
const tetapSeri = selSesuaiFilter(m, "seri", { h: 2, a: 2 });
suite.check(
  "filter: masih di himpunan → pilihan dipertahankan (2–2)",
  tetapSeri?.h === 2 && tetapSeri?.a === 2,
);
const pindahKandang = selSesuaiFilter(m, "kandang", { h: 1, a: 1 });
suite.check(
  "filter: ke kandang → sel kandang tertinggi (2–1)",
  pindahKandang?.h === 2 && pindahKandang?.a === 1,
  JSON.stringify(pindahKandang),
);

/* ----------------------------------------------------------- keyboard */
suite.eq("keyboard: seri — panah kanan menuruni diagonal", selTetangga(m, { h: 1, a: 1 }, "kanan", "seri"), { h: 2, a: 2 });
suite.eq("keyboard: seri — panah kiri menaiki diagonal", selTetangga(m, { h: 2, a: 2 }, "kiri", "seri"), { h: 1, a: 1 });
suite.eq("keyboard: seri — tepi diagonal diam", selTetangga(m, { h: 0, a: 0 }, "kiri", "seri"), { h: 0, a: 0 });
suite.eq("keyboard: semua — kanan berpindah kolom", selTetangga(m, { h: 0, a: 0 }, "kanan", "semua"), { h: 0, a: 1 });
suite.eq("keyboard: kandang — bawah ke anggota berikutnya", selTetangga(m, { h: 2, a: 1 }, "bawah", "kandang"), { h: 3, a: 1 });
suite.eq("keyboard: kandang — kanan hanya seri/tamu → diam", selTetangga(m, { h: 2, a: 1 }, "kanan", "kandang"), { h: 2, a: 1 });
suite.eq("keyboard: tamu — atas melompati kandang+seri ke anggota", selTetangga(m, { h: 4, a: 1 }, "atas", "tamu"), { h: 0, a: 1 });

/* ------------------------------------------------------- papan skor */
suite.check(
  "gerak: paket identik → diam",
  !perluGerakSkor({ status: "finished", home: 2, away: 1 }, { status: "finished", home: 2, away: 1 }),
);
suite.check(
  "gerak: koreksi skor → bergerak",
  perluGerakSkor({ status: "finished", home: 2, away: 1 }, { status: "finished", home: 2, away: 0 }),
);
suite.check(
  "gerak: status berubah → bergerak",
  perluGerakSkor({ status: "live", home: 1, away: 0 }, { status: "finished", home: 2, away: 1 }),
);
suite.check(
  "gerak: keadaan pertama → bergerak",
  perluGerakSkor(null, { status: "scheduled", home: null, away: null }),
);

/* ------------------------------------------------------- skor akhir */
const akhirDalam = bacaSkorAkhir(m, 2, 1);
suite.check("skor akhir: 2–1 di dalam peta", akhirDalam.dalamPeta);
suite.eq("skor akhir: bacaan 2–1 · 12,5%", akhirDalam.teks, "2–1 · 12,5%");
const akhirLuar = bacaSkorAkhir(m, 5, 1);
suite.check("skor akhir: 5–1 di luar peta", !akhirLuar.dalamPeta);
suite.eq(
  "skor akhir: 5–1 tidak dipindah ke 4–1, peluang persis ikut",
  akhirLuar.teks,
  "5–1 · Di luar peta 0–4 · 0,7%",
);

/* ------------------------------------------------------------- palet */
const panas = heatStyle(0.151, 0.151);
suite.check("palet: panas memakai jingga baru, bukan amber", panas.backgroundColor.includes("255, 105, 53"));
suite.eq("palet: teks di atas sel terpanas = tinta", panas.color, "#162723");
const dingin = heatStyle(0, 0.151);
suite.eq("palet: teks sel dingin = kertas", dingin.color, "#f8f7f2");

suite.finish();
