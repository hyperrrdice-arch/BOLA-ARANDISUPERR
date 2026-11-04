/**
 * LEDGER BUKTI — catatan terbuka semua pilihan beserta hasilnya.
 *
 * Server Component murni, baca-saja dari ledger (ledgerStats). Prinsip
 * halamannya: pilihan tercatat SEBELUM kickoff dan dinilai dari skor
 * akhir — tidak ada yang dihapus, digeser, atau ditulis ulang sesudah
 * laga. Grade ditetapkan dari lab historis; tabel kejujuran di sini
 * menilai klaim itu pada pilihan live-run yang sudah selesai.
 */
import { Suspense } from "react";
import { EmptyState, GradeMark, MicroLabel, PageLoading, Prob, SectionHead } from "../../../components/ui";
import { connection } from "next/server";
import { landingStats, ledgerStats } from "../../../lib/web/data";
import { MARKET_LABEL, int, jamWibOnly, labelPilihan, pct, tanggalWib } from "../../../lib/web/format";

function fmtPp(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")} pp`;
}

function StatCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="panel p-4">
      <MicroLabel>{label}</MicroLabel>
      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">{note}</p>
    </div>
  );
}

const TH = "px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-faint";
const THR = "px-3 py-2 text-right font-mono text-[11px] uppercase tracking-wider text-faint";
const TD = "px-3 py-2 text-mid-gray";
const TDR = "px-3 py-2 text-right font-mono tabular-nums text-mid-gray";

export default function BuktiPage() {
  return (
    <Suspense fallback={<PageLoading label="Memuat ledger bukti…" />}>
      <BuktiContent />
    </Suspense>
  );
}

async function BuktiContent() {
  await connection();
  const s = ledgerStats();
  const labResolved = landingStats().lab_resolved;
  const belumAdaDinilai = s.live_resolved === 0;

  return (
    <div>
      <header className="mb-6">
        <MicroLabel>Terminal / Ledger Bukti</MicroLabel>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-wide text-ink">
          LEDGER <span className="text-accent">BUKTI</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mid-gray">
          Semua pilihan tercatat sebelum kickoff dan dinilai dari skor akhir pertandingan. Yang
          kena dan yang meleset sama-sama tampil — di situlah angka grade bisa diperiksa, bukan
          sekadar dipercaya.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Ringkasan ledger">
        <StatCard
          label="Pilihan lab (historis)"
          value={int(s.lab_total)}
          note="Populasi uji out-of-sample yang menetapkan grade per pasar."
        />
        <StatCard
          label="Lab sudah dinilai"
          value={int(labResolved)}
          note="Pilihan lab yang hasil pertandingannya sudah diketahui."
        />
        <StatCard
          label="Pilihan live-run"
          value={int(s.live_total)}
          note="Pilihan dari slate berjalan, tercatat sebelum kickoff."
        />
        <StatCard
          label="Live-run sudah dinilai"
          value={int(s.live_resolved)}
          note="Sampel bukti ke depan — kecil di awal, tumbuh tiap slate."
        />
      </section>

      {belumAdaDinilai ? (
        <div className="mt-6">
          <EmptyState
            title="Belum ada pilihan live-run yang dinilai"
            note="Begitu pertandingan dari slate pertama selesai, kejujuran per grade dan per pasar tampil di sini apa adanya."
          />
        </div>
      ) : (
        <>
          <section className="mt-8" aria-label="Kejujuran per grade">
            <SectionHead label="Kejujuran per grade — live-run" />
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-faint">
              Klaim adalah rata-rata probabilitas efektif pada pilihan yang sudah dinilai;
              selisih positif berarti hasil nyata lebih baik dari klaim, negatif berarti klaim
              terlalu percaya diri.
              {s.live_resolved < 100 &&
                ` Sampel live-run masih kecil (n=${int(s.live_resolved)}) — baca selisihnya sebagai arah awal, bukan vonis.`}
            </p>
            <div className="panel-flat mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline">
                    <th className={TH}>Grade</th>
                    <th className={THR}>Pilihan</th>
                    <th className={THR}>Dinilai</th>
                    <th className={THR}>Klaim rata-rata</th>
                    <th className={THR}>Kena nyata</th>
                    <th className={THR}>Selisih</th>
                  </tr>
                </thead>
                <tbody>
                  {s.by_grade.map((g) => (
                    <tr key={g.grade} className="border-b border-hairline last:border-b-0">
                      <td className={TD}>
                        <GradeMark grade={g.grade} />
                      </td>
                      <td className={TDR}>{int(g.n)}</td>
                      <td className={TDR}>{int(g.resolved)}</td>
                      <td className={TDR}>
                        <Prob value={g.claimed} />
                      </td>
                      <td className={TDR}>
                        <Prob value={g.hit_rate} />
                      </td>
                      <td
                        className={`${TDR} font-semibold ${
                          g.gap_pp === null ? "" : g.gap_pp >= 0 ? "text-sage" : "text-brick"
                        }`}
                      >
                        {fmtPp(g.gap_pp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {s.by_market.length > 0 && (
            <section className="mt-8" aria-label="Kejujuran per pasar">
              <SectionHead label="Per pasar — live-run yang sudah dinilai" />
              <div className="panel-flat mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className={TH}>Pasar</th>
                      <th className={THR}>Dinilai</th>
                      <th className={THR}>Kena</th>
                      <th className={THR}>Hit-rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.by_market.map((m) => (
                      <tr key={m.market} className="border-b border-hairline last:border-b-0">
                        <td className={`${TD} text-ink`}>{MARKET_LABEL[m.market] ?? m.market}</td>
                        <td className={TDR}>{int(m.n)}</td>
                        <td className={TDR}>{int(m.hits)}</td>
                        <td className={TDR}>
                          <Prob value={m.hit_rate} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {s.recent_resolved.length > 0 && (
            <section className="mt-8" aria-label="Pilihan terakhir yang dinilai">
              <SectionHead label="Terakhir dinilai" />
              <div className="panel-flat mt-3">
                <ul className="divide-y divide-hairline">
                  {s.recent_resolved.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <span className="font-mono text-[11px] text-faint">
                        {tanggalWib(p.kickoff_utc)} · {jamWibOnly(p.kickoff_utc)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">
                          {p.home} <span className="text-faint">vs</span> {p.away}
                        </span>
                        <span className="block truncate text-xs text-mid-gray">
                          {labelPilihan(p.market, p.selection, p.home, p.away)} · klaim{" "}
                          {pct(p.model_prob)}
                        </span>
                      </span>
                      <GradeMark grade={p.grade} />
                      <span className="font-mono text-sm tabular-nums text-ink">
                        {p.home_goals ?? "–"}–{p.away_goals ?? "–"}
                      </span>
                      <span
                        className={`w-16 text-right font-mono text-[11px] font-bold tracking-wider ${
                          p.hit === 1 ? "text-sage" : "text-brick"
                        }`}
                      >
                        {p.hit === 1 ? "KENA" : "MELESET"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
