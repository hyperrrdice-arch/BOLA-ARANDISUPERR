@echo off
rem Sweep coverage TheStatsAPI — dipanggil scheduled task (lihat tasks/plan-data-coverage.md).
rem Idempoten: vault dedupe + skip baris yang sudah ada. Aman dijalankan berkali-kali.
cd /d "%~dp0.."
echo ==== sweep %date% %time% ==== >> data\sweep.log
npx.cmd tsx scripts/prepull-match-odds.ts >> data\sweep.log 2>&1
npx.cmd tsx scripts/promote-upcoming-to-telemetry.ts >> data\sweep.log 2>&1
