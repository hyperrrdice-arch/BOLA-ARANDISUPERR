"use client";

/**
 * PARLAY BUILDER — daftar pilihan RESMI pra-laga + panel Pilihanmu.
 *
 * Data (pilihan resmi K2 + matriks paket) tiba dari Server Component
 * sebagai props serial; komponen ini hanya memegang pilihan pengguna
 * (draf browser — tidak pernah masuk rekam hasil resmi, D4).
 *
 * Perilaku (K7 U03/U04 + brief redesain §3D + gerak §9):
 * - Pilihan dikelompokkan per laga FISIK (fixture_uid kanonik K1),
 *   terurut sepak mula; per laga tampil pilihan utama + "Lihat semua
 *   pilihan laga"; daftar dibuka 20 laga sekaligus ("Muat 20 laga
 *   lagi"). Pencarian menjangkau SELURUH hasil terfilter, bukan hanya
 *   halaman yang tampil.
 * - Angka yang dipakai adalah peluang SAAT TERBIT (beku K2) beserta
 *   basisnya; analisis yang lebih baru tidak mengubah angka builder.
 * - Gabungan dihitung lib/web/parlay.ts: satu laga persis dari matriks
 *   skor edisi bersama — tanpa matriks, gabungan TIDAK tersedia
 *   (§3D.4), bukan dikalikan di dalam grup; antarlaga dikalikan
 *   dengan asumsi independensi yang DITULIS.
 * - DRAF PERSISTEN (§3D.3): versi format + ID pilihan resmi + kunci
 *   semantik disimpan di perangkat (lib/web/draf.ts). Sesudah muat
 *   ulang, entri divalidasi ulang terhadap umpan terbaru (ID, alias
 *   lewat kunci semantik, status, waktu mulai) lalu snapshot ASLI
 *   umpan yang dipakai. Penyimpanan tak tersedia → draf tetap hidup
 *   selama tab terbuka + keterangan tampil.
 * - Jam berjalan: begitu sepak mula tiba, penambahan terkunci; pilihan
 *   terpilih dari laga itu ditandai "Kedaluwarsa", dikeluarkan dari
 *   estimasi aktif, dan tetap tampil sampai pengguna menghapusnya.
 * - Batas produk: maksimal 12 pilihan unik.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GateStatus, GradeMark, Prob, EmptyState } from "../ui";
import {
  MARKET_LABEL,
  int,
  jamWibOnly,
  kunciTanggal,
  labelBasisPeluang,
  labelPilihan,
  pct,
  tanggalWib,
} from "../../lib/web/format";
import { lipatTeks } from "../../lib/web/jadwal";
import { combineSlip, sudahMulai, type SlipPick } from "../../lib/web/parlay";
import {
  KUNCI_DRAF,
  kunciSemantikPilihan,
  parseDraf,
  pulihkanDraf,
  serialDraf,
} from "../../lib/web/draf";

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
  /** Garis pasar ternormalisasi — bagian kunci semantik kejadian. */
  line: string;
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
const PER_HALAMAN = 20;
type GradeFilter = "AB" | "A" | "ALL";
const FILTERS: { id: GradeFilter; label: string }[] = [
  { id: "AB", label: "Kelas A + B" },
  { id: "A", label: "Kelas A saja" },
  { id: "ALL", label: "Semua kelas" },
];

const semKey = (p: BuilderPick) =>
  kunciSemantikPilihan(p.fixtureUid, p.market, p.line, p.selection);

/** Label basis per pilihan (§5): angka terbit + kalimat rinciannya. */
function labelBasisBaris(p: BuilderPick): string {
  if (p.basisTerbit === "effective") return "Peluang saat terbit";
  if (p.basisTerbit === "model") return "Peluang model saat terbit";
  return labelBasisPeluang(p.basisTerbit);
}

/** Kalimat rincian basis (§5) untuk baris ringkasan Pilihanmu. */
function rincianBasis(p: BuilderPick): string | null {
  if (p.basisTerbit === "effective") return "Disesuaikan menggunakan hasil uji historis.";
  if (p.basisTerbit === "model") return "Dihitung dari model skor.";
  return null;
}

export default function ParlayBuilder({
  picks,
  matrices,
}: {
  picks: BuilderPick[];
  matrices: Record<number, number[][]>;
}) {
  const [filter, setFilter] = useState<GradeFilter>("AB");
  const [q, setQ] = useState("");
  const [tanggal, setTanggal] = useState("");
  const [tampak, setTampak] = useState(PER_HALAMAN);
  const [terbuka, setTerbuka] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<BuilderPick[]>([]);
  const [panelTerbuka, setPanelTerbuka] = useState(false);
  // Panel hanya tampil selama masih ada isi: pilihan terakhir terhapus
  // (dari panel atau daftar) menutupnya tanpa effect tambahan.
  const panelTampil = panelTerbuka && selected.length > 0;
  // Keadaan draf: penyimpanan perangkat bekerja (diuji sekali lewat
  // tulis-hapus pendek; di server dianggap bekerja — keadaan ini hanya
  // tampil sesudah ada pilihan, jadi tak memengaruhi hidrasi)?
  // berapa entri tersimpan yang sudah tidak tersedia?
  const [persisten, setPersisten] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const kunciUji = "__bola_draf_uji";
      window.localStorage.setItem(kunciUji, "1");
      window.localStorage.removeItem(kunciUji);
      return true;
    } catch {
      return false;
    }
  });
  const [hilang, setHilang] = useState(0);
  const tombolPanelRef = useRef<HTMLButtonElement | null>(null);
  const tombolTutupRef = useRef<HTMLButtonElement | null>(null);
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

  /* ------------------------------------------- draf persisten (§3D.3) */

  // Tulis draf di titik mutasi (write-through), bukan lewat effect:
  // kegagalan penyimpanan hanya mengubah keterangan keadaan.
  // Umpan kosong (slate belum terbit) tidak menimpa draf: entri
  // belum bisa divalidasi.
  function tulisDraf(next: BuilderPick[]) {
    if (picks.length === 0) return;
    try {
      window.localStorage.setItem(
        KUNCI_DRAF,
        serialDraf(next.map((p) => ({ pickUid: p.key, kunciSemantik: semKey(p) }))),
      );
      setPersisten(true);
    } catch {
      // Penyimpanan tak tersedia: draf tetap berfungsi selama tab
      // terbuka (state komponen), keadaannya diterangkan di ringkasan.
      setPersisten(false);
    }
  }

  // Cermin ref seleksi: dua klik dalam satu tick (klik ganda, atau
  // tambah lewat baris alias) harus membaca seleksi TERKINI, bukan
  // closure render yang basi — semantik updater fungsional, dijaga
  // manual supaya penulisan draf tetap di titik mutasi.
  const selectedRef = useRef<BuilderPick[]>([]);
  // Restore menerapkan seleksi lewat penyesuaian render (ref tak
  // boleh ditulis saat render) — cermin disamakan lagi di effect ini;
  // mutasi pemakai menulis cermin serentak lewat terapkanSeleksi.
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  function terapkanSeleksi(next: BuilderPick[]) {
    selectedRef.current = next;
    setSelected(next);
    tulisDraf(next);
  }

  // Draf tersimpan dibaca sebagai store eksternal: snapshot server
  // null (menyamakan hidrasi); sesudah hidrasi snapshot klien membaca
  // localStorage dan restore diterapkan sebagai penyesuaian saat
  // render — pola React untuk state turunan dari store eksternal.
  const drafMentah = useSyncExternalStore(
    () => () => {},
    () => window.localStorage.getItem(KUNCI_DRAF),
    () => null,
  );
  const [drafDiterapkan, setDrafDiterapkan] = useState(false);
  if (!drafDiterapkan && drafMentah !== null) {
    // Pulihkan SEKALI: validasi entri tersimpan terhadap umpan
    // terbaru (pick_uid → kunci semantik), lalu pakai baris umpan
    // itu sendiri sebagai snapshot asli; draf ditulis ulang tanpa
    // entri yang sudah hilang.
    setDrafDiterapkan(true);
    const entri = parseDraf(drafMentah);
    if (entri && entri.length > 0 && picks.length > 0) {
      const denganKunci = picks.map((p) => ({ ...p, kunciSemantik: semKey(p) }));
      const { pulih, hilang: nHilang } = pulihkanDraf(entri, denganKunci);
      if (pulih.length > 0) {
        const perKey = new Map(picks.map((p) => [p.key, p]));
        const snapshot = pulih.map((p) => perKey.get(p.key) ?? p);
        setSelected(snapshot);
        tulisDraf(snapshot);
      }
      setHilang(nHilang);
    }
  }

  // Panel ponsel: fokus masuk ke Tutup saat dibuka; Escape menutup;
  // fokus kembali ke pemicu saat ditutup (pola panel §9).
  useEffect(() => {
    if (!panelTampil) return;
    tombolTutupRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelTerbuka(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelTampil]);
  useEffect(() => {
    if (!panelTampil) tombolPanelRef.current?.focus();
  }, [panelTampil]);

  /* ------------------------------------------------------ turunan data */

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
  const lagaTerpilih = useMemo(() => new Set(selected.map((p) => p.fixtureUid)).size, [selected]);

  // Saring: kelas → tanggal → pencarian (lipat aksen, seluruh hasil).
  const tersaring = useMemo(() => {
    const keep = (g: string) =>
      filter === "ALL" ? true : filter === "A" ? g === "A" : g === "A" || g === "B";
    const kueri = lipatTeks(q).trim();
    return picks.filter((p) => {
      if (!keep(p.grade)) return false;
      if (tanggal && kunciTanggal(p.kickoffUtc) !== tanggal) return false;
      if (
        kueri &&
        ![p.home, p.away, p.competitionName].some((n) => lipatTeks(n).includes(kueri))
      )
        return false;
      return true;
    });
  }, [picks, filter, q, tanggal]);

  // Kelompok per laga fisik, urut sepak mula (umpan sudah menaik);
  // di dalam kelompok, peluang terbit tertinggi lebih dulu — dua
  // teratas adalah "pilihan utama" (§3D.1).
  const groups = useMemo(() => {
    const map = new Map<string, BuilderPick[]>();
    for (const p of tersaring) {
      const arr = map.get(p.fixtureUid);
      if (arr) arr.push(p);
      else map.set(p.fixtureUid, [p]);
    }
    return [...map.values()].map((g) => [...g].sort((a, b) => b.prob - a.prob));
  }, [tersaring]);

  // Paginasi kembali ke awal setiap filter berubah — penyesuaian
  // saat render terhadap nilai filter sebelumnya (pola React untuk
  // state yang bergantung pada state lain), bukan effect.
  const [filterTerapan, setFilterTerapan] = useState({ filter, q, tanggal });
  if (
    filterTerapan.filter !== filter ||
    filterTerapan.q !== q ||
    filterTerapan.tanggal !== tanggal
  ) {
    setFilterTerapan({ filter, q, tanggal });
    setTampak(PER_HALAMAN);
  }

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
    const cur = selectedRef.current;
    // Menghapus selalu boleh — yang terkunci hanya MENAMBAH (U04).
    if (cur.some((s) => s.key === p.key)) {
      terapkanSeleksi(cur.filter((s) => s.key !== p.key));
      return;
    }
    // Pilihan berkonflik edisi tidak pernah masuk gabungan (brief §4).
    if (p.konflik) return;
    if (sudahMulai(p.kickoffUtc, nowMs)) return;
    if (cur.length >= MAX_PICKS) return;
    // Idempoten (§3D.4): kejadian semantik yang sama — termasuk yang
    // masuk lewat alias provider lain — tidak pernah ditambah dua kali.
    if (cur.some((s) => semKey(s) === semKey(p))) return;
    terapkanSeleksi([...cur, p]);
  }

  function alihTerbuka(uid: string) {
    setTerbuka((cur) => {
      const baru = new Set(cur);
      if (baru.has(uid)) baru.delete(uid);
      else baru.add(uid);
      return baru;
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

  /* ------------------------------------------------- isi ringkasan */

  const isiRingkasan = (
    <>
      {/* Status untuk pembaca layar: selalu dirender supaya perubahan
          isi slip (termasuk kedaluwarsa) diumumkan dari wilayah yang
          sudah ada, bukan dari elemen yang baru muncul. */}
      <p className="sr-only" role="status">
        {aktif.length} pilihan dari {lagaUnik} laga
        {aktif.length > 0 && result.combined !== null
          ? ` — perkiraan peluang semua pilihan tepat ${pct(result.combined, result.combined >= 0.1 ? 1 : 2)}`
          : ""}
      </p>

      {selected.length === 0 ? (
        <p className="py-8 text-sm leading-relaxed text-mid-gray">
          Belum ada pilihan. Ketuk <strong className="font-medium text-ink">Tambah</strong>{" "}
          pada pilihan untuk menyusun drafmu di sini.
        </p>
      ) : (
        <>
          <ul className="mt-4">
            {selected.map((p) => {
              const hangus = kedaluwarsa.has(p.key);
              const label = labelPilihan(p.market, p.selection, p.home, p.away);
              const rincian = rincianBasis(p);
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
                    {rincian && (
                      <span className="mt-0.5 block text-[12px] text-faint">{rincian}</span>
                    )}
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
                    className="flex min-h-[44px] shrink-0 items-center px-1 text-sm text-mid-gray transition-colors hover:text-brick"
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
            <p className="mt-3 text-[13px] text-mid-gray">Peluang semua pilihan tepat</p>
            {result.combined === null ? (
              <p className="mt-1.5 text-[15px] leading-relaxed font-medium text-ink">
                Peluang gabungan belum tersedia
                {result.alasanGabungan ? (
                  <span className="block text-[13px] font-normal text-mid-gray">
                    {result.alasanGabungan}.
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="tabular-nums mt-1.5 text-[40px] leading-none font-semibold text-accent">
                {aktif.length === 0 ? "—" : pct(result.combined, result.combined >= 0.1 ? 1 : 2)}
              </p>
            )}
            <p className="mt-2 text-[12px] text-faint">
              Basis gabungan:{" "}
              {result.basis === "lab"
                ? "peluang saat terbit (efektif)"
                : result.basis === "model"
                  ? "peluang model saat terbit"
                  : "campuran — tiap pilihan memakai basis terbitnya"}
              .
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
                      {g.unavailable ? (
                        <span className="block text-faint">
                          {g.count} pilihan di laga ini — Peluang gabungan belum tersedia:{" "}
                          {g.alasan}.
                        </span>
                      ) : (
                        <>
                          <span className="tabular-nums text-ink">
                            {g.prob !== null ? pct(g.prob) : "—"}
                          </span>
                          <span className="block text-faint">
                            {g.count} pilihan di laga ini — digabung persis dari matriks skor.
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-5 text-[12px] leading-relaxed text-faint">
              Pilihan dalam satu laga dihitung dari kemungkinan skor. Untuk laga yang
              berbeda, perhitungan menganggap hasilnya saling independen.
            </p>

            <button
              type="button"
              onClick={() => terapkanSeleksi([])}
              className="mt-4 flex min-h-[44px] items-center text-sm text-mid-gray transition-colors hover:text-brick"
            >
              Kosongkan pilihan
            </button>
          </div>
        </>
      )}
      {full && (
        <p className="mt-3 text-[13px] font-medium text-accent-deep">
          Maksimal 12 pilihan. Hapus satu untuk menambah yang lain.
        </p>
      )}
      {!persisten && selected.length > 0 && (
        <p className="mt-3 text-[13px] text-mid-gray">
          Draf tidak tersimpan di perangkat ini — pilihan tetap ada selama tab ini terbuka.
        </p>
      )}
    </>
  );

  const kepalaRingkasan = (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-display text-xl font-semibold text-ink">Pilihanmu</h2>
      <span className="text-[13px] text-faint">
        {selected.length} dari {MAX_PICKS} pilihan
      </span>
    </div>
  );

  return (
    <div className="flex flex-col gap-12 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-14">
      {/* ------------------------------------------- ringkasan desktop */}
      <aside
        className="order-1 hidden lg:order-2 lg:block lg:sticky lg:top-10 lg:border-l lg:border-hairline/60 lg:pl-10"
        aria-label="Pilihanmu"
      >
        {kepalaRingkasan}
        {isiRingkasan}
      </aside>

      {/* ------------------------------------------------------ daftar */}
      <section className="order-2 min-w-0 lg:order-1" aria-label="Pilihan sebelum laga">
        {/* Kontrol: pencarian, tanggal, filter kelas (§3D.1). */}
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <label className="min-w-[200px] flex-1">
            <span className="mb-1 block text-[12px] text-faint">Cari tim atau liga</span>
            <span className="flex items-center gap-2">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari tim atau liga"
                className="min-h-[44px] w-full rounded-md border border-hairline bg-surface px-3 text-[15px] text-ink"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  className="flex min-h-[44px] shrink-0 items-center px-1 text-sm text-mid-gray transition-colors hover:text-ink"
                >
                  Hapus pencarian
                </button>
              )}
            </span>
          </label>
          <label>
            <span className="mb-1 block text-[12px] text-faint">Tanggal</span>
            <input
              type="date"
              value={tanggal}
              onChange={(e) => setTanggal(e.target.value)}
              className="min-h-[44px] rounded-md border border-hairline bg-surface px-2.5 text-sm text-ink"
            />
          </label>
        </div>
        <div className="mt-4 mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`flex min-h-[44px] items-center text-[15px] transition-colors ${
                filter === f.id
                  ? "font-medium text-ink underline decoration-accent decoration-2 underline-offset-8"
                  : "text-mid-gray hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-[13px] text-faint" role="status">
            {int(tersaring.length)} pilihan · {int(groups.length)} laga
          </span>
        </div>

        {hilang > 0 && (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
            {int(hilang)} pilihan dari draf tersimpan tidak lagi tersedia dan sudah
            dikeluarkan dari draf.
          </p>
        )}

        {groups.length === 0 ? (
          <EmptyState
            title="Tidak ada laga yang cocok"
            note="Ubah pencarian, tanggal, atau filter kelas untuk melihat pilihan lain pada slate ini."
          />
        ) : (
          <div>
            {groups.slice(0, tampak).map((group) => {
              const head = group[0];
              const mulai = sudahMulai(head.kickoffUtc, nowMs);
              const uid = head.fixtureUid;
              const luas = terbuka.has(uid);
              const terpilihGrup = group.filter((p) => selectedKeys.has(p.key));
              const utama = group.slice(0, 2);
              const tampil = luas
                ? group
                : [...utama, ...terpilihGrup.filter((p) => !utama.includes(p))];
              return (
                <div key={uid} className="mt-10 first:mt-6">
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
                    {tampil.map((p) => {
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
                              {MARKET_LABEL[p.market] ?? p.market} · {labelBasisBaris(p)}
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
                            className={`flex min-h-[44px] shrink-0 items-center px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              active ? "text-mid-gray hover:text-ink" : "text-accent-deep hover:text-ink"
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
                              . Ditahan dari gabungan sampai konfliknya selesai — tidak ada
                              angka yang dipilih diam-diam.
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {group.length > tampil.length || luas ? (
                    <button
                      type="button"
                      aria-expanded={luas}
                      onClick={() => alihTerbuka(uid)}
                      className="mt-1 flex min-h-[44px] items-center text-sm font-medium text-accent-deep transition-colors hover:text-ink"
                    >
                      {luas ? "Sembunyikan pilihan laga" : "Lihat semua pilihan laga"}
                    </button>
                  ) : null}
                </div>
              );
            })}
            {tampak < groups.length && (
              <button
                type="button"
                onClick={() => setTampak((t) => t + PER_HALAMAN)}
                className="mt-10 flex min-h-[44px] items-center rounded-md border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:text-accent-deep"
              >
                Muat 20 laga lagi
              </button>
            )}
          </div>
        )}

        <p className="mt-10 max-w-2xl text-[12px] leading-relaxed text-faint">
          Kelas berasal dari uji historis lab. Peluang yang ditampilkan adalah peluang saat
          pilihan diterbitkan — dibekukan dari paket penerbitnya, tidak berubah oleh analisis
          yang lebih baru.
        </p>
        {/* Ruang bawah supaya bilah ponsel tidak menutupi baris terakhir. */}
        {selected.length > 0 && <div aria-hidden="true" className="h-24 lg:hidden" />}
      </section>

      {/* --------------------------------- bilah + panel Pilihanmu (HP) */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(52px+env(safe-area-inset-bottom))] z-40 border-t border-garis bg-kertas px-4 py-2 lg:hidden">
          <div className="ringkasan-masuk flex items-center gap-3" key={selected.length}>
            <span className="min-w-0 flex-1 text-[13px] text-mid-gray">
              {aktif.length > 0 && result.combined !== null
                ? `Peluang semua tepat ${pct(result.combined, result.combined >= 0.1 ? 1 : 2)}`
                : result.combined === null
                  ? "Peluang gabungan belum tersedia"
                  : "Belum ada pilihan aktif"}
            </span>
            <button
              type="button"
              ref={tombolPanelRef}
              onClick={() => setPanelTerbuka(true)}
              aria-haspopup="dialog"
              className="flex min-h-[44px] shrink-0 items-center rounded-md bg-gelap px-4 text-sm font-medium text-kertas transition-colors"
            >
              Lihat {selected.length} pilihan
            </button>
          </div>
        </div>
      )}
      {panelTampil && (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            aria-label="Tutup panel Pilihanmu"
            onClick={() => setPanelTerbuka(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-tinta/40"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pilihanmu"
            className="panel-masuk absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-garis bg-kertas px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">Pilihanmu</h2>
                <p className="mt-0.5 text-[13px] text-faint">
                  {selected.length} pilihan dari {lagaTerpilih} laga · {selected.length} dari{" "}
                  {MAX_PICKS} pilihan
                </p>
              </div>
              <button
                type="button"
                ref={tombolTutupRef}
                onClick={() => setPanelTerbuka(false)}
                className="flex min-h-[44px] shrink-0 items-center px-2 text-sm font-medium text-accent-deep transition-colors hover:text-ink"
              >
                Tutup
              </button>
            </div>
            {isiRingkasan}
          </div>
        </div>
      )}
    </div>
  );
}
