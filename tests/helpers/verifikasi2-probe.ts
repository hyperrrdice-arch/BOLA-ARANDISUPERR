/**
 * Probe adapter untuk VERIFIKASI PRODUKSI temuan #2 — dijalankan
 * sebagai SUBPROSES dari tests/test-verifikasi-marseille-detail.ts
 * dengan cwd = sandbox. Mengimpor modul repo persis seperti server
 * produksi dan mencetak `PROBE_JSON`.
 *
 * Aksi: detail — getMatchDetail untuk KEDUA URL lama Marseille
 * (mt_022917440 + sm_19715544): hitungan mentah officialPicks,
 * kejadian terkelompok kejadianResmi, plus umpan Pilihan pada jam
 * beku yang sama untuk pembuktian konsistensi antar-permukaan.
 */
import { getMatchDetail } from "../../lib/web/data";
import { daftarPilihanPraLaga } from "../../lib/web/rekam";

const aksi = process.argv[2];

function cetak(obj: unknown): void {
  console.log(`PROBE_JSON ${JSON.stringify(obj)}`);
}

const bulat4 = (x: number) => Math.round(x * 10_000) / 10_000;

if (aksi === "detail") {
  const hasil: Record<string, unknown> = {};
  for (const id of ["mt_022917440", "sm_19715544"]) {
    const d = getMatchDetail(id);
    hasil[id] = d
      ? {
          mentah: d.officialPicks.length,
          kejadian: d.kejadianResmi.map((k) => ({
            kunci: `${k.pick.market}:${k.pick.selection}`,
            line: k.pick.line ?? "",
            prob: k.pick.published_prob === null ? null : bulat4(k.pick.published_prob),
            pick_uid: k.pick.pick_uid,
            edisi: k.edisi.map((e) => ({
              prob: e.published_prob === null ? null : bulat4(e.published_prob),
              match_id: e.match_id,
              pick_uid: e.pick_uid,
              published_at_utc: e.published_at_utc,
            })),
            konflik:
              k.konflik === null
                ? null
                : k.konflik.nilai.map((n) => ({
                    prob: bulat4(n.published_prob),
                    match_id: n.match_id,
                    pick_uid: n.pick_uid,
                    published_at_utc: n.published_at_utc,
                  })),
          })),
        }
      : null;
  }
  // Umpan Pilihan pada jam beku sebelum kickoff (2026-11-22T19:45Z):
  // permukaan pembanding yang aturannya harus sama persis.
  const umpan = daftarPilihanPraLaga("2026-11-21T00:00:00.000Z");
  hasil.umpan = umpan.map((p) => ({
    kunci: `${p.market}:${p.selection}`,
    line: p.line ?? "",
    prob: bulat4(p.published_prob),
    konflik:
      p.konflik === null
        ? null
        : p.konflik.nilai.map((n) => ({
            prob: bulat4(n.published_prob),
            match_id: n.match_id,
            pick_uid: n.pick_uid,
            published_at_utc: n.published_at_utc,
          })),
  }));
  cetak(hasil);
} else {
  console.error(`aksi tidak dikenal: ${aksi}`);
  process.exit(2);
}
