"use client";

/**
 * PEMBANGUN SLIP — daftar pilihan live-run + panel slip parlay.
 *
 * Data (pilihan + matriks paket) datang dari Server Component sebagai
 * props serial; komponen ini hanya memegang state pilihan pengguna.
 * Probabilitas gabungan dihitung oleh lib/web/parlay.ts (murni):
 * satu laga multi-pilihan dihitung persis dari matriks skor, antar
 * laga dikalikan dengan asumsi independen — label metodenya tampil
 * di panel, bukan disembunyikan.
 */
import { useMemo, useState } from "react";
import { GateStatus, GradeMark, MicroLabel, Prob, SectionHead, EmptyState } from "../ui";
import { MARKET_LABEL, jamWibOnly, labelPilihan, pct, tanggalWib } from "../../lib/web/format";
import { combineSlip, type SlipPick } from "../../lib/web/parlay";

export interface BuilderPick {
  key: string;
  matchId: string;
  kickoffUtc: string;
  home: string;
  away: string;
  competitionName: string;
  gateStatus: string;
  grade: string;
  market: string;
  selection: string;
  /** Probabilitas efektif (sudah dikoreksi band lab). */
  prob: number;
  sourcesAgree: number;
  packageId: number | null;
}

const MAKS_PILIHAN = 12;
type GradeFilter = "AB" | "A" | "ALL";
const FILTERS: { id: GradeFilter; label: string }[] = [
  { id: "AB", label: "A + B" },
  { id: "A", label: "A saja" },
  { id: "ALL", label: "Semua" },
];

export default function ParlayBuilder({
  picks,
  matrices,
}: {
  picks: BuilderPick[];
  matrices: Record<number, number[][]>;
}) {
  const [filter, setFilter] = useState<GradeFilter>("AB");
  const [selected, setSelected] = useState<BuilderPick[]>([]);

  const selectedKeys = useMemo(() => new Set(selected.map((p) => p.key)), [selected]);

  const groups = useMemo(() => {
    const keep = (g: string) =>
      filter === "ALL" ? true : filter === "A" ? g === "A" : g === "A" || g === "B";
    const map = new Map<string, BuilderPick[]>();
    for (const p of picks) {
      if (!keep(p.grade)) continue;
      const arr = map.get(p.matchId);
      if (arr) arr.push(p);
      else map.set(p.matchId, [p]);
    }
    return [...map.values()];
  }, [picks, filter]);

  const result = useMemo(() => {
    const slip: SlipPick[] = selected.map((p) => ({
      key: p.key,
      matchId: p.matchId,
      market: p.market,
      selection: p.selection,
      prob: p.prob,
      matrix: p.packageId !== null ? matrices[p.packageId] ?? null : null,
    }));
    return combineSlip(slip);
  }, [selected, matrices]);

  const pickByMatch = useMemo(() => {
    const m = new Map<string, BuilderPick>();
    for (const p of selected) if (!m.has(p.matchId)) m.set(p.matchId, p);
    return m;
  }, [selected]);

  const penuh = selected.length >= MAKS_PILIHAN;

  function toggle(p: BuilderPick) {
    setSelected((cur) => {
      if (cur.some((s) => s.key === p.key)) return cur.filter((s) => s.key !== p.key);
      if (cur.length >= MAKS_PILIHAN) return cur;
      return [...cur, p];
    });
  }

  if (picks.length === 0) {
    return (
      <EmptyState
        title="Belum ada pilihan live-run"
        note="Slate berikutnya akan mengisi daftar ini — pilihan tercatat otomatis sebelum kickoff, bukan sesudahnya."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      {/* ------------------------------------------------ panel slip */}
      <aside className="panel order-1 p-4 lg:order-2 lg:sticky lg:top-6" aria-label="Slip parlay">
        <SectionHead
          label="Slip Parlay"
          right={
            <span className="font-mono text-[11px] text-faint">
              {selected.length}/{MAKS_PILIHAN} pilihan
            </span>
          }
        />

        {selected.length === 0 ? (
          <p className="py-6 text-sm leading-relaxed text-mid-gray">
            Slip masih kosong. Centang <span className="text-ink font-semibold">Tambah</span> pada
            pilihan di daftar — probabilitas gabungannya dihitung di sini, langsung.
          </p>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-hairline">
              {selected.map((p) => (
                <li key={p.key} className="flex items-start gap-2 py-2">
                  <GradeMark grade={p.grade} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {labelPilihan(p.market, p.selection, p.home, p.away)}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-faint">
                      {p.home} vs {p.away}
                    </span>
                  </span>
                  <Prob value={p.prob} className="text-sm" />
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-label={`Hapus ${labelPilihan(p.market, p.selection, p.home, p.away)} dari slip`}
                    className="shrink-0 rounded-md border border-hairline-strong px-1.5 py-0.5 font-mono text-[11px] text-mid-gray transition-colors hover:border-brick hover:text-brick"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-hairline pt-3">
              <MicroLabel>Probabilitas gabungan slip</MicroLabel>
              <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-accent">
                {pct(result.combined, result.combined >= 0.1 ? 1 : 2)}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-faint">
                Metode: pilihan dalam satu laga dihitung persis dari matriks skor; antar laga
                dikalikan (asumsi independen). Angka ditampilkan apa adanya.
              </p>

              {result.groups.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3">
                  {result.groups.map((g) => {
                    const head = pickByMatch.get(g.matchId);
                    return (
                      <li key={g.matchId} className="font-mono text-[11px] leading-relaxed">
                        <span className="text-mid-gray">
                          {head ? `${head.home} vs ${head.away}` : g.matchId}
                        </span>{" "}
                        <span className="tabular-nums text-ink">{pct(g.prob)}</span>{" "}
                        {g.count > 1 ? (
                          g.exact ? (
                            <span className="text-sage">
                              — {g.count} pilihan satu laga, dihitung persis dari matriks (bukan
                              dikali)
                            </span>
                          ) : (
                            <span className="text-brick">
                              — {g.count} pilihan satu laga, matriks tidak tersedia: digabung
                              dengan perkalian (perkiraan)
                            </span>
                          )
                        ) : (
                          <span className="text-faint">— 1 pilihan</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                type="button"
                onClick={() => setSelected([])}
                className="mt-4 w-full rounded-md border border-hairline-strong px-3 py-2 font-mono text-xs tracking-wider text-mid-gray transition-colors hover:border-brick hover:text-brick"
              >
                BERSIHKAN SLIP
              </button>
            </div>
          </>
        )}
        {penuh && (
          <p className="mt-3 font-mono text-[11px] text-accent">
            Batas {MAKS_PILIHAN} pilihan per slip tercapai.
          </p>
        )}
      </aside>

      {/* ------------------------------------------------ daftar pilihan */}
      <section className="order-2 min-w-0 lg:order-1" aria-label="Daftar pilihan aman">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <MicroLabel className="mr-1">Filter grade</MicroLabel>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] tracking-wider transition-colors ${
                filter === f.id
                  ? "border-accent text-accent"
                  : "border-hairline text-mid-gray hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto font-mono text-[11px] text-faint">
            {picks.length} pilihan · {new Set(picks.map((p) => p.matchId)).size} laga
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="Tidak ada pilihan pada filter ini"
            note="Ubah filter grade untuk melihat pilihan lain dari slate yang sama."
          />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => {
              const head = group[0];
              return (
                <div key={head.matchId} className="panel-flat">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline px-4 py-3">
                    <span className="font-mono text-sm font-semibold text-accent">
                      {jamWibOnly(head.kickoffUtc)}
                    </span>
                    <span className="font-mono text-[11px] text-faint">
                      {tanggalWib(head.kickoffUtc)}
                    </span>
                    <h3 className="font-display text-lg font-semibold tracking-wide text-ink">
                      {head.home} <span className="text-faint">vs</span> {head.away}
                    </h3>
                    {head.competitionName && (
                      <span className="text-xs text-faint">{head.competitionName}</span>
                    )}
                    <span className="ml-auto">
                      <GateStatus status={head.gateStatus} />
                    </span>
                  </div>
                  <ul className="divide-y divide-hairline">
                    {group.map((p) => {
                      const aktif = selectedKeys.has(p.key);
                      return (
                        <li
                          key={p.key}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 ${
                            aktif ? "bg-surface-alt/70" : ""
                          }`}
                        >
                          <GradeMark grade={p.grade} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {labelPilihan(p.market, p.selection, p.home, p.away)}
                            </span>
                            <span className="block font-mono text-[11px] text-faint">
                              {MARKET_LABEL[p.market] ?? p.market}
                            </span>
                          </span>
                          <span className="font-mono text-[11px] text-mid-gray">
                            {p.sourcesAgree}/3 sumber
                          </span>
                          <Prob value={p.prob} strong className="text-base" />
                          <button
                            type="button"
                            aria-pressed={aktif}
                            disabled={!aktif && penuh}
                            onClick={() => toggle(p)}
                            className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              aktif
                                ? "border-accent bg-accent font-bold text-accent-ink"
                                : "border-hairline-strong text-mid-gray hover:border-accent hover:text-accent"
                            }`}
                          >
                            {aktif ? "Dipakai ✓" : "Tambah"}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-5 text-[11px] leading-relaxed text-faint">
          Grade berasal dari lab historis — ratusan ribu pilihan yang teruji out-of-sample;
          probabilitas yang tampil adalah probabilitas efektif, sudah dikoreksi memakai band lab
          per pasar dan rentang probabilitas, bukan keluaran model mentah.
        </p>
      </section>
    </div>
  );
}
