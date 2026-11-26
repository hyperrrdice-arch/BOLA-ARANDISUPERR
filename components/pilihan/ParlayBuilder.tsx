"use client";

/**
 * PARLAY BUILDER — daftar pilihan RESMI pra-laga + panel Pilihanmu.
 *
 * ALIRAN DATA (temuan #3 verifikasi produksi — beban awal): Server
 * Component hanya mengirim ringkasan 20 kelompok laga pertama filter
 * bawaan + total terfilter. Halaman berikutnya, pencarian, dan
 * perubahan saringan diambil dari /api/pilihan (saringan berjalan di
 * server atas SELURUH umpan). Matriks skor TIDAK dikirim di muka:
 * diambil lazy berkelompok dari /api/pilihan/matriks hanya untuk
 * paket laga yang benar-benar digabungkan (atau dipulihkan dari
 * draf), lalu dipakai ulang dari cache komponen. Pemulihan draf
 * divalidasi di server lewat /api/pilihan/pulih. Komponen ini hanya
 * memegang pilihan pengguna (draf browser — tidak pernah masuk rekam
 * hasil resmi, D4).
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
 *   dengan asumsi independensi yang DITULIS. Permintaan matriks per
 *   paket punya EMPAT keadaan (lanjut-2): "memuat" (deduplikasi
 *   berlaku), "berhasil", "kosong" (server menjawab null — paket
 *   memang tanpa matriks; keadaan akhir), dan "gagal" (jaringan /
 *   server — penanda berjalan dilepas, jadi interaksi berikutnya
 *   atau tombol "Coba lagi" di panel memuat ulang). Selama matriks
 *   belum ada — alasan apa pun — gabungannya jatuh ke jalur pesan
 *   "Peluang gabungan belum tersedia", bukan crash dan bukan angka
 *   dari edisi lain.
 *   Edisi bersama dibuktikan dari packageId (lanjut-1): grup yang
 *   pilihannya berasal dari paket berbeda TIDAK tersedia dengan
 *   alasan edisi berbeda — matriksnya bahkan tidak diambil — dan
 *   total draf tertahan selama ada grup seperti itu.
 * - DRAF PERSISTEN (§3D.3): versi format + ID pilihan resmi + kunci
 *   semantik disimpan di perangkat (lib/web/draf.ts). Sesudah muat
 *   ulang, entri divalidasi ulang terhadap umpan terbaru di server
 *   (ID, alias lewat kunci semantik, status, waktu mulai) lalu
 *   snapshot ASLI umpan yang dipakai. Penyimpanan tak tersedia →
 *   draf tetap hidup selama tab terbuka + keterangan tampil.
 * - Jam berjalan: begitu sepak mula tiba, penambahan terkunci; pilihan
 *   terpilih dari laga itu ditandai "Kedaluwarsa", dikeluarkan dari
 *   estimasi aktif, dan tetap tampil sampai pengguna menghapusnya.
 * - Batas produk: maksimal 12 pilihan unik.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { GateStatus, GradeMark, Prob, EmptyState } from "../ui";
import {
  MARKET_LABEL,
  int,
  jamWibOnly,
  labelBasisPeluang,
  labelPilihan,
  pct,
  tanggalWib,
} from "../../lib/web/format";
import { combineSlip, sudahMulai, type SlipPick } from "../../lib/web/parlay";
import {
  KUNCI_DRAF,
  kunciSemantikPilihan,
  parseDraf,
  serialDraf,
} from "../../lib/web/draf";
import {
  FILTER_UMPAN_BAWAAN,
  LAGA_PER_HALAMAN,
  kelompokkanPilihan,
  type BuilderPick,
  type FilterUmpan,
  type HalamanUmpan,
} from "../../lib/web/pilihan-umpan";

export type { BuilderPick } from "../../lib/web/pilihan-umpan";

const MAX_PICKS = 12;

/**
 * Keadaan permintaan matriks per paket (lanjut-2) — empat keadaan
 * yang dulu tercampur dalam satu penanda "pernah diminta", sehingga
 * kegagalan sementara mengunci paket selamanya sampai muat ulang:
 * - "memuat": permintaan sedang berjalan (deduplikasi berlaku);
 * - "berhasil": matriks ada di cache — keadaan akhir;
 * - "kosong": server menjawab null (paket memang tanpa matriks) —
 *   keadaan akhir, TIDAK diulang otomatis, tanpa tombol coba-lagi;
 * - "gagal": jaringan/server gagal — dapat diulang lewat interaksi
 *   berikutnya atau tombol "Coba lagi".
 */
type KeadaanMatriks = "memuat" | "berhasil" | "kosong" | "gagal";

type GradeFilter = FilterUmpan["kelas"];
const FILTERS: { id: GradeFilter; label: string }[] = [
  { id: "AB", label: "Kelas A + B" },
  { id: "A", label: "Kelas A saja" },
  { id: "ALL", label: "Semua kelas" },
];

const semKey = (p: BuilderPick) =>
  kunciSemantikPilihan(p.fixtureUid, p.market, p.line, p.selection);

/**
 * Label basis per pilihan (§5): angka terbit + kalimat rinciannya.
 * Label B2.2b dari proyeksi bersama (memakai effective_source, jadi
 * stated-fallback terbaca sebagai peluang model) didahulukan; baris
 * umpan lama tanpa proyeksi jatuh ke aturan basis mentah sebelumnya.
 */
function labelBasisBaris(p: BuilderPick): string {
  if (p.labelBasis) return p.labelBasis;
  if (p.basisTerbit === "effective") return "Peluang saat terbit";
  if (p.basisTerbit === "model") return "Peluang model saat terbit";
  return labelBasisPeluang(p.basisTerbit);
}

/** Kalimat rincian basis (§5) untuk baris ringkasan Pilihanmu. */
function rincianBasis(p: BuilderPick): string | null {
  if (p.keteranganBasis !== undefined) return p.keteranganBasis;
  if (p.basisTerbit === "effective") return "Disesuaikan menggunakan hasil uji historis.";
  if (p.basisTerbit === "model") return "Dihitung dari model skor.";
  return null;
}

/** Ambil satu halaman daftar dari server (saringan atas seluruh umpan). */
async function ambilHalaman(
  filter: FilterUmpan,
  offsetLaga: number,
): Promise<HalamanUmpan> {
  const qs = new URLSearchParams({
    kelas: filter.kelas,
    q: filter.q,
    tanggal: filter.tanggal,
    offset: String(offsetLaga),
    batas: String(LAGA_PER_HALAMAN),
  });
  const res = await fetch(`/api/pilihan?${qs}`);
  if (!res.ok) throw new Error(`daftar pilihan: HTTP ${res.status}`);
  return (await res.json()) as HalamanUmpan;
}

/** Ambil matriks beberapa paket dalam SATU permintaan berkelompok. */
async function ambilMatriksBatch(
  ids: number[],
): Promise<Record<number, number[][] | null>> {
  const res = await fetch(`/api/pilihan/matriks?paket=${ids.join(",")}`);
  if (!res.ok) throw new Error(`matriks: HTTP ${res.status}`);
  const data = (await res.json()) as { matriks: Record<number, number[][] | null> };
  return data.matriks;
}

/**
 * Paket yang matriksnya BENAR-BENAR diperlukan pilihan aktif: hanya
 * laga dengan ≥2 pilihan aktif yang irisannya dihitung dari matriks
 * (combineSlip memakai peluang tersimpan untuk laga satu pilihan) —
 * dan hanya bila SEMUA pilihan grup berasal dari paket yang SAMA
 * (lanjut-1: irisan lintas edisi tidak pernah dihitung, jadi grup
 * beda paket tidak perlu mengambil matriks sama sekali; keputusan
 * ini diketahui dari packageId tiap pilihan, tanpa matriks).
 */
function paketPerluMatriks(picks: BuilderPick[], nowMs: number): number[] {
  const perLaga = new Map<string, BuilderPick[]>();
  for (const p of picks) {
    if (sudahMulai(p.kickoffUtc, nowMs)) continue;
    const arr = perLaga.get(p.fixtureUid);
    if (arr) arr.push(p);
    else perLaga.set(p.fixtureUid, [p]);
  }
  const perlu: number[] = [];
  for (const grup of perLaga.values()) {
    if (grup.length < 2) continue;
    const idEdisi = new Set(grup.map((p) => p.packageId));
    if (idEdisi.size !== 1) continue;
    const [satu] = idEdisi;
    if (satu !== null) perlu.push(satu);
  }
  return [...new Set(perlu)];
}

export default function ParlayBuilder({
  awal,
  totalUmpan,
}: {
  /** Halaman pertama filter bawaan dari server (ringkasan, tanpa matriks). */
  awal: HalamanUmpan;
  /** Ukuran seluruh umpan resmi saat render server (0 = slate kosong). */
  totalUmpan: number;
}) {
  const [filter, setFilter] = useState<GradeFilter>("AB");
  const [q, setQ] = useState("");
  const [tanggal, setTanggal] = useState("");
  // Daftar terakumulasi untuk saringan aktif (halaman-halaman server).
  const [daftar, setDaftar] = useState<BuilderPick[]>(awal.pilihan);
  const [totalPilihan, setTotalPilihan] = useState(awal.totalPilihan);
  const [totalLaga, setTotalLaga] = useState(awal.totalLaga);
  const [memuat, setMemuat] = useState(false);
  const [gagalMuat, setGagalMuat] = useState(false);
  // Parameter saringan yang sedang berlaku + nomor urut permintaan:
  // respons yang datang terlambat untuk saringan lama dibuang.
  const paramsRef = useRef<FilterUmpan>(FILTER_UMPAN_BAWAAN);
  const seqRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cache matriks lazy: id paket → matriks. Hanya ditulis untuk dua
  // keadaan akhir dari server: matriksnya ("berhasil") atau null
  // ("kosong" — paket memang tanpa matriks). Kegagalan TIDAK menulis
  // cache: id tetap absen, jadi combineSlip jatuh ke tidak-tersedia
  // tanpa angka basi.
  const [matriks, setMatriks] = useState<Record<number, number[][] | null>>({});
  // Keadaan permintaan matriks per paket (lanjut-2) + cermin ref-nya
  // untuk pembacaan sinkron di titik pemicu, dan penanda in-flight
  // untuk deduplikasi permintaan yang masih berjalan.
  const [keadaanMatriks, setKeadaanMatriks] = useState<Record<number, KeadaanMatriks>>({});
  const keadaanMatriksRef = useRef<Record<number, KeadaanMatriks>>({});
  const matriksBerjalanRef = useRef<Set<number>>(new Set());

  const tetapkanKeadaan = useCallback((ids: number[], keadaan: KeadaanMatriks) => {
    if (ids.length === 0) return;
    const next = { ...keadaanMatriksRef.current };
    for (const id of ids) next[id] = keadaan;
    keadaanMatriksRef.current = next;
    setKeadaanMatriks(next);
  }, []);
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
  const tulisDraf = useCallback(
    (next: BuilderPick[]) => {
      if (totalUmpan === 0) return;
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
    },
    [totalUmpan],
  );

  // Cermin ref seleksi: dua klik dalam satu tick (klik ganda, atau
  // tambah lewat baris alias) harus membaca seleksi TERKINI, bukan
  // closure render yang basi — semantik updater fungsional, dijaga
  // manual supaya penulisan draf tetap di titik mutasi.
  const selectedRef = useRef<BuilderPick[]>([]);
  // Restore menerapkan seleksi dari respons server (async) — cermin
  // disamakan lagi di effect ini; mutasi pemakai menulis cermin
  // serentak lewat terapkanSeleksi.
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  /**
   * Pastikan matriks paket laga multi-pilihan yang dirujuk seleksi
   * sudah diambil (lazy, berkelompok, dipakai ulang dari cache).
   * State machine per paket (lanjut-2): paket yang sedang "memuat"
   * tidak diminta dua kali (deduplikasi); "berhasil" dan "kosong"
   * adalah keadaan akhir yang tidak pernah diminta ulang otomatis;
   * "gagal" (atau belum pernah diminta) diminta — jadi kegagalan
   * sementara pulih pada interaksi berikutnya, bukan mengunci paket
   * sampai halaman dimuat ulang seperti sebelumnya.
   */
  const pastikanMatriks = useCallback(
    (pilihanAktif: BuilderPick[]) => {
      const perlu = paketPerluMatriks(pilihanAktif, Date.now()).filter((id) => {
        if (matriksBerjalanRef.current.has(id)) return false;
        const k = keadaanMatriksRef.current[id];
        return k !== "berhasil" && k !== "kosong";
      });
      if (perlu.length === 0) return;
      for (const id of perlu) matriksBerjalanRef.current.add(id);
      tetapkanKeadaan(perlu, "memuat");
      ambilMatriksBatch(perlu)
        .then((m) => {
          const berhasil: number[] = [];
          const kosong: number[] = [];
          const tulis: Record<number, number[][] | null> = {};
          for (const id of perlu) {
            const mat = m[id] ?? null;
            tulis[id] = mat;
            if (mat) berhasil.push(id);
            else kosong.push(id);
          }
          setMatriks((cur) => ({ ...cur, ...tulis }));
          tetapkanKeadaan(berhasil, "berhasil");
          tetapkanKeadaan(kosong, "kosong");
        })
        .catch(() => {
          // Kegagalan sementara: cache TIDAK ditulis (matriks tetap
          // absen → combineSlip tidak tersedia, tanpa angka basi) dan
          // penanda berjalan dilepas di finally — keadaan "gagal"
          // dapat diulang.
          tetapkanKeadaan(perlu, "gagal");
        })
        .finally(() => {
          for (const id of perlu) matriksBerjalanRef.current.delete(id);
        });
    },
    [tetapkanKeadaan],
  );

  /** Tombol "Coba lagi": muat ulang matriks yang keadaannya "gagal". */
  const cobaLagiMatriks = useCallback(() => {
    pastikanMatriks(selectedRef.current);
  }, [pastikanMatriks]);

  // Penanda interaksi pemakai: seleksi yang dibangun tangan di tab ini
  // selalu lebih baru daripada draf tersimpan — restore yang datang
  // terlambat tidak boleh menimpanya.
  const interaksiRef = useRef(false);

  function terapkanSeleksi(next: BuilderPick[]) {
    interaksiRef.current = true;
    selectedRef.current = next;
    setSelected(next);
    tulisDraf(next);
    pastikanMatriks(next);
  }

  /* ------------------------------------------------- muat daftar server */

  // Muat satu halaman untuk parameter yang diberikan; respons basi
  // (saringan sudah berganti) dibuang lewat nomor urut.
  const muatHalaman = useCallback(
    (filterBaru: FilterUmpan, offsetLaga: number, mode: "ganti" | "tambah") => {
      const seq = ++seqRef.current;
      setMemuat(true);
      ambilHalaman(filterBaru, offsetLaga)
        .then((hal) => {
          if (seq !== seqRef.current) return;
          setDaftar((cur) => (mode === "ganti" ? hal.pilihan : [...cur, ...hal.pilihan]));
          setTotalPilihan(hal.totalPilihan);
          setTotalLaga(hal.totalLaga);
          setGagalMuat(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setGagalMuat(true);
        })
        .finally(() => {
          if (seq === seqRef.current) setMemuat(false);
        });
    },
    [],
  );

  function perbaruiParams(patch: Partial<FilterUmpan>): FilterUmpan {
    paramsRef.current = { ...paramsRef.current, ...patch };
    return paramsRef.current;
  }

  function gantiKelas(kelas: GradeFilter) {
    setFilter(kelas);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    muatHalaman(perbaruiParams({ kelas }), 0, "ganti");
  }

  function gantiTanggal(v: string) {
    setTanggal(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    muatHalaman(perbaruiParams({ tanggal: v }), 0, "ganti");
  }

  function gantiQ(v: string, segera = false) {
    setQ(v);
    const p = perbaruiParams({ q: v });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (segera) {
      muatHalaman(p, 0, "ganti");
      return;
    }
    // Pencarian berjalan di server atas seluruh umpan — beri jeda
    // ketik singkat supaya tidak setiap ketukan menjadi permintaan.
    debounceRef.current = setTimeout(
      () => muatHalaman(paramsRef.current, 0, "ganti"),
      300,
    );
  }

  // Berhenti total saat komponen lepas: respons yang terlambat dibuang.
  useEffect(
    () => () => {
      seqRef.current++;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Draf tersimpan dibaca sebagai store eksternal: snapshot server
  // null (menyamakan hidrasi); sesudah hidrasi snapshot klien membaca
  // localStorage. Pemulihan divalidasi di SERVER (/api/pilihan/pulih)
  // terhadap umpan terbaru — halaman ini tidak lagi memegang seluruh
  // umpan, jadi pencocokan pick_uid → kunci semantik tidak bisa
  // berjalan lokal. Yang pulih adalah baris umpan terbaru itu sendiri
  // (snapshot resmi saat terbit); draf ditulis ulang tanpa entri yang
  // sudah hilang. Matriks laga terpulih diambil lazy lewat
  // pastikanMatriks, hanya yang diperlukan gabungan.
  const drafMentah = useSyncExternalStore(
    () => () => {},
    () => window.localStorage.getItem(KUNCI_DRAF),
    () => null,
  );
  const pulihRef = useRef(false);
  useEffect(() => {
    if (pulihRef.current || drafMentah === null) return;
    pulihRef.current = true;
    const entri = parseDraf(drafMentah);
    if (!entri || entri.length === 0 || totalUmpan === 0) return;
    let batal = false;
    fetch("/api/pilihan/pulih", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entri }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`pulih draf: HTTP ${r.status}`);
        return r.json() as Promise<{ pilihan: BuilderPick[]; hilang: number }>;
      })
      .then((d) => {
        if (batal || interaksiRef.current) return;
        if (d.pilihan.length > 0) {
          selectedRef.current = d.pilihan;
          setSelected(d.pilihan);
          tulisDraf(d.pilihan);
          pastikanMatriks(d.pilihan);
        }
        setHilang(d.hilang);
      })
      .catch(() => {
        // Validasi gagal (jaringan): draf perangkat TIDAK diubah —
        // pemulihan dicoba lagi pada kunjungan berikutnya.
      });
    return () => {
      batal = true;
    };
  }, [drafMentah, totalUmpan, tulisDraf, pastikanMatriks]);

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

  // Kelompok per laga fisik atas halaman yang terakumulasi (server
  // mengirim kelompok utuh per halaman; pengelompokan di sini hanya
  // menyusun ulang ringkasan yang sudah terfilter di server).
  const groups = useMemo(() => kelompokkanPilihan(daftar), [daftar]);

  const result = useMemo(() => {
    const slip: SlipPick[] = aktif.map((p) => ({
      key: p.key,
      matchId: p.fixtureUid,
      market: p.market,
      selection: p.selection,
      prob: p.prob,
      probBasis: p.probBasis,
      // Identitas edisi dipertahankan sampai penghitung (lanjut-1):
      // combineSlip hanya mengiris grup yang semua pilihannya
      // berbagi packageId ini.
      packageId: p.packageId,
      // Matriks dari cache lazy; belum diambil / tidak ada / gagal →
      // null, dan combineSlip jatuh ke jalur tidak-tersedia (§3D.4).
      matrix: p.packageId !== null ? matriks[p.packageId] ?? null : null,
    }));
    return combineSlip(slip);
  }, [aktif, matriks]);

  const pickByMatch = useMemo(() => {
    const m = new Map<string, BuilderPick>();
    for (const p of aktif) if (!m.has(p.fixtureUid)) m.set(p.fixtureUid, p);
    return m;
  }, [aktif]);

  const full = selected.length >= MAX_PICKS;
  const multiGroups = result.groups.filter((g) => g.count > 1);

  // Paket yang matriksnya sedang dibutuhkan pilihan aktif tetapi
  // permintaannya GAGAL (lanjut-2): panel gabungan membedakan
  // kegagalan ini dari keadaan kosong dan menawari muat ulang
  // eksplisit. "Kosong" (null dari server) TIDAK termasuk — itu
  // keadaan akhir, bukan kegagalan, jadi tidak ada tombol coba-lagi.
  const adaMatriksGagal = useMemo(
    () =>
      paketPerluMatriks(aktif, nowMs).some((id) => keadaanMatriks[id] === "gagal"),
    [aktif, nowMs, keadaanMatriks],
  );

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

  if (totalUmpan === 0) {
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
            {result.combined === null && adaMatriksGagal && (
              <div className="mt-3">
                <p className="text-[13px] leading-relaxed text-brick">
                  Matriks skor gagal dimuat dari server.
                </p>
                <button
                  type="button"
                  onClick={cobaLagiMatriks}
                  className="mt-1 flex min-h-[44px] items-center text-sm font-medium text-accent-deep transition-colors hover:text-ink"
                >
                  Coba lagi
                </button>
              </div>
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
        {/* Kontrol: pencarian, tanggal, filter kelas (§3D.1).
            Brief upgrade P1: pada layar sempit pencarian dan tanggal
            SATU KOLOM eksplisit (bertumpuk), bukan hasil bungkusan
            flex yang tak menentu; sm+ kembali sebaris. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-5 sm:gap-y-3">
          <label className="w-full min-w-0 sm:w-auto sm:min-w-[200px] sm:flex-1">
            <span className="mb-1 block text-[12px] text-faint">Cari tim atau liga</span>
            <span className="flex items-center gap-2">
              <input
                type="search"
                value={q}
                onChange={(e) => gantiQ(e.target.value)}
                placeholder="Cari tim atau liga"
                className="min-h-[44px] w-full rounded-md border border-hairline bg-surface px-3 text-[15px] text-ink"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => gantiQ("", true)}
                  className="flex min-h-[44px] shrink-0 items-center px-1 text-sm text-mid-gray transition-colors hover:text-ink"
                >
                  Hapus pencarian
                </button>
              )}
            </span>
          </label>
          <label className="w-full sm:w-auto">
            <span className="mb-1 block text-[12px] text-faint">Tanggal</span>
            <input
              type="date"
              value={tanggal}
              onChange={(e) => gantiTanggal(e.target.value)}
              className="min-h-[44px] w-full rounded-md border border-hairline bg-surface px-2.5 text-sm text-ink sm:w-auto"
            />
          </label>
        </div>
        <div className="mt-4 mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => gantiKelas(f.id)}
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
            {int(totalPilihan)} pilihan · {int(totalLaga)} laga
          </span>
        </div>

        {gagalMuat && (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-brick" role="alert">
            Daftar gagal dimuat dari server — daftar terakhir tetap ditampilkan.
            Ubah saringan atau pencarian untuk mencoba lagi.
          </p>
        )}

        {hilang > 0 && (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-mid-gray">
            {int(hilang)} pilihan dari draf tersimpan tidak lagi tersedia dan sudah
            dikeluarkan dari draf.
          </p>
        )}

        {groups.length === 0 && !memuat ? (
          <EmptyState
            title="Tidak ada laga yang cocok"
            note="Ubah pencarian, tanggal, atau filter kelas untuk melihat pilihan lain pada slate ini."
          />
        ) : (
          <div>
            {groups.map((group) => {
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
                          className={`border-t border-hairline/50 py-3 ${
                            active ? "bg-surface-alt/50" : ""
                          }`}
                        >
                          {/* Susunan baris brief upgrade P1: pada layar
                              sempit nama pilihan membungkus PENUH di
                              baris pertama (dulu truncate karena berbagi
                              baris dengan persen + tombol — terukur
                              24/40 baris terpotong di 320 px), peluang
                              dan aksi Tambah turun ke baris kedua. Pada
                              sm+ susunan kembali satu baris seperti
                              semula. */}
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className="flex min-w-0 basis-full items-start gap-3 sm:basis-auto sm:flex-1">
                              {/* w-[16px] eksplisit: w-4 pada peta --spacing-*
                                  warisan hanya 4 px — huruf kelas selebar
                                  8 px meluap dari kotaknya (audit P2). */}
                              <GradeMark grade={p.grade} className="w-[16px] shrink-0 pt-px text-center" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[15px] break-words text-ink">{label}</span>
                                <span className="block text-[12px] text-faint">
                                  {MARKET_LABEL[p.market] ?? p.market} · {labelBasisBaris(p)}
                                  {p.publishedAtUtc
                                    ? ` · terbit ${jamWibOnly(p.publishedAtUtc)}`
                                    : ""}
                                  {p.teksPembanding ? ` · ${p.teksPembanding}` : ""}
                                </span>
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
                              className={`ml-auto flex min-h-[44px] shrink-0 items-center px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:ml-0 ${
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
                          </span>
                          {p.konflik && (
                            <span className="mt-1.5 block text-[12px] leading-relaxed text-faint">
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
            {groups.length < totalLaga && (
              <button
                type="button"
                disabled={memuat}
                onClick={() => muatHalaman(paramsRef.current, groups.length, "tambah")}
                className="mt-10 flex min-h-[44px] items-center rounded-md border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:text-accent-deep disabled:cursor-wait disabled:opacity-50"
              >
                {memuat ? "Memuat…" : "Muat 20 laga lagi"}
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
              className="flex min-h-[44px] shrink-0 items-center rounded-md bg-gelap px-4 text-sm font-medium text-tinta transition-colors"
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
