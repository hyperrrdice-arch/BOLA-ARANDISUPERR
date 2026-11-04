/**
 * DAFTAR PERTANDINGAN — 72 jam ke depan dari paket analisis terbaru,
 * dikelompokkan per hari lalu kompetisi. Semua angka dari pipeline
 * tersimpan; halaman ini tidak menghitung model apa pun.
 */
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  getPackagePicks,
  listFinished,
  listUpcoming,
  type FixtureListItem,
} from "@/lib/web/data";
import { jamWibOnly, labelHari, labelPilihan } from "@/lib/web/format";
import { EmptyState, GateStatus, GradeMark, MicroLabel, PageLoading, Prob, SectionHead } from "@/components/ui";

function SourceDots({ item }: { item: FixtureListItem }) {
  const p = item.pkg.payload;
  const cell = (label: string, on: boolean) => (
    <span key={label} className={on ? "text-ink-soft" : "text-faint/50"}>
      {label}
    </span>
  );
  return (
    <span className="hidden lg:inline-flex items-center gap-2 font-mono text-[10px] tracking-wider">
      {cell("MODEL", true)}
      {cell("PASAR", !!p.market)}
      {cell("SM", !!p.sm_panel)}
    </span>
  );
}

function FixtureRow({ item }: { item: FixtureListItem }) {
  const f = item.pkg.payload.fixture;
  const leg = item.topLeg;
  const c = item.pickCounts;
  return (
    <Link
      href={`/pertandingan/${item.pkg.match_id}`}
      className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 border-b border-hairline hover:bg-surface-alt transition-colors"
    >
      <span className="tabular-nums text-sm text-mid-gray w-11 shrink-0">{jamWibOnly(item.pkg.kickoff_utc)}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate font-semibold text-ink">
          {f.home} <span className="text-faint font-normal">vs</span> {f.away}
        </span>
        <span className="mt-0.5 flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            A {c.A} · B {c.B} · C {c.C}
          </span>
          <SourceDots item={item} />
        </span>
      </span>
      {leg ? (
        <span className="flex items-center gap-2.5 shrink-0 text-right">
          <span className="hidden sm:block">
            <span className="block text-sm text-ink-soft leading-tight">
              {labelPilihan(leg.market, leg.selection, f.home, f.away)}
            </span>
            <Prob value={leg.effective_prob} strong className="text-sm" />
          </span>
          <GradeMark grade={leg.grade} />
        </span>
      ) : (
        <span className="font-mono text-[11px] text-faint shrink-0">belum ada pilihan</span>
      )}
    </Link>
  );
}

function FinishedCard({ item }: { item: FixtureListItem }) {
  const f = item.pkg.payload.fixture;
  const r = item.result;
  const picks = getPackagePicks(item.pkg.id).slice(0, 6);
  return (
    <div className="panel-flat px-4 py-3">
      <div className="flex items-center gap-4">
        <span className="tabular-nums text-2xl font-bold text-ink shrink-0">
          {r ? `${r.home_goals}–${r.away_goals}` : "—"}
        </span>
        <span className="flex-1 min-w-0">
          <Link
            href={`/pertandingan/${item.pkg.match_id}`}
            className="block truncate font-semibold text-ink hover:text-accent"
          >
            {f.home} <span className="text-faint font-normal">vs</span> {f.away}
          </Link>
          <span className="block font-mono text-[11px] text-faint">
            {f.competition_name} · {jamWibOnly(item.pkg.kickoff_utc)} WIB
          </span>
        </span>
        <GateStatus status={item.pkg.gate_status} />
      </div>
      {picks.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3">
          {picks.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5 text-sm">
              <GradeMark grade={p.grade} />
              <span className="flex-1 min-w-0 truncate text-ink-soft">
                {labelPilihan(p.market, p.selection, f.home, f.away)}
              </span>
              <Prob value={p.model_prob} className="text-xs" />
              {p.hit === 1 ? (
                <span className="font-mono text-[11px] font-bold tracking-wider text-sage">KENA</span>
              ) : p.hit === 0 ? (
                <span className="font-mono text-[11px] font-bold tracking-wider text-brick">MELESET</span>
              ) : (
                <span className="font-mono text-[11px] text-faint">belum ada hasil</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 border-t border-hairline pt-3 font-mono text-[11px] text-faint">
          Tidak ada pilihan tercatat untuk paket ini.
        </p>
      )}
    </div>
  );
}

export default function PertandinganPage() {
  return (
    <Suspense fallback={<PageLoading label="Memuat daftar pertandingan…" />}>
      <PertandinganContent />
    </Suspense>
  );
}

async function PertandinganContent() {
  await connection();
  const upcoming = listUpcoming(72);
  const finished = listFinished(72, 60);

  const totals = upcoming.reduce(
    (acc, it) => ({
      A: acc.A + it.pickCounts.A,
      B: acc.B + it.pickCounts.B,
      C: acc.C + it.pickCounts.C,
    }),
    { A: 0, B: 0, C: 0 },
  );
  const calibrated = upcoming.filter((it) => it.pkg.gate_status === "calibrated").length;

  // Kelompok: hari → kompetisi (urutan kickoff dipertahankan).
  const byDay = new Map<string, Map<string, FixtureListItem[]>>();
  for (const it of upcoming) {
    const day = labelHari(it.pkg.kickoff_utc);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const comps = byDay.get(day)!;
    const comp = it.pkg.payload.fixture.competition_name;
    if (!comps.has(comp)) comps.set(comp, []);
    comps.get(comp)!.push(it);
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-wide text-ink">
          Pertandingan — <span className="text-accent">72 Jam</span>
        </h1>
        <p className="mt-3 font-mono text-xs sm:text-sm text-mid-gray tabular-nums">
          {upcoming.length} laga · {calibrated} liga terkalibrasi penuh · pilihan A {totals.A} · B {totals.B} · C{" "}
          {totals.C}
        </p>
        <p className="mt-1 text-sm text-faint">
          Diurutkan dari pilihan paling aman per laga. Klik laga untuk analisis lengkapnya.
        </p>
      </header>

      {upcoming.length === 0 ? (
        <EmptyState
          title="Belum ada pertandingan pada jendela 72 jam"
          note="Slate berikutnya ditulis ritme data tiap 12 jam. Cek lagi setelah refresh berikutnya."
        />
      ) : (
        [...byDay.entries()].map(([day, comps]) => (
          <section key={day} className="space-y-5">
            <SectionHead label={day} />
            {[...comps.entries()].map(([comp, items]) => (
              <div key={comp}>
                <div className="flex items-center justify-between gap-4 px-1 pb-1.5">
                  <span className="font-display text-lg font-semibold tracking-wide text-ink">{comp}</span>
                  <GateStatus status={items[0].pkg.gate_status} />
                </div>
                <div className="border-t border-hairline">
                  {items.map((it) => (
                    <FixtureRow key={it.pkg.id} item={it} />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}

      <section className="space-y-4">
        <SectionHead
          label="Baru Selesai — Paket vs Kenyataan"
          right={<MicroLabel>{finished.length} laga</MicroLabel>}
        />
        {finished.length === 0 ? (
          <p className="font-mono text-xs text-faint px-1">
            Belum ada laga selesai pada 72 jam terakhir yang paketnya tersimpan.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {finished.map((it) => (
              <FinishedCard key={it.pkg.id} item={it} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
