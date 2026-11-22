"use client";
/**
 * KONTROL JADWAL (brief redesain §3B.1 + §2 komponen) — pencarian,
 * pintasan waktu, dan panel Filter halaman jadwal.
 *
 * Semua keadaan hidup di URL: formulir GET biasa menavigasi ke query
 * kanonik (lib/web/jadwal.queryJadwal), jadi Kembali memulihkan
 * pilihan dan server tetap satu-satunya sumber daftar. Panel Filter
 * adalah satu-satunya pulau interaktif: fokus masuk saat dibuka,
 * Escape/Tutup mengembalikan fokus ke pemicu (brief §2).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DAFTAR_ZONA, labelZona } from "@/lib/web/format";
import { queryJadwal, type FilterJadwal, type ModeJadwal } from "@/lib/web/jadwal";

const PINTASAN: { mode: Exclude<ModeJadwal, "tanggal">; label: string }[] = [
  { mode: "sekarang", label: "Sekarang" },
  { mode: "malam-ini", label: "Malam ini" },
  { mode: "besok", label: "Besok" },
];

const kelasKontrol =
  "min-h-11 rounded-md border border-hairline-strong bg-paper px-3 py-2 text-[15px] text-ink";
const kelasLabel = "flex flex-col gap-1.5 text-[13px] text-mid-gray";

function RingkasanFilter({ filter, tanggalHariIni }: { filter: FilterJadwal; tanggalHariIni: string }) {
  const aktif: string[] = [];
  if (filter.q) aktif.push(`Pencarian “${filter.q}”`);
  if (filter.mode === "sekarang") aktif.push("Pintasan: Sekarang");
  if (filter.mode === "malam-ini") aktif.push("Pintasan: Malam ini");
  if (filter.mode === "besok") aktif.push("Pintasan: Besok");
  if (filter.mode === "tanggal" && filter.tanggal !== tanggalHariIni) {
    aktif.push(`Tanggal ${filter.tanggal}`);
  }
  if (filter.status === "akan-datang") aktif.push("Status: Belum mulai");
  if (filter.status === "selesai") aktif.push("Status: Selesai");
  if (filter.liga) aktif.push(`Liga: ${filter.liga}`);
  if (filter.negara) aktif.push(`Negara: ${filter.negara}`);
  if (filter.tz !== "Asia/Jakarta") aktif.push(`Zona: ${labelZona(filter.tz)}`);
  if (aktif.length === 0) return null;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mid-gray">
      <span>
        Filter aktif: <span className="text-ink">{aktif.join(" · ")}</span>
      </span>
      <Link href="/pertandingan" className="font-medium text-accent-deep underline underline-offset-4">
        Hapus filter
      </Link>
    </p>
  );
}

export default function KontrolJadwal({
  filter,
  ligaTersedia,
  negaraTersedia,
  tanggalHariIni,
}: {
  filter: FilterJadwal;
  ligaTersedia: string[];
  negaraTersedia: string[];
  tanggalHariIni: string;
}) {
  const [panelTerbuka, setPanelTerbuka] = useState(false);
  const tombolFilterRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tanggalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!panelTerbuka) return;
    tanggalRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanelTerbuka(false);
        tombolFilterRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panelTerbuka]);

  const tutupPanel = () => {
    setPanelTerbuka(false);
    tombolFilterRef.current?.focus();
  };

  const hrefPintasan = (mode: ModeJadwal) =>
    `/pertandingan?${queryJadwal({ ...filter, mode })}`;

  return (
    <div className="mt-8">
      {/* ------------------------------------------------ pencarian */}
      <form method="get" action="/pertandingan" role="search" className="flex gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Cari tim atau liga</span>
          <input
            type="search"
            name="q"
            defaultValue={filter.q ?? ""}
            placeholder="Cari tim atau liga"
            className="min-h-11 w-full rounded-md border border-hairline-strong bg-paper px-3 py-2 text-[15px] text-ink"
          />
        </label>
        <input type="hidden" name="tanggal" value={filter.tanggal} />
        {filter.mode !== "tanggal" && <input type="hidden" name="mode" value={filter.mode} />}
        {filter.status !== "semua" && <input type="hidden" name="status" value={filter.status} />}
        {filter.liga && <input type="hidden" name="liga" value={filter.liga} />}
        {filter.negara && <input type="hidden" name="negara" value={filter.negara} />}
        {filter.tz !== "Asia/Jakarta" && <input type="hidden" name="tz" value={filter.tz} />}
        <button
          type="submit"
          className="min-h-11 flex-none rounded-md bg-accent px-4 py-2 text-[15px] font-semibold text-accent-ink"
        >
          Cari
        </button>
      </form>

      {/* --------------------------------------- pintasan + tombol filter */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {/* flex-wrap: pintasan boleh membungkus pada lebar ekstrem
            (teks 200%) ketimbang meluap; tak berubah di ≥320 px. */}
        <div className="flex flex-wrap" role="group" aria-label="Pintasan waktu">
          {PINTASAN.map((p) => {
            const aktif = filter.mode === p.mode;
            return (
              <Link
                key={p.mode}
                href={hrefPintasan(p.mode)}
                aria-current={aktif ? "true" : undefined}
                className={`flex min-h-11 items-center border-b-[3px] px-3 text-[15px] ${
                  aktif
                    ? "border-accent font-semibold text-ink"
                    : "border-transparent text-mid-gray hover:text-ink"
                }`}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
        <button
          ref={tombolFilterRef}
          type="button"
          onClick={() => setPanelTerbuka((v) => !v)}
          aria-expanded={panelTerbuka}
          aria-controls="panel-filter-jadwal"
          className="ml-auto min-h-11 rounded-md border border-hairline-strong bg-paper px-4 py-2 text-[15px] font-medium text-ink"
        >
          Filter
        </button>
      </div>

      <RingkasanFilter filter={filter} tanggalHariIni={tanggalHariIni} />

      {/* ------------------------------------------------------ panel */}
      {panelTerbuka && (
        <div
          className="fixed inset-0 z-40 flex items-end bg-ink/40 sm:items-start sm:justify-end sm:bg-transparent sm:pt-36 sm:pr-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) tutupPanel();
          }}
        >
          <div
            ref={panelRef}
            id="panel-filter-jadwal"
            role="dialog"
            aria-modal="true"
            aria-label="Filter jadwal"
            className="w-full rounded-t-2xl bg-paper p-5 shadow-xl sm:w-[22rem] sm:rounded-md sm:border sm:border-hairline"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-semibold text-ink">Filter</h2>
              <button
                type="button"
                onClick={tutupPanel}
                className="min-h-11 rounded-md px-3 text-[15px] font-medium text-accent-deep"
              >
                Tutup
              </button>
            </div>
            <form method="get" action="/pertandingan" className="mt-4 flex flex-col gap-4">
              <label className={kelasLabel}>
                Tanggal
                <input
                  ref={tanggalRef}
                  type="date"
                  name="tanggal"
                  defaultValue={filter.tanggal}
                  className={kelasKontrol}
                />
              </label>
              <label className={kelasLabel}>
                Status
                <select name="status" defaultValue={filter.status} className={kelasKontrol}>
                  <option value="semua">Semua</option>
                  <option value="akan-datang">Belum mulai</option>
                  <option value="selesai">Selesai</option>
                </select>
              </label>
              <label className={kelasLabel}>
                Liga
                <select name="liga" defaultValue={filter.liga ?? ""} className={kelasKontrol}>
                  <option value="">Semua liga</option>
                  {ligaTersedia.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className={kelasLabel}>
                Negara
                <select name="negara" defaultValue={filter.negara ?? ""} className={kelasKontrol}>
                  <option value="">Semua negara</option>
                  {negaraTersedia.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className={kelasLabel}>
                Zona waktu
                <select name="tz" defaultValue={filter.tz} className={kelasKontrol}>
                  {DAFTAR_ZONA.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.label}
                    </option>
                  ))}
                </select>
              </label>
              {filter.mode !== "tanggal" && (
                <input type="hidden" name="mode" value={filter.mode} />
              )}
              {filter.q && <input type="hidden" name="q" value={filter.q} />}
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="submit"
                  className="min-h-11 flex-1 rounded-md bg-accent px-4 py-2 text-[15px] font-semibold text-accent-ink"
                >
                  Terapkan
                </button>
                <Link
                  href="/pertandingan"
                  className="flex min-h-11 items-center px-3 text-[15px] font-medium text-accent-deep"
                >
                  Atur ulang
                </Link>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
