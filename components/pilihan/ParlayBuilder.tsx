"use client";

/**
 * PARLAY BUILDER — daftar pilihan RESMI pra-laga + panel Pilihanmu.
 *
 * Data (pilihan resmi K2 + matriks paket) tiba dari Server Component
 * sebagai props serial; komponen ini hanya memegang pilihan pengguna
 * (draf browser — tidak pernah masuk rekam hasil resmi, D4).
 *
 * Perilaku K7 (bab UI U4 + QA U03/U04):
 * - Pilihan dikelompokkan per laga FISIK (fixture_uid kanonik K1), bukan
 *   per ID provider — alias laga yang sama tidak menggandakan grup.
 * - Angka yang dipakai adalah peluang SAAT TERBIT (beku K2) beserta
 *   basisnya; analisis yang lebih baru tidak mengubah angka builder.
 * - Gabungan dihitung lib/web/parlay.ts: satu laga persis dari matriks
 *   skor, antarlaga dikalikan dengan asumsi independensi yang DITULIS.
 * - Jam berjalan: begitu sepak mula tiba, penambahan terkunci; pilihan
 *   terpilih dari laga itu ditandai "Kedaluwarsa", dikeluarkan dari
 *   estimasi aktif, dan tetap tampil sampai pengguna menghapusnya.
 *   Hitung ulang berjalan berkala dan saat tab kembali aktif.
 * - Batas produk: maksimal 12 pilihan unik.
 */
import { useEffect, useMemo, useState } from "react";
import { GateStatus, GradeMark, Prob, EmptyState } from "../ui";
import {
  MARKET_LABEL,
  jamWibOnly,
  labelBasisPeluang,
  labelPilihan,
  pct,
  tanggalWib,
} from "../../lib/web/format";
import { combineSlip, sudahMulai, type SlipPick } from "../../lib/web/parlay";

export interface BuilderPick {
  key: string;
  /** ID provider untuk tautan detail. */
  matchId: string;
  /** UID laga fisik kanonik — kunci kelompok & hitungan laga unik. */
  fixtureUid: string;
  kickoffUtc: string;
  home: string;
  away: string;
  competitionName: string;
  gateStatus: string;
  grade: string;
  market: string;
  selection: string;
  /** Peluang saat terbit (beku K2). */
  prob: number;
  /** "lab" = basis effective (koreksi lab beku); "model" = peluang model beku. */
  probBasis: "lab" | "model";
  /** Basis peluang terbit mentah dari ledger (effective/model/…) untuk label. */
  basisTerbit: string | null;
  /** Waktu terbit pilihan (ISO UTC) — ditampilkan di samping basis. */
  publishedAtUtc: string | null;
  /** Peluang model mentah, referensi. */
  modelProb: number;
  sourcesAgree: number;
  packageId: number | null;
  /**
   * Konflik edisi resmi (brief §4): >1 edisi mengaku resmi dengan angka
   * terbit berbeda. Pilihan ditahan dari gabungan sampai konflik
   * selesai; jejak nilainya ditampilkan, tidak dipilih diam-diam.
   */
  konflik?: { nilai: { prob: number; matchId: string }[] } | null;
}

const MAX_PICKS = 12;
type GradeFilter = "AB" | "A" | "ALL";
const FILTERS: { id: GradeFilter; label: string }[] = [
  { id: "AB", label: "Kelas A + B" },
  { id: "A", label: "Kelas A saja" },
  { id: "ALL", label: "Semua kelas" },
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
  // Jam dinding klien: diperbarui berkala + saat tab kembali aktif (U04).
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const segar = () => setNowMs(Date.now());
    const t = setInterval(segar, 5_000);
    const onVis = () => {
      if (document.visibilityState === "visible") segar();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const selectedKeys = useMemo(() => new Set(selected.map((p) => p.key)), [selected]);

  const kedaluwarsa = useMemo(
    () => new Set(selected.filter((p) => sudahMulai(p.kickoffUtc, nowMs)).map((p) => p.key)),
    [selected, nowMs],
  );
  const aktif = useMemo(
    () => selected.filter((p) => !kedaluwarsa.has(p.key)),
    [selected, kedaluwarsa],
  );
  const lagaUnik = useMemo(() => new Set(aktif.map((p) => p.fixtureUid)).size, [aktif]);

  const groups = useMemo(() => {
    const keep = (g: string) =>
      filter === "ALL" ? true : filter === "A" ? g === "A" : g === "A" || g === "B";
    const map = new Map<string, BuilderPick[]>();
    for (const p of picks) {
      if (!keep(p.grade)) continue;
      const arr = map.get(p.fixtureUid);
      if (arr) arr.push(p);
      else map.set(p.fixtureUid, [p]);
    }
    return [...map.values()];
  }, [picks, filter]);

  const result = useMemo(() => {
    const slip: SlipPick[] = aktif.map((p) => ({
      key: p.key,
      matchId: p.fixtureUid,
      market: p.market,
      selection: p.selection,
      prob: p.prob,
      probBasis: p.probBasis,
      matrix: p.packageId !== null ? matrices[p.packageId] ?? null : null,
    }));
    return combineSlip(slip);
  }, [aktif, matrices]);

  const pickByMatch = useMemo(() => {
    const m = new Map<string, BuilderPick>();
    for (const p of aktif) if (!m.has(p.fixtureUid)) m.set(p.fixtureUid, p);
    return m;
  }, [aktif]);

  const full = selected.length >= MAX_PICKS;
  const multiGroups = result.groups.filter((g) => g.count > 1);

  function toggle(p: BuilderPick) {
    setSelected((cur) => {
      // Menghapus selalu boleh — yang terkunci hanya MENAMBAH (U04).
      if (cur.some((s) => s.key === p.key)) return cur.filter((s) => s.key !== p.key);
      // Pilihan berkonflik edisi tidak pernah masuk gabungan (brief §4).
      if (p.konflik) return cur;
      if (sudahMulai(p.kickoffUtc, Date.now())) return cur;
      if (cur.length >= MAX_PICKS) return cur;
      return [...cur, p];
    });
  }

  if (picks.length === 0) {
    return (
      <EmptyState
        title="Belum ada pilihan resmi"
        note="Slate berikutnya menulis pilihannya sebelum sepak mula — tidak pernah sesudahnya."
      />
    );
  }

  return (
    <div className="flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-14">
      {/* ---------------------------------------------------------- slip */}
      <aside
        className="order-1 lg:order-2 lg:sticky lg:top-10 lg:border-l lg:border-hairline/60 lg:pl-10"
        aria-label="Pilihanmu"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl font-semibold text-ink">Pilihanmu</h2>
          <span className="text-[13px] text-faint">
            {selected.length} / {MAX_PICKS} maks
          </span>
        </div>

        {/* Status untuk pembaca layar: selalu dirender supaya perubahan
            isi slip (termasuk kedaluwarsa) diumumkan dari wilayah yang
            sudah ada, bukan dari elemen yang baru muncul. */}
        <p className="sr-only" role="status">
          {aktif.length} pilihan dari {lagaUnik} laga
          {aktif.length > 0
            ? ` — perkiraan peluang semua pilihan tepat ${pct(result.combined, result.combined >= 0.1 ? 1 : 2)}`
            : ""}
        </p>

        {selected.length === 0 ? (
          <p className="py-8 text-sm leading-relaxed text-mid-gray">Belum ada pilihan.</p>
        ) : (
          <>
            <ul className="mt-4">
              {selected.map((p) => {
                const hangus = kedaluwarsa.has(p.key);
                const label = labelPilihan(p.market, p.selection, p.home, p.away);
                return (
                  <li
                    key={p.key}
                    className="flex items-start gap-2.5 border-t border-hairline/50 py-2.5 first:border-t-0"
                  >
                    <GradeMark grade={p.grade} className="pt-px" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{label}</span>
                      <span className="flex items-center gap-2 text-[12px] text-faint">
                        <span className="truncate">
                          {p.home} vs {p.away}
                        </span>
                        <GateStatus status={p.gateStatus} />
                      </span>
                      {hangus && (
                        <span className="mt-0.5 block text-[12px] font-medium text-brick">
                          Kedaluwarsa — laga sudah mulai, dikeluarkan dari perkiraan.
                        </span>
                      )}
                    </span>
                    <Prob value={p.prob} className="text-sm" />
                    <button
                      type="button"
                      onClick={() => toggle(p)}
                      aria-label={`Hapus ${label}, ${p.home} vs ${p.away}, dari Pilihanmu`}
                      className="shrink-0 px-1 text-sm text-mid-gray transition-colors hover:text-brick"
                    >
                      Hapus
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 border-t border-hairline pt-5">
              <p className="text-[13px] text-mid-gray">
                {aktif.length} pilihan dari {lagaUnik} laga
              </p>
              <p className="mt-3 text-[13px] text-mid-gray">Perkiraan peluang semua pilihan tepat</p>
              <p className="tabular-nums mt-1.5 text-[40px] leading-none font-semibold text-accent">
                {aktif.length === 0 ? "—" : pct(result.combined, result.combined >= 0.1 ? 1 : 2)}
              </p>

              {multiGroups.length > 0 && (
                <ul className="mt-5 space-y-3">
                  {multiGroups.map((g) => {
                    const head = pickByMatch.get(g.matchId);
                    return (
                      <li key={g.matchId} className="text-[13px] leading-relaxed">
                        <span className="text-mid-gray">
                          {head ? `${head.home} vs ${head.away}` : g.matchId}
                        </span>{" "}
                        <span className="tabular-nums text-ink">{pct(g.prob)}</span>
                        <span className="block text-faint">
                          {g.count} pilihan di laga ini —{" "}
                          {g.exact
                            ? "digabung persis dari matriks skor."
                            : "tanpa matriks, dikalikan (perkiraan)."}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="mt-5 text-[12px] leading-relaxed text-faint">
                {result.basis === "lab" &&
                  "Semua angka di Pilihanmu adalah peluang saat terbit berbasis efektif (koreksi lab yang dibekukan saat terbit). Pilihan satu laga digabung persis dari matriks skor; antarlaga dikalikan dengan asumsi independensi."}
                {result.basis === "model" &&
                  "Angka di Pilihanmu adalah peluang model saat terbit. Pilihan satu laga digabung persis dari matriks skor model; antarlaga dikalikan dengan asumsi independensi."}
                {result.basis === "mixed" &&
                  "Basis campuran: tiap pilihan memakai peluang saat terbit sesuai basisnya; gabungan satu laga dihitung persis dari matriks skor model, bukan koreksi lab."}
              </p>

              <button
                type="button"
                onClick={() => setSelected([])}
                className="mt-4 text-sm text-mid-gray transition-colors hover:text-brick"
              >
                Kosongkan
              </button>
            </div>
          </>
        )}
        {full && (
          <p className="mt-3 text-[13px] text-accent">
            Maksimal {MAX_PICKS} pilihan. Hapus satu untuk menambah pilihan lain.
          </p>
        )}
      </aside>

      {/* ------------------------------------------------------ pick list */}
      <section className="order-2 min-w-0 lg:order-1" aria-label="Pilihan sebelum laga">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`text-[15px] transition-colors ${
                filter === f.id
                  ? "font-medium text-ink underline decoration-accent decoration-2 underline-offset-8"
                  : "text-mid-gray hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-[13px] text-faint">
            {picks.length} pilihan · {new Set(picks.map((p) => p.fixtureUid)).size} laga
          </span>
        </div>

        {groups.length === 0 ? (
          <EmptyState
            title="Tidak ada pilihan pada filter ini"
            note="Ubah filter kelas untuk melihat sisa slate ini."
          />
        ) : (
          <div>
            {groups.map((group) => {
              const head = group[0];
              const mulai = sudahMulai(head.kickoffUtc, nowMs);
              return (
                <div key={head.fixtureUid} className="mt-10 first:mt-6">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1">
                    <span className="tabular-nums text-sm text-mid-gray">
                      {jamWibOnly(head.kickoffUtc)}
                    </span>
                    <span className="text-[13px] text-faint">{tanggalWib(head.kickoffUtc)}</span>
                    <h3 className="font-display text-[17px] font-medium text-ink">
                      {head.home} <span className="font-normal text-faint">vs</span> {head.away}
                    </h3>
                    {head.competitionName && (
                      <span className="text-[13px] text-faint">{head.competitionName}</span>
                    )}
                    <span className="ml-auto">
                      <GateStatus status={head.gateStatus} />
                    </span>
                  </div>
                  <ul>
                    {group.map((p) => {
                      const active = selectedKeys.has(p.key);
                      const label = labelPilihan(p.market, p.selection, p.home, p.away);
                      return (
                        <li
                          key={p.key}
                          className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline/50 py-3 ${
                            active ? "bg-surface-alt/50" : ""
                          }`}
                        >
                          <GradeMark grade={p.grade} className="w-4 text-center" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] text-ink">{label}</span>
                            <span className="block text-[12px] text-faint">
                              {MARKET_LABEL[p.market] ?? p.market} ·{" "}
                              {labelBasisPeluang(p.basisTerbit)}
                              {p.publishedAtUtc
                                ? ` · terbit ${jamWibOnly(p.publishedAtUtc)}`
                                : ""}
                            </span>
                          </span>
                          <span className="hidden text-[12px] text-mid-gray sm:block">
                            {p.sourcesAgree} sumber tersedia
                          </span>
                          <Prob value={p.prob} strong className="text-base" />
                          <button
                            type="button"
                            aria-pressed={active}
                            aria-label={`Tambah ${label}, ${p.home} vs ${p.away}`}
                            disabled={mulai || !!p.konflik || (!active && full)}
                            onClick={() => toggle(p)}
                            className={`shrink-0 px-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              active ? "text-mid-gray hover:text-ink" : "text-accent hover:text-ink"
                            }`}
                          >
                            {p.konflik
                              ? "Konflik"
                              : mulai
                                ? "Sudah mulai"
                                : active
                                  ? "Terpilih"
                                  : "Tambah"}
                          </button>
                          {p.konflik && (
                            <span className="block w-full text-[12px] leading-relaxed text-faint">
                              Dua edisi resmi berbeda angka untuk kejadian ini:{" "}
                              {p.konflik.nilai
                                .map((n) => `${pct(n.prob, 1)} (${n.matchId})`)
                                .join(" vs ")}
                              . Ditahan dari gabungan sampai konfliknya selesai —
                              tidak ada angka yang dipilih diam-diam.
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-10 max-w-2xl text-[12px] leading-relaxed text-faint">
          Kelas berasal dari uji historis lab. Peluang yang ditampilkan adalah peluang saat
          pilihan diterbitkan — dibekukan dari paket penerbitnya, tidak berubah oleh analisis
          yang lebih baru.
        </p>
      </section>
    </div>
  );
}
