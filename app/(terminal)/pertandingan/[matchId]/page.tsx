/**
 * ANALISIS PERTANDINGAN — satu paket kuant lengkap per laga:
 * probabilitas 3 sumber, matriks skor, asal angka, form, keberuntungan,
 * dan pilihan yang tercatat beserta hasil akhirnya.
 */
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getMatchDetail, type FormEntry, type PickRow } from "@/lib/web/data";
import {
  labelPilihan,
  num,
  pct,
  tanggalJamWib,
  tanggalWib,
} from "@/lib/web/format";
import {
  EmptyState,
  FormChips,
  GateStatus,
  GradeMark,
  MicroLabel,
  PageLoading,
  Prob,
  SectionHead,
  heatStyle,
} from "@/components/ui";

/* ------------------------------------------------------------ luck types */

interface LuckSide {
  status: string;
  net_luck_rating: number;
  sample_size: number;
  total_goals_for: number;
  total_xg_for: number;
  total_goals_against: number;
  total_xg_against: number;
  description?: string;
}
interface LuckMetrics {
  home: LuckSide;
  away: LuckSide;
  luck_disparity: number;
  market_bias_warning: string | null;
}

/* ------------------------------------------------------- probability rows */

const PROB_ROWS: { market: string; selection: string }[] = [
  { market: "1x2", selection: "1" },
  { market: "1x2", selection: "x" },
  { market: "1x2", selection: "2" },
  { market: "dc", selection: "1x" },
  { market: "dc", selection: "12" },
  { market: "dc", selection: "x2" },
  { market: "ou15", selection: "over" },
  { market: "ou15", selection: "under" },
  { market: "ou25", selection: "over" },
  { market: "ou25", selection: "under" },
  { market: "ou35", selection: "over" },
  { market: "ou35", selection: "under" },
  { market: "btts", selection: "yes" },
  { market: "btts", selection: "no" },
  { market: "team_over05_home", selection: "yes" },
  { market: "team_over05_away", selection: "yes" },
];

function signed(n: number, digits = 2): string {
  const s = num(Math.abs(n), digits);
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${s}`;
}

/* ------------------------------------------------------------------- page */

export default function AnalisisPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  return (
    <Suspense fallback={<PageLoading label="Memuat analisis pertandingan…" />}>
      <AnalisisContent params={params} />
    </Suspense>
  );
}

async function AnalisisContent({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  await connection();
  const detail = getMatchDetail(matchId);
  if (!detail) notFound();

  const { pkg, picks, result, formHome, formAway } = detail;
  const p = pkg.payload;
  const f = p.fixture;
  const home = f.home;
  const away = f.away;

  const resolved = picks.filter((x) => x.hit !== null);
  const hits = resolved.filter((x) => x.hit === 1).length;

  const luck = (p.shrunk_metadata?.luckMetrics ?? null) as LuckMetrics | null;

  const matrix = p.score_matrix ?? [];
  const cut = matrix.slice(0, 6).map((row) => row.slice(0, 6));
  const maxCell = cut.reduce((m, row) => row.reduce((a, v) => Math.max(a, v), m), 0);

  return (
    <div className="space-y-10">
      <Link
        href="/pertandingan"
        className="inline-block font-mono text-xs tracking-wider text-mid-gray hover:text-accent"
      >
        ← SEMUA PERTANDINGAN
      </Link>

      {/* ---------------------------------------------------------- kepala */}
      <header>
        <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-wide text-ink leading-none">
          {home} <span className="text-faint">vs</span> {away}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-mid-gray">
          <span>{f.competition_name}</span>
          <span aria-hidden="true">•</span>
          <span>{tanggalJamWib(f.kickoff_utc)}</span>
          <GateStatus status={pkg.gate_status} />
          {p.population === "cup" && (
            <span className="font-mono text-[11px] tracking-wider text-faint">JALUR PIALA (OFFSET)</span>
          )}
        </div>
        {result?.finished && (
          <div className="mt-5 panel-flat px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="flex items-baseline gap-3">
              <MicroLabel>Skor akhir</MicroLabel>
              <span className="tabular-nums text-3xl font-bold text-ink">
                {result.home_goals}–{result.away_goals}
              </span>
            </span>
            <span className="font-mono text-xs text-mid-gray tabular-nums">
              Pilihan paket ini: <span className="text-sage font-bold">{hits} kena</span> ·{" "}
              <span className="text-brick font-bold">{resolved.length - hits} meleset</span> · dari{" "}
              {resolved.length} ter-resolve ({picks.length} tercatat)
            </span>
          </div>
        )}
      </header>

      {/* ------------------------------------------- probabilitas 3 sumber */}
      <section className="space-y-3">
        <SectionHead
          label="Probabilitas — 3 Sumber"
          right={<MicroLabel>selisih &gt; 10 poin disorot amber</MicroLabel>}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-t border-hairline">
            <thead>
              <tr className="border-b border-hairline">
                <th className="text-left py-2 pr-3 micro-label font-normal">Pilihan</th>
                <th className="text-right py-2 px-3 micro-label font-normal">Model</th>
                <th className="text-right py-2 px-3 micro-label font-normal">Pasar</th>
                <th className="text-right py-2 pl-3 micro-label font-normal">Sportmonks</th>
              </tr>
            </thead>
            <tbody>
              {PROB_ROWS.map(({ market, selection }) => {
                const key = `${market}:${selection}`;
                const mv = p.probabilities[key] ?? null;
                const kv = p.market?.probs[key] ?? null;
                const sv = p.sm_panel?.probs[key] ?? null;
                const present = [mv, kv, sv].filter((v): v is number => v !== null);
                const spread =
                  present.length >= 2 ? Math.max(...present) - Math.min(...present) : 0;
                const hot = spread > 0.1;
                const hi = hot ? Math.max(...present) : null;
                const lo = hot ? Math.min(...present) : null;
                const cls = (v: number | null) =>
                  hot && v !== null && (v === hi || v === lo)
                    ? "text-accent font-semibold"
                    : "";
                return (
                  <tr key={key} className="border-b border-hairline/60">
                    <td className="py-1.5 pr-3 text-ink-soft">
                      {labelPilihan(market, selection, home, away)}
                    </td>
                    <td className={`py-1.5 px-3 text-right ${cls(mv)}`}>
                      <Prob value={mv} />
                    </td>
                    <td className={`py-1.5 px-3 text-right ${cls(kv)}`}>
                      <Prob value={kv} />
                    </td>
                    <td className={`py-1.5 pl-3 text-right ${cls(sv)}`}>
                      <Prob value={sv} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="space-y-1 font-mono text-[11px] leading-relaxed text-faint">
          {p.market ? (
            <p>
              Pasar: odds ditangkap {tanggalJamWib(p.market.captured_utc)}
              {p.market.bookmakers.length > 0 && <> · bandar: {p.market.bookmakers.join(", ")}</>}
              {" "}— sudah dibersihkan dari margin bandar.
            </p>
          ) : (
            <p>Pasar: belum ada tangkapan odds untuk laga ini — kolom pasar kosong.</p>
          )}
          {p.sm_panel ? (
            <p>Sportmonks: panel prediksi batch {tanggalJamWib(p.sm_panel.batch_utc)} (arsip trial).</p>
          ) : (
            <p>Sportmonks: panel tidak tersedia untuk laga ini — kolom Sportmonks kosong.</p>
          )}
        </div>
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* ------------------------------------------------ matriks skor */}
        <section className="space-y-3">
          <SectionHead
            label="Matriks Skor"
            right={<MicroLabel>gol kandang ↓ · gol tamu →</MicroLabel>}
          />
          {cut.length === 0 ? (
            <p className="font-mono text-xs text-faint">Matriks skor tidak tersimpan pada paket ini.</p>
          ) : (
            <>
              <table className="border-collapse">
                <thead>
                  <tr>
                    <th className="w-9 h-9" />
                    {cut[0].map((_, j) => (
                      <th key={j} className="w-14 h-9 font-mono text-xs text-mid-gray font-normal">
                        {j}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cut.map((row, i) => (
                    <tr key={i}>
                      <th className="w-9 h-11 font-mono text-xs text-mid-gray font-normal">{i}</th>
                      {row.map((v, j) => (
                        <td
                          key={j}
                          style={heatStyle(v, maxCell)}
                          className="w-14 h-11 text-center font-mono text-[11px] tabular-nums border border-canvas"
                        >
                          {pct(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(p.top_scores ?? []).slice(0, 5).map((s, i) => (
                  <span
                    key={i}
                    className="border border-hairline rounded-md px-2 py-1 font-mono text-[11px] text-ink-soft tabular-nums"
                  >
                    {s.home_goals}–{s.away_goals} · {pct(s.prob)}
                  </span>
                ))}
              </div>
              <p className="font-mono text-[11px] text-faint">
                Ditampilkan 0–5 gol per sisi dari matriks 11×11 penuh.
              </p>
            </>
          )}
        </section>

        {/* -------------------------------------------------- asal angka */}
        <section className="space-y-3">
          <SectionHead label="Asal Angka" />
          <dl className="space-y-2 text-sm">
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-faint">Kekuatan gol</dt>
              <dd className="tabular-nums text-ink-soft">
                λ {num(p.lambda)} · μ {num(p.mu)} · ρ {num(p.rho)}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-faint">Sumber fit</dt>
              <dd className="text-ink-soft font-mono text-[13px]">{pkg.fit_source}</dd>
            </div>
            {pkg.cup_delta !== null && (
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-faint">Offset piala</dt>
                <dd className="tabular-nums text-ink-soft">δ {signed(pkg.cup_delta, 3)}</dd>
              </div>
            )}
            <div className="flex gap-3">
              <dt className="w-32 shrink-0 text-faint">Dihitung</dt>
              <dd className="text-ink-soft">{tanggalJamWib(pkg.computed_utc)}</dd>
            </div>
            {pkg.odds_captured_utc && (
              <div className="flex gap-3">
                <dt className="w-32 shrink-0 text-faint">Odds ditangkap</dt>
                <dd className="text-ink-soft">{tanggalJamWib(pkg.odds_captured_utc)}</dd>
              </div>
            )}
          </dl>
          {p.shrunk_metadata?.calibrationGate && (
            <p className="border-t border-hairline pt-3 text-[13px] leading-relaxed text-mid-gray">
              {p.shrunk_metadata.calibrationGate}
            </p>
          )}
          {p.shrunk_metadata?.leagueResolution?.note && (
            <p className="text-[13px] leading-relaxed text-faint">
              {p.shrunk_metadata.leagueResolution.note}
            </p>
          )}
        </section>
      </div>

      {/* ---------------------------------------------------------- form */}
      <section className="space-y-3">
        <SectionHead label="Form 6 Laga Terakhir" />
        <div className="grid gap-6 md:grid-cols-2">
          {[
            { name: home, form: formHome },
            { name: away, form: formAway },
          ].map(({ name, form }) => (
            <div key={name} className="panel-flat px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-lg font-semibold tracking-wide text-ink">{name}</span>
                <FormChips form={form} />
              </div>
              {form.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3 text-[13px]">
                  {form.map((e: FormEntry, i: number) => (
                    <li key={i} className="flex items-center gap-2 text-ink-soft">
                      <span className="font-mono text-[11px] text-faint w-20 shrink-0">
                        {tanggalWib(e.date)}
                      </span>
                      <span className="flex-1 min-w-0 truncate">
                        {e.venue === "home" ? "vs" : "@"} {e.opponent}
                      </span>
                      <span className="tabular-nums">
                        {e.goals_for}–{e.goals_against}
                      </span>
                      {e.xg_for !== null && e.xg_against !== null && (
                        <span className="tabular-nums text-faint text-[11px]">
                          xG {num(e.xg_for)}–{num(e.xg_against)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------- keberuntungan */}
      {luck && (
        <section className="space-y-3">
          <SectionHead
            label="Keberuntungan vs xG"
            right={
              <MicroLabel>
                selisih kandang–tamu {signed(luck.luck_disparity)} per laga
              </MicroLabel>
            }
          />
          <div className="grid gap-6 md:grid-cols-2">
            {[
              { name: home, side: luck.home },
              { name: away, side: luck.away },
            ].map(({ name, side }) => (
              <div key={name} className="panel-flat px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-lg font-semibold tracking-wide text-ink">{name}</span>
                  <span className="font-mono text-[11px] tracking-wider text-mid-gray">{side.status}</span>
                </div>
                <dl className="mt-3 space-y-1.5 border-t border-hairline pt-3 text-[13px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Keberuntungan bersih</dt>
                    <dd className="tabular-nums text-ink-soft">
                      {signed(side.net_luck_rating)} gol per laga
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Gol vs xG (serang)</dt>
                    <dd className="tabular-nums text-ink-soft">
                      {side.total_goals_for} vs {num(side.total_xg_for)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Kebobolan vs xGA</dt>
                    <dd className="tabular-nums text-ink-soft">
                      {side.total_goals_against} vs {num(side.total_xg_against)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-faint">Sampel</dt>
                    <dd className="tabular-nums text-ink-soft">{side.sample_size} laga</dd>
                  </div>
                </dl>
                {side.status === "INSUFFICIENT_DATA" && side.description && (
                  <p className="mt-2 text-[13px] leading-relaxed text-faint">{side.description}</p>
                )}
              </div>
            ))}
          </div>
          {luck.market_bias_warning && (
            <div className="border border-accent/40 bg-accent/10 rounded-md px-4 py-3 text-sm leading-relaxed text-ink-soft">
              {luck.market_bias_warning}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------- pilihan */}
      <section className="space-y-3">
        <SectionHead
          label="Pilihan dari Laga Ini"
          right={<MicroLabel>{picks.length} tercatat di ledger</MicroLabel>}
        />
        {picks.length === 0 ? (
          <EmptyState
            title="Belum ada pilihan tercatat"
            note="Paket ini dihitung sebelum mesin pilihan menulis ke ledger, atau tidak ada pilihan yang lolos ambang grade."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-t border-hairline">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left py-2 pr-3 micro-label font-normal">Grade</th>
                  <th className="text-left py-2 px-3 micro-label font-normal">Pilihan</th>
                  <th className="text-right py-2 px-3 micro-label font-normal">Model</th>
                  <th className="text-right py-2 px-3 micro-label font-normal">Pasar</th>
                  <th className="text-right py-2 px-3 micro-label font-normal">SM</th>
                  <th className="text-right py-2 pl-3 micro-label font-normal">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {picks.map((pk: PickRow) => (
                  <tr key={pk.id} className="border-b border-hairline/60">
                    <td className="py-2 pr-3">
                      <GradeMark grade={pk.grade} />
                    </td>
                    <td className="py-2 px-3 text-ink-soft">
                      {labelPilihan(pk.market, pk.selection, home, away)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Prob value={pk.model_prob} strong={pk.grade === "A"} />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Prob value={pk.market_prob} />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Prob value={pk.sm_prob} />
                    </td>
                    <td className="py-2 pl-3 text-right">
                      {pk.hit === 1 ? (
                        <span className="font-mono text-[11px] font-bold tracking-wider text-sage">KENA</span>
                      ) : pk.hit === 0 ? (
                        <span className="font-mono text-[11px] font-bold tracking-wider text-brick">
                          MELESET
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-faint">
                          {result?.finished ? "belum ter-resolve" : "menunggu laga"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
