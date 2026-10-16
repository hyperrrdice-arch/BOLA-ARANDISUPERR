# Git Push Brief — commit & push perubahan terakhir

> Untuk repo/coding agent yang menangani Git.
> Audit read-only: **16 Oktober 2026**. HEAD saat audit: `fef3bc5` (v1.3.0), branch `main`.
> Remote: `https://github.com/hyperrrdice-arch/BOLA-ARANDISUPERR.git` (origin).
> **Baca bagian BLOKER sebelum `git add` apa pun.** Ada file yang tidak boleh masuk repo.

---

## 1. Tujuan

Push pekerjaan yang belum masuk git: layer telemetry TheStatsAPI, perluasan season historis, rebuild ratings, perbaikan mapping cedera, dan fitur special markets.

Bukan refactor. Bukan perbaikan bug prediksi (itu di task terpisah di `FOUNDATION_REVIEW.md`).

---

## 2. BLOKER — selesaikan sebelum staging

### 2.1 `.gitignore` belum menutup file database binary

`.gitignore:51` hanya menutup `data/football_master.db*`. File berikut **untracked dan tidak ter-ignore**, jadi `git add .` akan memasukkannya:

| File | Ukuran | Masuk repo? |
| --- | --- | --- |
| `data/thestats_dataset.db` | 752 KB | Boleh (dataset kerja), tapi lihat catatan |
| `data/thestats_dataset.db-shm` | 32 KB | **Jangan** |
| `data/thestats_dataset.db-wal` | 0 KB | **Jangan** |
| `data/thestats_dataset.db.bak` | 744 KB | **Jangan** (backup) |
| `data/thestats_dataset.db.bak_1792149069738` | 752 KB | **Jangan** (backup) |
| `data/thestats_raw_vault.db` | 932 KB | Boleh, tapi pertimbangkan |

**Aksi:** tambahkan ke `.gitignore` sebelum staging:

```
data/*.db-shm
data/*.db-wal
data/*.db.bak
data/*.db.bak_*
```

Pola di atas menutup sidecar & backup, tapi **tetap membiarkan** `thestats_dataset.db` dan `thestats_raw_vault.db` masuk — jadi kamu harus memutuskan sadar:

- **Mau DB ikut repo:** pola di atas sudah cukup. Dua file `.db` akan ter-commit.
- **Tidak mau DB ikut repo:** pakai `data/*.db` saja (tutup semua `.db` termasuk `football_master.db` yang sudah ditutup baris 51).

Perhatikan: pola apa pun dengan `*.db` **tidak** menyentuh `data/calibrated_ratings.json` (ekstensi `.json`) dan tidak menyentuh `data/1xbet_leagues.json`. Dua file itu tetap tracked. Aman.

### 2.2 Dua secret hardcoded masih ada di file tracked

Sudah ada di history sejak commit `7b01b48` (initial release). Menghapus dari working tree **tidak** menghapus dari history.

| Lokasi | Isi |
| --- | --- |
| `lib/syndicate-orchestrator.ts:69` | fallback `NINE_ROUTER_API_KEY` |
| `lib/stats-fetcher-agent.ts:34` | fallback `NINE_ROUTER_API_KEY` |
| `lib/1xbet.ts:30` | fallback `RAPIDAPI_1XBET_KEY` |

Nilai `.env.local` yang sama masih dipakai aktif, jadi **jangan** hanya hapus fallback lalu push — kredensial itu sudah bocor dan harus dirotasi dulu.

**Aksi sebelum push:**
1. Rotasi `NINE_ROUTER_API_KEY` dan `RAPIDAPI_1XBET_KEY` (hanya pemilik repo bisa).
2. Ganti fallback jadi throw/`undefined` eksplisit:
   ```ts
   const API_KEY = process.env.NINE_ROUTER_API_KEY;
   if (!API_KEY) throw new Error("NINE_ROUTER_API_KEY belum diset");
   ```
3. Push perubahan. History tetap bocor — kalau mau bersih total, perlu `git filter-repo`/BFG + force-push (keputusan pemilik, **jangan** lakukan sepihak).

### 2.3 `.env.local` ada di mesin, bukan di repo

Sudah benar: `.gitignore:34` (`env files & secrets`) menutup `.env*`, dan `git ls-files` tidak menemukan `.env.local`. Tidak ada aksi.

---

## 3. Kondisi working tree saat audit

### 3.1 Modified (10 file)

```
 M AGENTS.md                            (+1 baris: aturan context hygiene)
 M app/api/agent/route.tsx              (special markets + telemetry injection)
 M data/calibrated_ratings.json         (rebuild: 4731 baris berubah)
 M lib/db/index.ts                      (+2 export)
 M lib/db/sqlite-master.ts              (h_xg/a_xg + UPSERT)
 M lib/quant/index.ts                   (+1 export)
 M lib/quant/ratings-loader.ts          (telemetry fusion)
 M lib/syndicate-orchestrator.ts        (special markets ke prompt)
 M scripts/download-historical-data.mjs (+2 season: 2526, 2627)
 M scripts/ingest-historical-data.ts    (baca kolom HxG/AxG)
```

### 3.2 Untracked yang layak di-commit

- `lib/db/thestats-dataset.ts`, `lib/db/thestats-vault.ts`, `lib/db/team-telemetry.ts`
- `lib/quant/special-markets-engine.ts`
- `scripts/` — `audit-vault-offline.ts`, `backup-db.ts`, `check-columns.ts`, `check-db-summary.ts`, `display-tables.ts`, `fetch-missing-squads.ts`, `fix-injuries-mapping.ts`, `get-all-arsenal.ts`, `get-match-leeds.ts`, `ingest-rich-telemetry-pl.ts`, `ingest-thestats-pl.ts`, `inspect-arsenal-data.ts`, `migrate-schema.ts`, `test-clean-telemetry.ts`, `test-query-telemetry.ts`, `update-scores.js`, `verify-arsenal-passes.ts`, `verify-pl-pipeline.ts`
- `.agents/skills/` — 7 skill dir baru yang untracked (`api-schema-explorer`, `frontend-architect`, `qa-engine`, `quant-auditor`, `repo-manager`, `sports-data-auditor`, `staff-code-reviewer`). Repo sudah punya **46** skill dir tracked dari 53 total, jadi menambah 7 ini konsisten. **Hati-hati:** `git add .agents/skills` akan menambahkan ketujuhnya sekaligus — pastikan tidak ada skill yang belum selesai ikut terbawa.
- `DATABASE_REVIEW_PREMIER_LEAGUE.md` (sudah ada di root, untracked)
- `analisisdeepseek.md` (16 KB, catatan audit)
- `FOUNDATION_REVIEW.md` + `GIT_PUSH_BRIEF.md` (dua file ini)

### 3.3 Untracked yang JANGAN di-commit

File backup & sidecar DB (lihat 2.1): `data/thestats_dataset.db.bak`, `data/thestats_dataset.db.bak_1792149069738`, `data/thestats_dataset.db-shm`, `data/thestats_dataset.db-wal`.

---

## 4. Verifikasi sebelum commit

```bash
# 1. Pastikan tidak ada secret di staged
git diff --staged | findstr /I "api_key apikey secret token sk- c8267e"

# 2. Typecheck
node_modules\.bin\tsc.cmd --noEmit --incremental false

# 3. Acceptance test yang sudah ada (offline, read-only, exit 0)
node_modules\.bin\tsx.cmd scripts/verify-pl-pipeline.ts
```

Hasil yang diharapkan di 16 Okt 2026: `tsc` bersih, `verify-pl-pipeline.ts` cetak `100% PASS`.

---

## 5. Rencana commit (atomic)

Jangan satu commit besar. Pisah berdasarkan concern:

**Commit 1 — chore(git): ignore db binary & backups**
- `.gitignore` (tambah 2.1)

**Commit 2 — fix(security): hapus fallback secret hardcoded**
- `lib/syndicate-orchestrator.ts`, `lib/stats-fetcher-agent.ts`, `lib/1xbet.ts`
- **Hanya setelah rotasi key.** Kalau belum dirotasi, tunda commit ini.

**Commit 3 — feat(db): layer telemetry TheStatsAPI (dataset, vault, team-telemetry)**
- `lib/db/thestats-dataset.ts`, `lib/db/thestats-vault.ts`, `lib/db/team-telemetry.ts`, `lib/db/index.ts`
- `scripts/migrate-schema.ts` (non-destruktif), `scripts/backup-db.ts`

**Commit 4 — feat(db): ingest telemetry PL + perbaikan mapping cedera**
- `scripts/ingest-thestats-pl.ts`, `scripts/ingest-rich-telemetry-pl.ts`, `scripts/fix-injuries-mapping.ts`, `scripts/fetch-missing-squads.ts`, `scripts/update-scores.js`
- Script inspeksi: `check-columns.ts`, `check-db-summary.ts`, `display-tables.ts`, `get-all-arsenal.ts`, `get-match-leeds.ts`, `inspect-arsenal-data.ts`, `test-query-telemetry.ts`, `test-clean-telemetry.ts`, `verify-arsenal-passes.ts`, `audit-vault-offline.ts`

**Commit 5 — feat(data): perluas season historis 2021/22–2026/27**
- `scripts/download-historical-data.mjs`, `scripts/ingest-historical-data.ts`
- `lib/db/sqlite-master.ts` (kolom `h_xg`/`a_xg` + UPSERT)

**Commit 6 — chore(quant): rebuild calibrated ratings**
- `data/calibrated_ratings.json`

**Commit 7 — feat(quant): telemetry fusion + special markets engine**
- `lib/quant/ratings-loader.ts`, `lib/quant/special-markets-engine.ts`, `lib/quant/index.ts`
- `lib/syndicate-orchestrator.ts`, `app/api/agent/route.tsx`

**Commit 8 — test(quant): acceptance test pipeline PL**
- `scripts/verify-pl-pipeline.ts`

**Commit 9 — docs: review database + review fondasi**
- `DATABASE_REVIEW_PREMIER_LEAGUE.md`, `FOUNDATION_REVIEW.md`, `analisisdeepseek.md`, `AGENTS.md`

**Commit 10 — chore(agents): tambah 7 skill dir**
- `.agents/skills/*`

---

## 6. Push

```bash
git push origin main
```

Branch `main`, tidak ada branch lain. Tidak perlu PR kalau repo personal — tapi kalau mau aman, buat branch `release/v1.4.0` dulu lalu PR.

---

## 7. Yang TIDAK termasuk task ini

Jangan sekalian "sambil benerin":

- Bug E0 fallback (`lib/quant/ratings-loader.ts:246`)
- Alias `G1` yang hilang (`lib/quant/ratings-loader.ts:71-119`)
- Bug `sampleN` H2H (`app/api/agent/route.tsx:321-335`)
- Benchmark `aerial_duels_pct_for` yang salah di `special-markets-engine.ts`
- Unifikasi LLM client (3× `createOpenAI` → 1)

Semua itu ada di `FOUNDATION_REVIEW.md` sebagai task terpisah. Mencampurnya bikin commit tidak atomic dan tidak bisa di-revert sendiri.

---

## 8. Catatan versi

`package.json` masih `1.3.0`. Kalau commit ini dianggap rilis, bump ke `1.4.0` (MINOR: ada fitur baru, tidak ada breaking change yang disengaja) dan tag:

```bash
git tag -a v1.4.0 -m "Release 1.4.0 — TheStatsAPI telemetry layer, ratings rebuild, special markets"
git push origin v1.4.0
```

Tapi ada perubahan perilaku tersembunyi yang perlu dicatat di changelog (lihat `FOUNDATION_REVIEW.md` §3.4 semantik defense, §3.5 flag estimasi, §4.4 arti return UPSERT). Kalau ragu, tahan di `1.3.1` sampai bug prediksi dibereskan.
