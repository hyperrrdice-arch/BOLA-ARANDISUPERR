# Direktori Dataset Historis Sepak Bola

Tempatkan file dataset historis (CSV atau JSON) di dalam direktori ini (`data/historical/`).

## Format yang Direkomendasikan (CSV)
Contoh sumber data gratis: [Football-Data.co.uk](https://www.football-data.co.uk/)

### Konvensi Penamaan File:
- `EPL_2022_2023.csv`, `EPL_2023_2024.csv`, `EPL_2024_2025.csv`
- `LaLiga_2023_2024.csv`, `LaLiga_2024_2025.csv`
- `SerieA_2023_2024.csv`, `SerieA_2024_2025.csv`
- `Bundesliga_2023_2024.csv`, `Bundesliga_2024_2025.csv`
- `Ligue1_2023_2024.csv`, `Ligue1_2024_2025.csv`

### Kolom Penting:
- **Wajib**: `Date`, `HomeTeam`, `AwayTeam`, `FTHG` (Full Time Home Goals), `FTAG` (Full Time Away Goals), `FTR` (Full Time Result: H/D/A)
- **Sangat Disarankan**: 
  - `HTHG`, `HTAG` (Half Time Goals)
  - `HS`, `AS` (Home/Away Shots)
  - `HST`, `AST` (Home/Away Shots on Target)
  - `PSH`, `PSD`, `PSA` (Pinnacle Closing Odds 1X2 untuk validasi vig-stripping)
  - `B365H`, `B365D`, `B365A` (Bet365 Odds 1X2)
  - `Referee` (Nama Wasit)
