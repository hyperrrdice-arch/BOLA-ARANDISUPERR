// ============================================================================
// GENERATOR + METRIK PEMBUKTIAN TIKET RESMI HARIAN FIX-4 (Item 23)
// ----------------------------------------------------------------------------
// Membekukan keputusan tiket resmi harian SEBELUM kickoff agar pembuktian
// target 5 Jan tercatat utuh di level tiket, bukan hanya level pilihan.
//
// Kontrak kejujuran:
//  - Snapshot tiket APPEND-ONLY: keputusan per tanggal WIB ditulis sekali;
//    menjalankan ulang generator untuk tanggal yang sama mengembalikan
//    keputusan yang sudah ada, tidak pernah menimpa.
//  - Kandidat = pick RESMI (published_prob beku terisi) yang diterbitkan
//    pada/saat cutoff (created_utc <= decision_ts), kickoff di jendela
//    (cutoff, cutoff+24j], kompetisinya "berfeed" (klasifikasi PR 2 —
//    tiket tidak pernah berisi pilihan yang tidak akan bisa dinilai),
//    published_prob >= 0,72, maks 1 pilihan per laga FISIK.
//  - Pick termarking `duplicate_of` TIDAK PERNAH layak (perbaikan pasca
//    tiket pertama 25 Nov 2026, yang memuat laga Boreham Wood–Aldershot
//    dua kali karena generator lama tidak menyaringnya): predikat yang
//    sama dengan publishSlip (tickets.ts) dan cohort.ts (A3) —
//    `duplicate_of IS NULL` ditegakkan di kueri kandidat.
//  - "Satu laga" dihitung dari identitas fixture KANONIK hasil tautan
//    (data/fixture-links.json via SlateIdentity — mekanisme yang sama
//    dengan pick-slate dan resolver), BUKAN match_id mentah: dua record
//    kembar tertaut (fd_ vs sm_) adalah satu fixture, maksimal satu
//    pick boleh masuk tiket. Fixture tanpa tautan memakai match_id-nya
//    sendiri sebagai kunci (perilaku lama persis).
//  - Ranking deterministik: published_prob desc, match_id asc, id asc.
//  - expected_hit_prob tiket = Π published_prob (produk independensi —
//    angka beku saat terbit; metrik pembuktian membandingkannya dengan
//    hit-rate aktual, tidak menyembunyikan selisihnya).
//  - Settlement tiket konsisten dengan slipRecordStats/cohort: jendela
//    jatuh tempo 6 jam sesudah kickoff (SETTLEMENT_WINDOW_MS), status
//    VOID_OR_UNRESOLVABLE dicatat terpisah dari penyebut hit-rate.
//  - PENJAGA CUTOFF (koreksi tindak lanjut 27 Nov 2026): keputusan hanya
//    boleh dibekukan pada/sesudah cutoff 14:00 WIB (now >= decision_ts).
//    Panggilan sebelum cutoff menghasilkan status WAITING_CUTOFF
//    ("Menunggu batas penilaian") TANPA menulis apa pun — himpunan calon
//    resmi adalah himpunan AS-OF cutoff, jadi calon yang terbit sampai
//    cutoff tetap terhitung. (Larian produksi 26–27 Nov 2026 sempat
//    membekukan keputusan pukul 13:25 WIB karena dispatch cron lebih
//    awal; audit read-only membuktikan tidak ada calon yang terlewat
//    pada dua hari itu — lihat Laporan-Fix4-Cutoff-Tindak-Lanjut.)
//  - KOREKSI AUDIT PRODUKSI 27 Nov 2026 §1 (tiga cacat, tes D8–D10):
//    (A) kickoff di jendela BUKAN jaminan laga belum mulai: pada dispatch
//    14:10, leg berkickoff 14:05 lolos jendela. Jalur generator kini
//    mengecek ulang tiap kandidat pada nowUtc — leg yang sudah kickoff
//    saat keputusan ditulis, atau yang sudah tercatat void/batal di
//    pick_voids, ditahan. Tanpa bukti status baris warisan dipertahan-
//    kan (fallback konservatif). Definisi cutoff tidak berubah.
//    (B) dedupe laga fisik memakai kunci gabungan: fixture_uid persisten
//    yang tercatat di pick ∪ kunci tautan fixture-links (union transitif)
//    — dua pick pasar berbeda ber-UID sama adalah satu laga fisik walau
//    belum tertaut di fixture-links.
//    (C) kandidat diambil DI DALAM transaksi keputusan, sesudah kunci
//    tulis (BEGIN IMMEDIATE) dan sesudah cek ulang keputusan di transaksi
//    yang sama — state yang dibaca adalah state sesudah lock, bukan
//    snapshot sebelum lock (race WAL: kandidat ke-4 yang commit tepat
//    sebelum lock tidak lagi terlewat).
//  - REVISI PR #12 (brief revisi pemilik 27 Nov 2026, tes D11–D13):
//    (R1) jam penerbitan mengikuti lock yang BENAR-BENAR didapat: jam
//    masuk hanya untuk penjaga cutoff; sesudah BEGIN IMMEDIATE, bukti
//    fixture dibaca dulu, lalu jam dibaca ulang lewat clock terinjeksi
//    (pola lib/picks/publication.ts) dan kickoff dicek ulang menjelang
//    penulisan final — leg yang mencapai kickoff selagi generator
//    menunggu lock tersaring, dan created_utc (tiket + keputusan) adalah
//    jam pasca-lock itu, BUKAN jam masuk. Reproduksi audit: jam masuk
//    14:15:12, leg kickoff 14:15:15, lock lepas 14:15:16 → head lama
//    menerbitkan leg itu dengan created_utc pra-lock.
//    (R2) selektor membaca bukti jadwal/status yang SUDAH tersedia di
//    thestats_dataset.db (read-only, batch/terindeks): UID kanonik
//    berstatus live/finished/cancelled/postponed, kickoff terverifikasi
//    (presisi 'exact') yang sudah lewat jam penerbitan atau terkoreksi
//    keluar jendela hari keputusan, dan void provider_cancelled ber-UID
//    menahan SELURUH laga fisiknya. Pick ber-UID kosong memakai alias
//    dataset terverifikasi sebagai UID-nya (ikut union dedupe). Tanpa
//    data kanonik → fallback lama persis. Bukti ambigu (state 'unknown',
//    kickoff presisi 'date_only') tidak ditebak jadi scheduled.
//    (R3) retry keputusan yang sudah ada cukup MEMBACA: pembacaan cepat
//    (SELECT murni, tanpa DDL/lock) berjalan sebelum ensureFix4Schema
//    dan sebelum BEGIN IMMEDIATE, sehingga retry di bawah lock writer
//    lain tidak lagi SQLITE_BUSY. Pembacaan ulang + seleksi baru di
//    dalam transaksi dipertahankan untuk jalur keputusan belum ada.
//  - FINALISASI PR #12 (brief finalisasi pemilik 27 Nov 2026, tes
//    D14–D16):
//    (F1) batas kickoff penerbitan adalah nilai INTERNAL generator:
//    waktu paling awal dari kickoff ledger dan kickoff kanonik
//    presisi 'exact' yang valid, per grup laga fisik. Batas yang sama
//    dipakai saat seleksi, pemeriksaan menjelang tulis, DAN
//    pemeriksaan terakhir tepat sebelum COMMIT (sesudah baris tiket +
//    leg disiapkan di dalam transaksi); batas inklusif untuk
//    penolakan (now >= kickoff → tertahan). Batas terlewati saat
//    menulis → SELURUH transaksi percobaan di-rollback, jam diambil
//    ulang, seleksi diulang; guard percobaan habis → kegagalan jelas.
//    Fix4Candidate.kickoff_utc dan histori pick TETAP snapshot
//    publikasi — tidak pernah ditimpa batas internal ini.
//    (F2) bukti pembatalan provider ber-UID dibaca dari picks.db
//    (pick_voids reason='provider_cancelled') DI DALAM transaksi
//    generator, terlepas dari keberhasilan membuka dataset/menemukan
//    tabel identitas — satu void membatalkan SELURUH laga fisiknya.
//    Void biasa tetap per pick; bukti fixture + bukti pembatalan
//    sama-sama absen → jalur warisan dengan kickoff ledger.
//    (F3) retry dari entrypoint scheduler (CLI) mencoba lookup
//    keputusan existing dengan koneksi READ-ONLY lebih dulu; getter
//    writable (yang menjalankan backfill legacy saat dibuka) hanya
//    dipakai bila keputusan baru perlu dibuat. Cek ulang keputusan di
//    dalam transaksi tulis dipertahankan.
// ============================================================================
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ensurePublicationSchema } from "./publication";
import { statusFeedKompetisi } from "./feed-coverage";
import { SETTLEMENT_WINDOW_MS } from "./cohort";
import { SlateIdentity, parseSlateLinks } from "./slate-identity";
import { dbPath } from "../db/paths";
import {
  getFixtureByUid,
  getUidForMatchId,
  identityTablesExist,
} from "../identity/fixture-resolver";
import {
  FIX4_ABSTAIN_IF_BELOW_SIZE,
  FIX4_MIN_PUBLISHED_PROB,
  FIX4_POLICY_VERSION,
  FIX4_TICKET_SIZE,
  fix4WindowForDate,
} from "./fix4-policy";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Identitas fixture kanonik dari data/fixture-links.json (boleh tidak
 * ada) — pola yang sama persis dengan loadSlateIdentity di pick-slate:
 * berkas hilang/rusak → identitas kosong (semua fixture memakai
 * match_id-nya sendiri, perilaku warisan).
 */
export function loadFix4Identity(cwd: string = process.cwd()): SlateIdentity {
  const p = path.join(cwd, "data", "fixture-links.json");
  if (!fs.existsSync(p)) return new SlateIdentity([]);
  return new SlateIdentity(parseSlateLinks(fs.readFileSync(p, "utf8")));
}

// ---------------------------------------------------------------------------
// Skema aditif (idempoten) — tabel khusus Fix-4 di picks.db.
// ---------------------------------------------------------------------------

export function ensureFix4Schema(db: DatabaseSync): void {
  ensurePublicationSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS fix4_daily_decisions (
      date_wib TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('PUBLISHED', 'ABSTAIN')),
      decision_ts TEXT NOT NULL,
      eligible_count INTEGER NOT NULL,
      reason TEXT,
      ticket_uid TEXT,
      policy_version TEXT NOT NULL,
      created_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fix4_tickets (
      ticket_uid TEXT PRIMARY KEY,
      date_wib TEXT NOT NULL UNIQUE,
      decision_ts TEXT NOT NULL,
      expected_hit_prob REAL NOT NULL,
      ticket_hash TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      created_utc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fix4_ticket_legs (
      ticket_uid TEXT NOT NULL REFERENCES fix4_tickets(ticket_uid),
      position INTEGER NOT NULL,
      pick_id INTEGER NOT NULL REFERENCES picks(id),
      match_id TEXT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      published_prob REAL NOT NULL,
      PRIMARY KEY (ticket_uid, position),
      UNIQUE (ticket_uid, pick_id)
    );
    CREATE INDEX IF NOT EXISTS idx_fix4_legs_pick ON fix4_ticket_legs(pick_id);
  `);
}

// ---------------------------------------------------------------------------
// Kandidat
// ---------------------------------------------------------------------------

export interface Fix4Candidate {
  pick_id: number;
  /** fixture_id dalam kosakata picks.db. */
  match_id: string;
  competition_canonical_id: string | null;
  kickoff_utc: string;
  market: string;
  selection: string;
  published_prob: number;
}

interface Fix4CandidateRow {
  id: number;
  match_id: string;
  fixture_uid: string | null;
  competition_canonical_id: string | null;
  kickoff_utc: string;
  market: string;
  selection: string;
  published_prob: number;
}

/**
 * Baris pool kandidat mentah satu tanggal WIB (predikat pool beku:
 * published_prob terisi, bukan duplikat, kickoff di jendela, terbit
 * pada/saat cutoff), terurut deterministik. Dipakai bersama oleh
 * selektor dan pemuat bukti dataset agar keduanya membaca pool yang
 * sama persis.
 */
function loadFix4CandidateRows(db: DatabaseSync, dateWib: string): Fix4CandidateRow[] {
  const w = fix4WindowForDate(dateWib);
  return db
    .prepare(
      `SELECT id, match_id, fixture_uid, competition_canonical_id, kickoff_utc, market, selection, published_prob
       FROM picks
       WHERE published_prob IS NOT NULL
         AND duplicate_of IS NULL
         AND kickoff_utc > ? AND kickoff_utc <= ?
         AND created_utc <= ?
       ORDER BY published_prob DESC, match_id ASC, id ASC`,
    )
    .all(w.window_start_utc, w.window_end_utc, w.decision_ts_utc) as unknown as Fix4CandidateRow[];
}

// ---------------------------------------------------------------------------
// Bukti jadwal/status dari thestats_dataset.db (revisi PR #12 — R2)
// ---------------------------------------------------------------------------

/**
 * Potret bukti fixture untuk pool kandidat satu tanggal, dibaca
 * read-only dari store identitas di thestats_dataset.db plus
 * pick_voids di picks.db. null = tidak ada bukti yang bisa dipakai
 * (DB dataset tak ada / tabel identitas belum ada) → selektor memakai
 * fallback lama persis.
 */
export interface Fix4FixtureEvidence {
  /** UID terverifikasi dari alias dataset, per match_id — untuk pick ber-UID kosong. */
  uidByMatchId: Map<string, string>;
  /** Keadaan fixture kanonik per UID (hanya UID yang barisnya ada). */
  canonicalByUid: Map<
    string,
    { state: string; kickoff_utc: string | null; kickoff_precision: string }
  >;
  /** UID yang terbukti dibatalkan provider (pick_voids reason='provider_cancelled' ber-fxid). */
  providerCancelledUids: ReadonlySet<string>;
}

/** State kanonik yang membuktikan laga TIDAK berjalan sesuai jadwal terbit. */
const FIX4_CANONICAL_HOLD_STATES: ReadonlySet<string> = new Set([
  "live",
  "finished",
  "cancelled",
  "postponed",
]);

/**
 * Muat bukti fixture untuk pool kandidat `dateWib`. Pembacaan batch
 * terindeks: alias via idx_fa_match (source_match_id), fixture kanonik
 * via PRIMARY KEY (fixture_uid). Mulai dari UID pick; bila kosong,
 * alias dataset yang terverifikasi. Mengembalikan null bila store
 * identitas tidak tersedia — pemanggil jatuh ke fallback lama.
 */
export function loadFix4FixtureEvidence(
  db: DatabaseSync,
  dateWib: string,
  datasetDb: DatabaseSync,
): Fix4FixtureEvidence | null {
  if (!identityTablesExist(datasetDb)) return null;
  const rows = loadFix4CandidateRows(db, dateWib);

  const uidByMatchId = new Map<string, string>();
  const uids = new Set<string>();
  for (const r of rows) {
    if (r.fixture_uid) {
      uids.add(r.fixture_uid);
      continue;
    }
    const uid = getUidForMatchId(datasetDb, r.match_id);
    if (uid) {
      uidByMatchId.set(r.match_id, uid);
      uids.add(uid);
    }
  }

  const canonicalByUid: Fix4FixtureEvidence["canonicalByUid"] = new Map();
  for (const uid of uids) {
    const fx = getFixtureByUid(datasetDb, uid);
    if (fx) {
      canonicalByUid.set(uid, {
        state: fx.state,
        kickoff_utc: fx.kickoff_utc,
        kickoff_precision: fx.kickoff_precision,
      });
    }
  }

  const providerCancelledUids = new Set<string>();
  const hasVoidsTable = db
    .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'pick_voids'")
    .get() as { x: number } | undefined;
  if (hasVoidsTable) {
    const voidRows = db
      .prepare(
        "SELECT DISTINCT fixture_uid FROM pick_voids WHERE reason = 'provider_cancelled' AND fixture_uid IS NOT NULL",
      )
      .all() as unknown as { fixture_uid: string }[];
    for (const v of voidRows) providerCancelledUids.add(v.fixture_uid);
  }

  return { uidByMatchId, canonicalByUid, providerCancelledUids };
}

/** Buka thestats_dataset.db read-only bila berkasnya ada (pola resolver). */
function openDatasetEvidenceDb(): DatabaseSync | null {
  try {
    const p = dbPath("thestats_dataset.db");
    if (!fs.existsSync(p)) return null;
    return new DatabaseSync(p, { readOnly: true });
  } catch {
    return null;
  }
}

/**
 * Kandidat layak Fix-4 untuk tanggal WIB tertentu, SUDAH terurut
 * deterministik dan terdedupe per laga FISIK (pilihan terbaik tiap
 * laga). Kunci laga fisik adalah gabungan (union transitif) dari:
 * fixture_uid persisten yang tercatat di pick, dan kunci identitas
 * tautan fixture-links (fallback match_id untuk baris tak tertaut dan
 * ber-UID kosong). Pick termarking `duplicate_of` tersaring di kueri
 * dan tidak pernah muncul di hasil. Murni baca — tidak menulis apa pun
 * ke picks.db (identitas dibaca dari berkas tautan).
 *
 * Parameter `nowUtc` (opsional, diisi jalur generator): cek ulang saat
 * penerbitan — kandidat yang sudah kickoff pada momen itu
 * (kickoff_utc <= nowUtc) atau yang sudah tercatat void/batal di
 * pick_voids ditahan. Tanpa bukti status (tidak ada baris void), baris
 * warisan dipertahankan: fallback konservatif, bukan tebakan.
 *
 * Opsi `opts.datasetDb` / `opts.evidence` (revisi PR #12 — R2): bukti
 * jadwal/status dari thestats_dataset.db. `evidence` yang diberikan
 * dipakai apa adanya (null = tanpa bukti); bila hanya `datasetDb`
 * diberikan, bukti dimuat dari handle itu; bila keduanya absen,
 * perilaku lama persis. Dengan bukti: UID pick kosong diganti alias
 * dataset (ikut union dedupe), dan SELURUH laga fisik ditahan bila
 * fixture kanoniknya berstatus live/finished/cancelled/postponed,
 * kickoff terverifikasinya (presisi 'exact') sudah lewat `nowUtc` atau
 * terkoreksi keluar jendela hari keputusan, atau UID-nya terbukti
 * provider_cancelled. Kickoff/probabilitas pick terbit TIDAK diubah.
 *
 * Finalisasi PR #12: himpunan provider_cancelled kini juga dibaca
 * langsung dari picks.db (F2 — berlaku walau bukti dataset null), dan
 * seleksi internal mengembalikan batas kickoff penerbitan per pick
 * (F1 — paling awal dari kickoff ledger dan kickoff kanonik 'exact');
 * saringan waktu memakai batas itu, bukan hanya kickoff ledger.
 * Batas kanonik dihitung per GRUP laga fisik (D17): kickoff kanonik
 * 'exact' paling awal dari semua alias segrup, sehingga alias terpilih
 * yang tidak punya UID tetap terikat bukti kanonik grupnya.
 */
/**
 * Hasil seleksi internal generator: kandidat layak + batas kickoff
 * penerbitan per pick (finalisasi PR #12 — F1). Batas adalah nilai
 * INTERNAL: waktu paling awal dari kickoff ledger dan kickoff kanonik
 * presisi 'exact' yang valid bagi grup laga fisik kandidat.
 * `Fix4Candidate.kickoff_utc` tetap snapshot publikasi pick.
 */
interface Fix4Selection {
  candidates: Fix4Candidate[];
  boundMsByPickId: Map<number, number>;
}

function selectFix4CandidatesInternal(
  db: DatabaseSync,
  dateWib: string,
  identity: SlateIdentity,
  nowUtc?: string,
  opts?: {
    datasetDb?: DatabaseSync | null;
    evidence?: Fix4FixtureEvidence | null;
  },
): Fix4Selection {
  ensureFix4Schema(db);
  const w = fix4WindowForDate(dateWib);
  const rows = loadFix4CandidateRows(db, dateWib);

  // Bukti dataset (R2): potret eksplisit didahulukan; handle dataset
  // dimuat on-demand; selain itu tanpa bukti (fallback lama).
  const evidence: Fix4FixtureEvidence | null =
    opts?.evidence !== undefined
      ? opts.evidence
      : opts?.datasetDb
        ? loadFix4FixtureEvidence(db, dateWib, opts.datasetDb)
        : null;

  const hasVoidsTable =
    (db
      .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'pick_voids'")
      .get() as { x: number } | undefined) !== undefined;

  // UID yang terbukti dibatalkan provider — dibaca dari picks.db
  // LANGSUNG (finalisasi PR #12 — F2), terlepas dari keberhasilan
  // membuka dataset atau menemukan tabel identitas: bukti batalnya
  // memang tinggal di ledger. Digabung dengan himpunan dari loader
  // bukti (sumber yang sama) bila bukti dataset tersedia.
  const providerCancelledUids = new Set<string>(evidence?.providerCancelledUids ?? []);
  if (hasVoidsTable) {
    const voidRows = db
      .prepare(
        "SELECT DISTINCT fixture_uid FROM pick_voids WHERE reason = 'provider_cancelled' AND fixture_uid IS NOT NULL",
      )
      .all() as unknown as { fixture_uid: string }[];
    for (const v of voidRows) providerCancelledUids.add(v.fixture_uid);
  }

  // Cek ulang penerbitan (hanya bila nowUtc diberikan): ambang waktu +
  // himpunan pick yang terbukti void/batal menurut pick_voids.
  let nowMs: number | null = null;
  let voided: ReadonlySet<number> | null = null;
  if (nowUtc !== undefined) {
    nowMs = Date.parse(nowUtc);
    if (!Number.isFinite(nowMs)) throw new Error(`fix4: timestamp tidak valid: ${nowUtc}`);
    if (hasVoidsTable) {
      voided = new Set(
        (db.prepare("SELECT pick_id FROM pick_voids").all() as unknown as { pick_id: number }[]).map(
          (r) => r.pick_id,
        ),
      );
    }
  }

  // UID efektif tiap baris: UID persisten pick, atau alias dataset
  // terverifikasi bila pick ber-UID kosong (R2d).
  const resolvedUid = (r: Fix4CandidateRow): string | null =>
    r.fixture_uid ?? evidence?.uidByMatchId.get(r.match_id) ?? null;

  // Union-find atas baris kandidat: dua baris adalah laga fisik yang
  // sama bila berbagi fixture_uid persisten (atau UID alias dataset)
  // ATAU kunci tautan yang sama (transitif — satu baris dapat
  // menjembatani UID dan tautan).
  const parent = rows.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const firstByUid = new Map<string, number>();
  const firstByLink = new Map<string, number>();
  rows.forEach((r, i) => {
    const uid = resolvedUid(r);
    if (uid) {
      const j = firstByUid.get(uid);
      if (j === undefined) firstByUid.set(uid, i);
      else union(i, j);
    }
    const linkKey = identity.physicalKey(r.match_id);
    const j = firstByLink.get(linkKey);
    if (j === undefined) firstByLink.set(linkKey, i);
    else union(i, j);
  });

  // Batas kickoff kanonik per GRUP laga fisik (D17): kickoff kanonik
  // presisi 'exact' PALING AWAL dari semua alias dalam grup, dihitung
  // sesudah penggabungan alias selesai. Alias yang terpilih bisa saja
  // tidak punya UID (bukti kanoniknya kosong) sementara alias lain
  // segrup membuktikan kickoff sebenarnya jauh lebih awal — batas
  // grup inilah yang harus berlaku, bukan batas alias terpilih saja.
  const groupCanonicalBoundMs = new Map<number, number>();
  rows.forEach((r, i) => {
    const uid = resolvedUid(r);
    const fx = uid ? evidence?.canonicalByUid.get(uid) : undefined;
    if (!fx || fx.kickoff_utc === null || fx.kickoff_precision !== "exact") return;
    const kMs = Date.parse(fx.kickoff_utc);
    if (!Number.isFinite(kMs)) return;
    const root = find(i);
    const prev = groupCanonicalBoundMs.get(root);
    if (prev === undefined || kMs < prev) groupCanonicalBoundMs.set(root, kMs);
  });

  // Batas kickoff penerbitan per kandidat (F1 + D17): waktu yang lebih
  // awal antara kickoff yang tersimpan di pick dan batas kanonik
  // grupnya. Grup tanpa bukti kanonik → kickoff ledger. Batas ini yang
  // dibandingkan dengan jam penerbitan di seleksi DAN di pemeriksaan
  // pra-COMMIT generator — bukan snapshot publikasi pick, yang tidak
  // berubah.
  const boundMsOf = (r: Fix4CandidateRow, i: number): number => {
    let bound = Date.parse(r.kickoff_utc);
    const groupBound = groupCanonicalBoundMs.get(find(i));
    if (groupBound !== undefined) {
      bound = Number.isFinite(bound) ? Math.min(bound, groupBound) : groupBound;
    }
    return bound;
  };

  // Grup laga fisik yang tertahan oleh bukti (R2 + F2): satu baris
  // yang terbukti bermasalah menahan SELURUH grupnya — termasuk void
  // provider_cancelled ber-UID, yang membatalkan laga, bukan satu
  // pick. Bukti pembatalan dibaca dari picks.db (F2) sehingga tetap
  // berlaku walau dataset absen; bukti status/kickoff kanonik hanya
  // dari dataset bila tersedia.
  const heldRoots = new Map<number, string>();
  {
    const windowStartMs = Date.parse(w.window_start_utc);
    const windowEndMs = Date.parse(w.window_end_utc);
    rows.forEach((r, i) => {
      const uid = resolvedUid(r);
      if (!uid) return;
      let reason: string | null = null;
      if (providerCancelledUids.has(uid)) {
        reason = "provider_cancelled (void ber-UID di picks.db)";
      } else if (evidence) {
        const fx = evidence.canonicalByUid.get(uid);
        if (fx) {
          if (FIX4_CANONICAL_HOLD_STATES.has(fx.state)) {
            reason = `status kanonik ${fx.state}`;
          } else if (fx.kickoff_utc !== null && fx.kickoff_precision === "exact") {
            const kMs = Date.parse(fx.kickoff_utc);
            if (Number.isFinite(kMs)) {
              if (kMs <= windowStartMs || kMs > windowEndMs) {
                reason = "kickoff kanonik terkoreksi keluar jendela hari keputusan";
              } else if (nowMs !== null && kMs <= nowMs) {
                reason = "kickoff kanonik sudah lewat jam penerbitan";
              }
            }
          }
        }
      }
      if (reason !== null) {
        const root = find(i);
        if (!heldRoots.has(root)) {
          heldRoots.set(root, reason);
          console.log(`fix4: laga ${uid} ditahan — ${reason}`);
        }
      }
    });
  }

  const seenFixture = new Set<number>();
  const out: Fix4Candidate[] = [];
  const boundMsByPickId = new Map<number, number>();
  rows.forEach((r, i) => {
    if (r.published_prob < FIX4_MIN_PUBLISHED_PROB) return;
    if (statusFeedKompetisi(r.competition_canonical_id) !== "berfeed") return;
    const fixtureRoot = find(i);
    if (heldRoots.has(fixtureRoot)) return;
    if (nowMs !== null) {
      // Batas kickoff penerbitan (ledger/kanonik paling awal, F1)
      // sudah tercapai pada saat keputusan ditulis → tahan.
      if (boundMsOf(r, i) <= nowMs) return;
      // Terbukti batal/void sebelum keputusan ditulis → tahan.
      if (voided !== null && voided.has(r.id)) return;
    }
    if (seenFixture.has(fixtureRoot)) return;
    seenFixture.add(fixtureRoot);
    boundMsByPickId.set(r.id, boundMsOf(r, i));
    out.push({
      pick_id: r.id,
      match_id: r.match_id,
      competition_canonical_id: r.competition_canonical_id,
      kickoff_utc: r.kickoff_utc,
      market: r.market,
      selection: r.selection,
      published_prob: r.published_prob,
    });
  });
  return { candidates: out, boundMsByPickId };
}

export function selectFix4Candidates(
  db: DatabaseSync,
  dateWib: string,
  identity: SlateIdentity = loadFix4Identity(),
  nowUtc?: string,
  opts?: {
    datasetDb?: DatabaseSync | null;
    evidence?: Fix4FixtureEvidence | null;
  },
): Fix4Candidate[] {
  return selectFix4CandidatesInternal(db, dateWib, identity, nowUtc, opts).candidates;
}

// ---------------------------------------------------------------------------
// Generator keputusan harian (append-only)
// ---------------------------------------------------------------------------

export type Fix4DecisionStatus = "PUBLISHED" | "ABSTAIN";

export interface Fix4Decision {
  date_wib: string;
  status: Fix4DecisionStatus;
  decision_ts: string;
  eligible_count: number;
  reason: string | null;
  ticket_uid: string | null;
  expected_hit_prob: number | null;
  legs: Fix4Candidate[];
  /** true bila keputusan ini sudah ada sebelumnya (tidak ditulis ulang). */
  already_existed: boolean;
}

/**
 * Hasil generator bila dipanggil SEBELUM cutoff 14:00 WIB: keputusan
 * belum boleh dibekukan. Bukan keputusan tercatat — tidak pernah ditulis
 * ke fix4_daily_decisions; murni sinyal "Menunggu batas penilaian".
 */
export interface Fix4WaitingDecision {
  date_wib: string;
  status: "WAITING_CUTOFF";
  decision_ts: string;
  eligible_count: null;
  reason: string;
  ticket_uid: null;
  expected_hit_prob: null;
  legs: Fix4Candidate[];
  already_existed: false;
}

/** Hasil panggilan generator: keputusan beku, atau menunggu cutoff. */
export type Fix4GenerationResult = Fix4Decision | Fix4WaitingDecision;

/**
 * Penjaga cutoff bersama (generator inti + CLI): kembalikan objek
 * WAITING_CUTOFF bila nowUtc < decision_ts tanggal itu, null bila
 * generasi sudah boleh jalan (now >= decision_ts; tepat pada cutoff
 * SUDAH boleh — batas inklusif yang sama dengan saringan kandidat
 * created_utc <= decision_ts). Murni hitungan jam — tidak menyentuh DB.
 */
export function fix4WaitingIfBeforeCutoff(
  dateWib: string,
  nowUtc: string,
): Fix4WaitingDecision | null {
  const w = fix4WindowForDate(dateWib);
  const now = Date.parse(nowUtc);
  if (!Number.isFinite(now)) throw new Error(`fix4: timestamp tidak valid: ${nowUtc}`);
  if (now >= Date.parse(w.decision_ts_utc)) return null;
  return {
    date_wib: dateWib,
    status: "WAITING_CUTOFF",
    decision_ts: w.decision_ts_utc,
    eligible_count: null,
    reason:
      `Menunggu batas penilaian — keputusan ${dateWib} baru dibekukan ` +
      `pada cutoff ${w.decision_ts_utc} (14:00 WIB).`,
    ticket_uid: null,
    expected_hit_prob: null,
    legs: [],
    already_existed: false,
  };
}

function readDecision(db: DatabaseSync, dateWib: string): Fix4Decision | null {
  const d = db
    .prepare(
      "SELECT date_wib, status, decision_ts, eligible_count, reason, ticket_uid FROM fix4_daily_decisions WHERE date_wib = ?",
    )
    .get(dateWib) as unknown as
    | {
        date_wib: string;
        status: Fix4DecisionStatus;
        decision_ts: string;
        eligible_count: number;
        reason: string | null;
        ticket_uid: string | null;
      }
    | undefined;
  if (!d) return null;
  let legs: Fix4Candidate[] = [];
  let expected: number | null = null;
  if (d.ticket_uid) {
    const t = db
      .prepare("SELECT expected_hit_prob FROM fix4_tickets WHERE ticket_uid = ?")
      .get(d.ticket_uid) as unknown as { expected_hit_prob: number } | undefined;
    expected = t?.expected_hit_prob ?? null;
    const legRows = db
      .prepare(
        `SELECT l.pick_id, l.match_id, l.market, l.selection, l.published_prob,
                p.competition_canonical_id, p.kickoff_utc
         FROM fix4_ticket_legs l JOIN picks p ON p.id = l.pick_id
         WHERE l.ticket_uid = ? ORDER BY l.position ASC`,
      )
      .all(d.ticket_uid) as unknown as (Fix4Candidate & { pick_id: number })[];
    legs = legRows.map((r) => ({
      pick_id: r.pick_id,
      match_id: r.match_id,
      competition_canonical_id: r.competition_canonical_id,
      kickoff_utc: r.kickoff_utc,
      market: r.market,
      selection: r.selection,
      published_prob: r.published_prob,
    }));
  }
  return {
    date_wib: d.date_wib,
    status: d.status,
    decision_ts: d.decision_ts,
    eligible_count: d.eligible_count,
    reason: d.reason,
    ticket_uid: d.ticket_uid,
    expected_hit_prob: expected,
    legs,
    already_existed: true,
  };
}

/** Tabel keputusan Fix-4 sudah ada? (SELECT murni — aman di bawah lock writer lain.) */
function fix4DecisionsTableExists(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'fix4_daily_decisions'",
    )
    .get() as { x: number } | undefined;
  return row !== undefined;
}

/**
 * Baca keputusan yang SUDAH tercatat untuk satu tanggal WIB — SELECT
 * murni, tanpa DDL dan tanpa lock tulis (R3). Aman dipanggil lewat
 * koneksi read-only (jalur retry CLI, finalisasi PR #12 — F3) maupun
 * koneksi biasa di bawah lock writer lain. null = belum ada keputusan
 * (atau tabelnya belum ada).
 */
export function readExistingFix4Decision(
  db: DatabaseSync,
  dateWib: string,
): Fix4Decision | null {
  if (!fix4DecisionsTableExists(db)) return null;
  return readDecision(db, dateWib);
}

/** Batas percobaan tulis generator sebelum menyerah (F1). */
const FIX4_WRITE_ATTEMPTS = 3;

/** Opsi generator Fix-4 (revisi PR #12). */
export interface Fix4GenerateOptions {
  /**
   * Jam yang BISA DIBACA ULANG (R1). Nilai masuk `nowUtc` hanya untuk
   * penjaga cutoff; jam penerbitan dibaca lewat clock ini SESUDAH lock
   * tulis diperoleh dan bukti fixture dibaca — mengikuti pola
   * lib/picks/publication.ts. Default: () => nowUtc (perilaku lama
   * untuk pemanggil yang menanam jam tetap, mis. tes).
   */
  now?: () => string;
  /**
   * Handle thestats_dataset.db read-only untuk bukti R2. `undefined`
   * (bawaan) = buka berkas default read-only bila ada; `null` = tanpa
   * bukti dataset (fallback lama); handle = pakai handle pemanggil
   * (tidak ditutup oleh generator).
   */
  datasetDb?: DatabaseSync | null;
}

/**
 * Hasilkan (atau baca kembali) keputusan Fix-4 satu tanggal WIB.
 * Menulis snapshot beku secara append-only; tidak pernah menimpa.
 * Sebelum cutoff (nowUtc < decision_ts) TIDAK menulis apa pun dan
 * mengembalikan status WAITING_CUTOFF — penjaga ini berjalan sebelum
 * DB disentuh sama sekali, jadi pemanggil lain aman dari pembekuan
 * dini dan jalur CLI sebelum cutoff tidak membuka DB.
 *
 * Retry keputusan yang sudah ada cukup MEMBACA (R3): pembacaan cepat
 * SELECT murni — tanpa DDL, tanpa lock — berjalan sebelum skema
 * disentuh; di bawah lock writer lain pun UID yang sama kembali.
 * Untuk keputusan yang belum ada, SELURUH bacaan (cek ulang keputusan
 * + bukti fixture + seleksi kandidat) terjadi di dalam satu transaksi
 * BEGIN IMMEDIATE agar keputusan memakai state ledger sesudah lock,
 * dan jam penerbitan dibaca ulang di dalam lock itu (R1): cap
 * created_utc pada fix4_tickets DAN fix4_daily_decisions adalah jam
 * pasca-lock yang sama, dan leg yang mencapai kickoff sejak seleksi
 * memicu evaluasi ulang dengan jam baru sebelum penulisan final.
 * Finalisasi (F1): pemeriksaan terakhir berjalan tepat sebelum
 * COMMIT — sesudah baris tiket + leg disiapkan — memakai batas
 * kickoff internal selektor (ledger/kanonik paling awal); batas
 * terlewati saat menulis me-rollback seluruh transaksi percobaan dan
 * seleksi diulang sebagai percobaan baru (maks FIX4_WRITE_ATTEMPTS).
 */
export function generateFix4Ticket(
  db: DatabaseSync,
  dateWib: string,
  nowUtc: string,
  opts: Fix4GenerateOptions = {},
): Fix4GenerationResult {
  const waiting = fix4WaitingIfBeforeCutoff(dateWib, nowUtc);
  if (waiting) return waiting;

  // R3 — jalur cepat retry: keputusan yang sudah tercatat dikembalikan
  // dari bacaan biasa. Di WAL, SELECT tidak meminta lock tulis, jadi
  // writer lain yang sedang memegang BEGIN IMMEDIATE tidak menghalangi
  // (head lama menjalankan DDL + BEGIN IMMEDIATE lebih dulu → BUSY).
  const existing = readExistingFix4Decision(db, dateWib);
  if (existing) return existing;

  ensureFix4Schema(db);
  const w = fix4WindowForDate(dateWib);
  const clock = opts.now ?? (() => nowUtc);

  // Bukti dataset (R2): handle pemanggil dipakai apa adanya; bawaan =
  // buka berkas default read-only bila ada (ditutup lagi di finally).
  let datasetDb: DatabaseSync | null = null;
  let ownDataset = false;
  if (opts.datasetDb !== undefined) {
    datasetDb = opts.datasetDb;
  } else {
    datasetDb = openDatasetEvidenceDb();
    ownDataset = datasetDb !== null;
  }

  try {
    // Loop percobaan tulis (F1): setiap percobaan adalah satu transaksi
    // BEGIN IMMEDIATE penuh — cek ulang keputusan, baca bukti, sampel
    // jam, seleksi, tulis baris, lalu pemeriksaan terakhir tepat
    // sebelum COMMIT. Bila batas kickoff leg mana pun tercapai SELAGI
    // statement menulis, seluruh percobaan di-rollback dan seleksi
    // diulang dengan jam baru; guard percobaan habis → kegagalan jelas
    // (dan percobaan terakhir sudah ter-rollback).
    for (let attempt = 1; attempt <= FIX4_WRITE_ATTEMPTS; attempt++) {
      db.exec("BEGIN IMMEDIATE");
      let crossedAtWrite = false;
      try {
        // Cek ulang di dalam transaksi (penulis bersamaan tidak menggandakan).
        const raced = readDecision(db, dateWib);
        if (raced) {
          db.exec("COMMIT");
          return raced;
        }
        // Bukti fixture terbaru dibaca di dalam lock, SEBELUM jam —
        // urutan pola penerbit pick resmi (publication.ts): bacaan state
        // yang lambat tidak boleh menyisakan jam basi.
        const evidence = datasetDb ? loadFix4FixtureEvidence(db, dateWib, datasetDb) : null;
        // Jam penerbitan: dibaca SESUDAH lock (dan sesudah bukti).
        // Kandidat diambil di dalam transaksi yang sama: state ledger
        // sesudah lock — kandidat yang commit dari penulis lain tepat
        // sebelum lock ikut terhitung (audit 27 Nov 2026 §1, race
        // snapshot WAL).
        const publishNow = clock();
        const selection = selectFix4CandidatesInternal(
          db,
          dateWib,
          loadFix4Identity(),
          publishNow,
          { evidence },
        );
        const candidates = selection.candidates;
        if (FIX4_ABSTAIN_IF_BELOW_SIZE && candidates.length < FIX4_TICKET_SIZE) {
          const reason =
            `kandidat layak ${candidates.length} < ${FIX4_TICKET_SIZE} ` +
            `(ambang published_prob >= ${FIX4_MIN_PUBLISHED_PROB}, kompetisi berfeed, ` +
            `maks 1 per laga, jendela ${w.window_start_utc}..${w.window_end_utc})`;
          db.prepare(
            `INSERT INTO fix4_daily_decisions
               (date_wib, status, decision_ts, eligible_count, reason, ticket_uid, policy_version, created_utc)
             VALUES (?, 'ABSTAIN', ?, ?, ?, NULL, ?, ?)`,
          ).run(dateWib, w.decision_ts_utc, candidates.length, reason, FIX4_POLICY_VERSION, publishNow);
          db.exec("COMMIT");
          return {
            date_wib: dateWib,
            status: "ABSTAIN",
            decision_ts: w.decision_ts_utc,
            eligible_count: candidates.length,
            reason,
            ticket_uid: null,
            expected_hit_prob: null,
            legs: [],
            already_existed: false,
          };
        }

        const legs = candidates.slice(0, FIX4_TICKET_SIZE);
        const expected = legs.reduce((acc, l) => acc * l.published_prob, 1);
        const ticketUid = `fx4_${sha256(`${FIX4_POLICY_VERSION}|${dateWib}`).slice(0, 24)}`;
        const ticketHash = sha256(
          JSON.stringify({
            policy_version: FIX4_POLICY_VERSION,
            date_wib: dateWib,
            decision_ts: w.decision_ts_utc,
            legs: legs.map((l) => ({
              pick_id: l.pick_id,
              match_id: l.match_id,
              market: l.market,
              selection: l.selection,
              published_prob: l.published_prob,
            })),
            expected_hit_prob: expected,
          }),
        );
        db.prepare(
          `INSERT INTO fix4_tickets
             (ticket_uid, date_wib, decision_ts, expected_hit_prob, ticket_hash, policy_version, created_utc)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(ticketUid, dateWib, w.decision_ts_utc, expected, ticketHash, FIX4_POLICY_VERSION, publishNow);
        const insLeg = db.prepare(
          `INSERT INTO fix4_ticket_legs
             (ticket_uid, position, pick_id, match_id, market, selection, published_prob)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        legs.forEach((l, i) => {
          insLeg.run(ticketUid, i + 1, l.pick_id, l.match_id, l.market, l.selection, l.published_prob);
        });
        db.prepare(
          `INSERT INTO fix4_daily_decisions
             (date_wib, status, decision_ts, eligible_count, reason, ticket_uid, policy_version, created_utc)
           VALUES (?, 'PUBLISHED', ?, ?, NULL, ?, ?, ?)`,
        ).run(dateWib, w.decision_ts_utc, candidates.length, ticketUid, FIX4_POLICY_VERSION, publishNow);
        // Pemeriksaan TERAKHIR tepat sebelum COMMIT (F1): jam dibaca
        // lagi sesudah baris tiket + leg + keputusan disiapkan di
        // dalam transaksi. Batas yang dibandingkan adalah batas
        // kickoff penerbitan internal leg (ledger/kanonik paling
        // awal), inklusif: now >= batas → percobaan gugur seluruhnya.
        const finalNowMs = Date.parse(clock());
        crossedAtWrite = legs.some(
          (l) =>
            (selection.boundMsByPickId.get(l.pick_id) ?? Date.parse(l.kickoff_utc)) <=
            finalNowMs,
        );
        if (!crossedAtWrite) {
          db.exec("COMMIT");
          return {
            date_wib: dateWib,
            status: "PUBLISHED",
            decision_ts: w.decision_ts_utc,
            eligible_count: candidates.length,
            reason: null,
            ticket_uid: ticketUid,
            expected_hit_prob: expected,
            legs,
            already_existed: false,
          };
        }
        db.exec("ROLLBACK");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* transaksi sudah tertutup */
        }
        throw e;
      }
      // crossedAtWrite: percobaan sudah di-rollback di atas; ulangi
      // dengan jam baru pada percobaan berikutnya.
    }
    throw new Error(
      `fix4: keputusan ${dateWib} gagal dibekukan — kickoff kandidat terlewati ` +
        `pada setiap percobaan tulis (${FIX4_WRITE_ATTEMPTS}x); semua transaksi ` +
        `percobaan sudah di-rollback, tidak ada baris yang ditulis.`,
    );
  } finally {
    if (ownDataset && datasetDb) {
      try {
        datasetDb.close();
      } catch {
        /* handle sudah tertutup */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Settlement tiket utuh + metrik pembuktian
// ---------------------------------------------------------------------------

export type Fix4LegState = "hit" | "miss" | "void" | "unresolvable" | "pending";
export type Fix4TicketStatus = "WIN" | "LOSS" | "VOID_OR_UNRESOLVABLE" | "PENDING";

/** Status settlement satu tiket Fix-4 pada momen nowUtc. */
export function fix4TicketStatus(
  db: DatabaseSync,
  ticketUid: string,
  nowUtc: string,
): { status: Fix4TicketStatus; leg_states: Fix4LegState[] } | null {
  ensureFix4Schema(db);
  const t = db
    .prepare("SELECT ticket_uid FROM fix4_tickets WHERE ticket_uid = ?")
    .get(ticketUid);
  if (!t) return null;
  const rows = db
    .prepare(
      `SELECT l.position, p.competition_canonical_id, p.kickoff_utc,
              o.hit AS outcome_hit, v.pick_id AS void_pick
       FROM fix4_ticket_legs l
       JOIN picks p ON p.id = l.pick_id
       LEFT JOIN pick_outcomes o ON o.pick_id = l.pick_id
       LEFT JOIN pick_voids v ON v.pick_id = l.pick_id
       WHERE l.ticket_uid = ? ORDER BY l.position ASC`,
    )
    .all(ticketUid) as unknown as {
    position: number;
    competition_canonical_id: string | null;
    kickoff_utc: string | null;
    outcome_hit: number | null;
    void_pick: number | null;
  }[];
  const now = Date.parse(nowUtc);
  const legStates: Fix4LegState[] = rows.map((r) => {
    if (r.void_pick != null) return "void";
    if (r.outcome_hit != null) return r.outcome_hit === 1 ? "hit" : "miss";
    const overdue =
      r.kickoff_utc != null && now > Date.parse(r.kickoff_utc) + SETTLEMENT_WINDOW_MS;
    if (overdue && statusFeedKompetisi(r.competition_canonical_id) === "tanpa-feed") {
      return "unresolvable";
    }
    return "pending";
  });
  let status: Fix4TicketStatus;
  if (legStates.includes("miss")) status = "LOSS";
  else if (legStates.every((s) => s === "hit")) status = "WIN";
  else if (legStates.some((s) => s === "void" || s === "unresolvable")) {
    status = "VOID_OR_UNRESOLVABLE";
  } else status = "PENDING";
  return { status, leg_states: legStates };
}

/** Interval Wilson 95% untuk proporsi binomial (rumus standar, z = 1,96). */
export function wilsonInterval95(
  successes: number,
  n: number,
): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = 1.96;
  const z2 = z * z;
  const p = successes / n;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export interface Fix4ProofMetrics {
  /** Tiket terminal WIN. */
  wins: number;
  /** Tiket terminal LOSS. */
  losses: number;
  /** Tiket VOID_OR_UNRESOLVABLE (di luar penyebut hit-rate). */
  void_or_unresolvable: number;
  /** Tiket masih PENDING. */
  pending: number;
  /** Penyebut hit-rate: WIN + LOSS. */
  ticket_count: number;
  /** wins / ticket_count; null bila belum ada tiket terminal. */
  ticket_hit_rate: number | null;
  /** Wilson 95% CI atas ticket_hit_rate. */
  ticket_hit_rate_ci95: { low: number; high: number } | null;
  /** Rerata expected_hit_prob beku atas tiket terminal (WIN + LOSS). */
  expected_hit_rate: number | null;
  /** Hari dengan keputusan ABSTAIN pada periode. */
  abstain_days: number;
  /** Hari dengan tiket terbit pada periode. */
  published_days: number;
  /** published / (published + abstain); null bila belum ada keputusan. */
  coverage: number | null;
}

/**
 * Agregator metrik pembuktian tiket utuh untuk rentang tanggal WIB
 * (inklusif; kosong = semua). Terpisah dari statistik pick satuan.
 */
export function fix4ProofMetrics(
  db: DatabaseSync,
  range: { from_date_wib?: string; to_date_wib?: string },
  nowUtc: string,
): Fix4ProofMetrics {
  ensureFix4Schema(db);
  const from = range.from_date_wib ?? "0000-01-01";
  const to = range.to_date_wib ?? "9999-12-31";
  const decisions = db
    .prepare(
      "SELECT status FROM fix4_daily_decisions WHERE date_wib >= ? AND date_wib <= ?",
    )
    .all(from, to) as unknown as { status: Fix4DecisionStatus }[];
  const abstainDays = decisions.filter((d) => d.status === "ABSTAIN").length;
  const publishedDays = decisions.filter((d) => d.status === "PUBLISHED").length;

  const tickets = db
    .prepare(
      `SELECT t.ticket_uid, t.expected_hit_prob
       FROM fix4_tickets t
       JOIN fix4_daily_decisions d ON d.date_wib = t.date_wib
       WHERE t.date_wib >= ? AND t.date_wib <= ?`,
    )
    .all(from, to) as unknown as { ticket_uid: string; expected_hit_prob: number }[];

  let wins = 0;
  let losses = 0;
  let voids = 0;
  let pending = 0;
  let expectedSum = 0;
  for (const t of tickets) {
    const s = fix4TicketStatus(db, t.ticket_uid, nowUtc);
    if (!s) continue;
    if (s.status === "WIN") {
      wins++;
      expectedSum += t.expected_hit_prob;
    } else if (s.status === "LOSS") {
      losses++;
      expectedSum += t.expected_hit_prob;
    } else if (s.status === "VOID_OR_UNRESOLVABLE") voids++;
    else pending++;
  }
  const settled = wins + losses;
  const decidedDays = publishedDays + abstainDays;
  return {
    wins,
    losses,
    void_or_unresolvable: voids,
    pending,
    ticket_count: settled,
    ticket_hit_rate: settled > 0 ? wins / settled : null,
    ticket_hit_rate_ci95: wilsonInterval95(wins, settled),
    expected_hit_rate: settled > 0 ? expectedSum / settled : null,
    abstain_days: abstainDays,
    published_days: publishedDays,
    coverage: decidedDays > 0 ? publishedDays / decidedDays : null,
  };
}
