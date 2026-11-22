"use client";
/**
 * PETA PELUANG SKOR (brief redesain §9) — bagian "Kemungkinan skor"
 * di detail pertandingan, di atas bidang gelap §2.
 *
 * Render awal (termasuk HTML server) adalah TABEL 2D: nama tim pada
 * kedua sumbu, persen per sel, daftar skor teratas, cakupan tampilan.
 * Mode 3D hanya lahir dari klik pengguna: import() modul Three.js
 * dipanggil dari handler itu; tabel dipertahankan selama memuat;
 * hasil impor yang kedaluwarsa (pengguna kembali ke 2D / pindah
 * laga) diabaikan. Kegagalan WebGL mengembalikan tabel 2D dengan sel
 * yang sama + pesan tertulis.
 *
 * Semua angka berasal dari lib/web/peta-skor.ts (presisi asal);
 * komponen ini hanya menyajikan dan mengelola pilihan.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { pct } from "@/lib/web/format";
import {
  BATAS_TAMPIL,
  LABEL_FILTER_PETA,
  bacaSkorAkhir,
  formatPeluangSel,
  peluangSel,
  ringkasMatriks,
  selDalamFilter,
  selFilter,
  selSesuaiFilter,
  selTetangga,
  type FilterPeta,
  type SelSkor,
} from "@/lib/web/peta-skor";
import { heatStyle, heatStyleRedup } from "@/components/ui";
import type { PropsPeta3D } from "./PetaSkor3D";

export interface PropsPetaSkor {
  home: string;
  away: string;
  /** Matriks proporsi PENUH yang sudah lolos adaptasiMatriks di server. */
  matrix: number[][];
  /** score_matrix_tail_mass paket (metadata quant) — bukan sisa peta. */
  tailMass: number | null;
  /** Skor akhir regulasi bila sudah terkonfirmasi; selain itu null. */
  skorAkhir: { h: number; a: number } | null;
}

const DAFTAR_FILTER: FilterPeta[] = ["semua", "kandang", "seri", "tamu"];

export default function PetaSkor({ home, away, matrix, tailMass, skorAkhir }: PropsPetaSkor) {
  const ringkasan = useMemo(() => ringkasMatriks(matrix), [matrix]);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [filter, setFilter] = useState<FilterPeta>("semua");
  const [terpilih, setTerpilih] = useState<SelSkor | null>(() => {
    if (
      skorAkhir &&
      skorAkhir.h <= BATAS_TAMPIL &&
      skorAkhir.a <= BATAS_TAMPIL &&
      peluangSel(matrix, skorAkhir.h, skorAkhir.a) !== null
    ) {
      return {
        h: skorAkhir.h,
        a: skorAkhir.a,
        p: peluangSel(matrix, skorAkhir.h, skorAkhir.a)!,
      };
    }
    return ringkasan.top[0] ?? null;
  });
  const [fokusAkhir, setFokusAkhir] = useState(false);
  const [glGagal, setGlGagal] = useState(false);
  const [memuat3d, setMemuat3d] = useState(false);
  const [Modul3D, setModul3D] = useState<ComponentType<PropsPeta3D> | null>(null);
  const [kurangiToggle, setKurangiToggle] = useState(false);
  /* prefers-reduced-motion: hormati sejak render pertama dan bila
     pengaturan berubah saat halaman terbuka (brief §9.3). */
  const kurangiMedia = useSyncExternalStore(
    (beritahu) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", beritahu);
      return () => mq.removeEventListener("change", beritahu);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const kurangiGerak = kurangiToggle || kurangiMedia;

  const akarRef = useRef<HTMLDivElement>(null);
  const bacaanRef = useRef<HTMLParagraphElement>(null);
  const tokenImpor = useRef(0);
  const renderPertama = useRef(true);

  /* Gerak papan bacaan (§9): angka+label berubah dulu, lalu satu
     gerakan vertikal 6 px / 180 ms. Gerak minimum → seketika. */
  useEffect(() => {
    if (renderPertama.current) {
      renderPertama.current = false;
      return;
    }
    const el = bacaanRef.current;
    if (!el || kurangiGerak || typeof el.animate !== "function") return;
    const anim = el.animate(
      [{ transform: "translateY(6px)", opacity: 0.4 }, { transform: "translateY(0)", opacity: 1 }],
      { duration: 180, easing: "cubic-bezier(.22,.72,.2,1)" },
    );
    return () => anim.cancel();
  }, [terpilih?.h, terpilih?.a, fokusAkhir, kurangiGerak]);

  /* Batalkan impor yang kedaluwarsa saat komponen dilepas. */
  useEffect(
    () => () => {
      tokenImpor.current++;
    },
    [],
  );

  const pilihSel = (h: number, a: number) => {
    const p = peluangSel(matrix, h, a);
    if (p === null) return;
    setFokusAkhir(false);
    setTerpilih({ h, a, p });
  };

  const gantiFilter = (f: FilterPeta) => {
    setFilter(f);
    setFokusAkhir(false);
    setTerpilih((kini) => selSesuaiFilter(matrix, f, kini));
  };

  const aktifkan3d = async () => {
    setGlGagal(false);
    if (Modul3D) {
      setMode("3d");
      return;
    }
    const token = ++tokenImpor.current;
    setMemuat3d(true);
    try {
      const mod = await import("./PetaSkor3D");
      if (tokenImpor.current !== token) return; // pengguna sudah berpindah
      setModul3D(() => mod.default);
      setMode("3d");
    } catch {
      if (tokenImpor.current === token) setGlGagal(true);
    } finally {
      if (tokenImpor.current === token) setMemuat3d(false);
    }
  };

  const kembali2d = () => {
    tokenImpor.current++;
    setMemuat3d(false);
    setMode("2d");
  };

  const onGlGagal = () => {
    setGlGagal(true);
    setMode("2d");
  };

  const onKetikSel = (e: KeyboardEvent, h: number, a: number) => {
    const arah =
      e.key === "ArrowLeft"
        ? "kiri"
        : e.key === "ArrowRight"
          ? "kanan"
          : e.key === "ArrowUp"
            ? "atas"
            : e.key === "ArrowDown"
              ? "bawah"
              : null;
    if (!arah) return;
    e.preventDefault();
    const tujuan = selTetangga(matrix, { h, a }, arah, filter);
    pilihSel(tujuan.h, tujuan.a);
    requestAnimationFrame(() => {
      akarRef.current
        ?.querySelector<HTMLElement>(`[data-sel="${tujuan.h}-${tujuan.a}"]`)
        ?.focus();
    });
  };

  const akhir = skorAkhir ? bacaSkorAkhir(matrix, skorAkhir.h, skorAkhir.a) : null;
  const bacaan =
    fokusAkhir && akhir
      ? `Skor akhir ${akhir.teks}`
      : terpilih
        ? `${home} ${terpilih.h}–${terpilih.a} ${away} · ${formatPeluangSel(terpilih.p)}`
        : "Belum ada skor yang bisa dipilih pada filter ini.";

  const selHimpunan = selFilter(matrix, filter);
  const hMax = Math.min(BATAS_TAMPIL, matrix.length - 1);
  const aMax = Math.min(BATAS_TAMPIL, (matrix[0]?.length ?? 1) - 1);

  return (
    <div ref={akarRef} className="panel-gelap rounded-md bg-gelap p-4 text-tinta sm:p-5">
      {/* ------------------------------------------- kepala grafik */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-gelap-sekunder">Peluang dari model</p>
          <p ref={bacaanRef} className="mt-1 text-lg font-semibold tabular-nums" aria-live="polite">
            {bacaan}
          </p>
          <p className="mt-1 text-[13px] text-gelap-sekunder tabular-nums">
            {home} menang {pct(ringkasan.pKandang)} · Seri {pct(ringkasan.pSeri)} · {away} menang{" "}
            {pct(ringkasan.pTamu)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={kembali2d}
            aria-pressed={mode === "2d"}
            aria-label="Tampilan tabel dua dimensi"
            className={`min-h-11 rounded-md px-4 text-sm font-semibold ${
              mode === "2d" ? "bg-jingga text-accent-ink" : "border border-gelap-sekunder/50 text-tinta"
            }`}
          >
            2D
          </button>
          <button
            type="button"
            onClick={aktifkan3d}
            aria-pressed={mode === "3d"}
            aria-label="Tampilan tiga dimensi"
            className={`min-h-11 rounded-md px-4 text-sm font-semibold ${
              mode === "3d" ? "bg-jingga text-accent-ink" : "border border-gelap-sekunder/50 text-tinta"
            }`}
          >
            3D
          </button>
          <button
            type="button"
            onClick={() => setKurangiToggle((v) => !v)}
            aria-pressed={kurangiGerak}
            className={`min-h-11 rounded-md px-4 text-sm font-medium ${
              kurangiGerak
                ? "bg-tinta text-accent-ink"
                : "border border-gelap-sekunder/50 text-tinta"
            }`}
          >
            Kurangi gerak
          </button>
        </div>
      </div>

      {skorAkhir && akhir && (
        <p className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gelap-sekunder">
            Skor akhir: <span className="font-semibold text-tinta tabular-nums">{akhir.teks}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              if (akhir.dalamPeta) pilihSel(skorAkhir.h, skorAkhir.a);
              else setFokusAkhir(true);
            }}
            className="font-medium text-jingga underline underline-offset-4"
          >
            Lihat skor akhir
          </button>
        </p>
      )}

      {/* ------------------------------------------------------ filter */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Kelompok skor">
        {DAFTAR_FILTER.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => gantiFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-11 rounded-md px-4 text-sm font-medium ${
              filter === f
                ? "bg-tinta font-semibold text-accent-ink"
                : "border border-gelap-sekunder/50 text-tinta"
            }`}
          >
            {LABEL_FILTER_PETA[f]}
          </button>
        ))}
      </div>

      {memuat3d && (
        <p role="status" className="mt-3 text-sm text-gelap-sekunder">
          Menyiapkan tampilan 3D…
        </p>
      )}
      {glGagal && (
        <p role="status" className="mt-3 text-sm text-gelap-sekunder">
          Tampilan 3D belum tersedia di sini. Semua peluang bisa dibaca di tabel 2D.
        </p>
      )}

      {/* -------------------------------------------------- isi grafik */}
      {mode === "3d" && Modul3D ? (
        <>
          <div className="mt-4">
            <Modul3D
              home={home}
              away={away}
              matrix={matrix}
              maksBidang={ringkasan.maksBidang}
              filter={filter}
              terpilih={terpilih}
              kurangiGerak={kurangiGerak}
              onPilih={pilihSel}
              onGagal={onGlGagal}
            />
          </div>
          <label className="mt-3 block text-sm text-gelap-sekunder">
            Pilih skor
            <select
              value={terpilih ? `${terpilih.h}-${terpilih.a}` : ""}
              onChange={(e) => {
                const [h, a] = e.target.value.split("-").map(Number);
                if (Number.isFinite(h) && Number.isFinite(a)) pilihSel(h, a);
              }}
              className="mt-1.5 block min-h-11 w-full rounded-md border border-gelap-sekunder/50 bg-gelap px-3 text-[15px] text-tinta"
            >
              {selHimpunan.map((s) => (
                <option key={`${s.h}-${s.a}`} value={`${s.h}-${s.a}`}>
                  {home} {s.h}–{s.a} {away} · {formatPeluangSel(s.p)}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="border-collapse" aria-label={`Peta peluang skor ${home} melawan ${away}`}>
            <caption className="pb-2 text-left text-[13px] text-gelap-sekunder">
              Baris: gol {home} (kandang). Kolom: gol {away} (tamu). Nilai dalam persen.
            </caption>
            <thead>
              <tr>
                <th className="h-9 w-9" aria-hidden="true" />
                {Array.from({ length: aMax + 1 }, (_, a) => (
                  <th key={a} className="h-9 w-[44px] text-center text-sm font-normal text-gelap-sekunder tabular-nums">
                    {a}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: hMax + 1 }, (_, h) => (
                <tr key={h}>
                  <th className="h-11 w-9 text-center text-sm font-normal text-gelap-sekunder tabular-nums">
                    {h}
                  </th>
                  {Array.from({ length: aMax + 1 }, (_, a) => {
                    const p = matrix[h][a];
                    const dipilih = terpilih?.h === h && terpilih?.a === a;
                    const dalam = selDalamFilter(h, a, filter);
                    /* Sel tersaring memakai heatStyleRedup (alfa
                       diskala ×0,38 + teks tinta lunak), BUKAN opacity
                       elemen: opacity-40 menurunkan kontras efektif
                       teks sel ke 2,06–3,58:1 — di bawah kontrak
                       4,5:1 (audit P2). Sel terpilih tak diredupkan. */
                    const gaya =
                      !dalam && !dipilih
                        ? heatStyleRedup(p, ringkasan.maksBidang)
                        : heatStyle(p, ringkasan.maksBidang);
                    return (
                      <td key={a} className="p-0.5">
                        <button
                          type="button"
                          data-sel={`${h}-${a}`}
                          tabIndex={dipilih ? 0 : -1}
                          onClick={() => pilihSel(h, a)}
                          onKeyDown={(e) => onKetikSel(e, h, a)}
                          aria-label={`${home} ${h} gol, ${away} ${a} gol, peluang ${formatPeluangSel(p)}`}
                          aria-pressed={dipilih}
                          /* Sel eksplisit 44×44 (target sentuh proyek):
                             kelas w-12 TIDAK dipakai — terpetakan ke
                             --spacing-12:12px di theme.css, itulah akar
                             sel 12×44 px pada audit. Cincin sel terpilih
                             memakai warna teks sel dari heatStyle
                             (kontras sama dengan teksnya, ≥4,5:1). */
                          style={
                            dipilih
                              ? { ...gaya, boxShadow: `inset 0 0 0 2px ${gaya.color}` }
                              : gaya
                          }
                          className={`h-[44px] w-[44px] rounded-[4px] text-center text-[12px] tabular-nums ${
                            dipilih ? "font-bold" : ""
                          }`}
                        >
                          {formatPeluangSel(p)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------- cakupan + teratas */}
      <div className="mt-4 space-y-2 text-[13px] leading-relaxed text-gelap-sekunder">
        <p>
          Peta menampilkan skor 0–{BATAS_TAMPIL} gol per tim: {pct(ringkasan.cakupan)} dari seluruh
          kemungkinan. Di luar peta: {pct(ringkasan.sisa)}.
        </p>
        {filter === "seri" && (
          <p>
            Seri di dalam peta {pct(ringkasan.seriDalamPeta)} · di luar peta{" "}
            {formatPeluangSel(ringkasan.seriLuarPeta)}.
          </p>
        )}
        {tailMass !== null && (
          <p>
            Massa di luar grid model sebelum normalisasi: {pct(tailMass)} — metadata paket,
            terpisah dari sisa peta di atas.
          </p>
        )}
      </div>
      <ol className="mt-4 space-y-1.5">
        {ringkasan.top.map((s, i) => (
          <li key={`${s.h}-${s.a}`} className="flex items-baseline gap-3 text-sm">
            {/* w-[16px] eksplisit: w-4 terpetakan ke --spacing-4:4px
                pada peta warisan — glif "1." selebar 11 px meluap dari
                kotak 4 px (terukur scrollWidth 11 > clientWidth 4,
                audit P2). */}
            <span className="w-[16px] text-gelap-sekunder">{i + 1}.</span>
            <span className="font-medium text-tinta tabular-nums">
              {s.h}–{s.a}
            </span>
            <span className="tabular-nums text-gelap-sekunder">{formatPeluangSel(s.p)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
