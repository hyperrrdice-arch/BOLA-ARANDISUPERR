# Telemetri Kanonik — Laporan Build (Fase 4)

Dibangun: 2026-11-16T09:35:19.065Z

## Angka

- Baris asal team_match_logs: **88197** (tidak diubah)
- Baris kanonik team_match_logs_canonical: **85782**
- Baris kembar dilebur: **2415**
- Baris tak ter-resolusi ke registry: **0**
- Isi xG dari kembaran (pemenang tak punya xG): **0** baris
- Pemenang per sumber: sportmonks=83356, thestats=334, football-data=2074, master=18

## Contoh konflik skor antar sumber (goals_conflict=1)

- `2025-08-04|sm:8|sm:13258|HOME` — skor tercatat: 4-1×1, 3-2×1
- `2025-08-04|sm:13258|sm:8|AWAY` — skor tercatat: 1-4×1, 2-3×1
- `2026-08-16|sm:8|sm:268|HOME` — skor tercatat: 0-0×1, 2-0×1
- `2026-08-16|sm:268|sm:8|AWAY` — skor tercatat: 0-0×1, 0-2×1
- `2026-07-10|sm:3569|sm:3702|HOME` — skor tercatat: 2-1×1, 1-1×1
- `2026-07-10|sm:3702|sm:3569|AWAY` — skor tercatat: 1-2×1, 1-1×1
- `2025-01-11|sm:2798|sm:6957|HOME` — skor tercatat: 2-2×1, 3-1×1
- `2025-01-11|sm:6957|sm:2798|AWAY` — skor tercatat: 2-2×1, 1-3×1
- `2025-01-12|sm:956|sm:573|HOME` — skor tercatat: 2-1×1, 3-0×1
- `2025-01-12|sm:573|sm:956|AWAY` — skor tercatat: 1-2×1, 0-3×1
- `2025-01-25|sm:132259|sm:6615|HOME` — skor tercatat: 1-2×1, 1-1×1
- `2025-01-25|sm:6615|sm:132259|AWAY` — skor tercatat: 2-1×1, 1-1×1
- `2025-02-28|sm:261166|sm:7220|HOME` — skor tercatat: 2-0×1, 0-5×1
- `2025-02-28|sm:7220|sm:261166|AWAY` — skor tercatat: 0-2×1, 5-0×1
- `2025-02-18|sm:490|sm:2686|HOME` — skor tercatat: 5-0×1, 2-2×1
- `2025-02-18|sm:2686|sm:490|AWAY` — skor tercatat: 0-5×1, 2-2×1
- `2025-02-15|sm:3791|sm:5510|HOME` — skor tercatat: 0-3×1, 0-1×1
- `2025-02-15|sm:5510|sm:3791|AWAY` — skor tercatat: 3-0×1, 1-0×1
- `2026-01-22|sm:349|sm:2727|HOME` — skor tercatat: 0-1×1, 3-3×1
- `2026-01-22|sm:2727|sm:349|AWAY` — skor tercatat: 1-0×1, 3-3×1
- `2026-01-09|sm:12832|sm:15171|HOME` — skor tercatat: 2-0×1, 3-1×1
- `2026-01-09|sm:15171|sm:12832|AWAY` — skor tercatat: 0-2×1, 1-3×1
- `2026-02-07|sm:257125|sm:6637|HOME` — skor tercatat: 2-1×1, 1-0×1
- `2026-02-07|sm:6637|sm:257125|AWAY` — skor tercatat: 1-2×1, 0-1×1
- `2026-02-27|sm:6142|sm:261064|HOME` — skor tercatat: 2-1×1, 3-0×1

Prioritas sumber: sportmonks > football-data > thestats (NULL) > master; di dalam sumber yang sama: xG terisi dulu, lalu kolom terlengkap. Konflik skor tetap dipilih per prioritas dan DITANDAI, tidak disembunyikan.
