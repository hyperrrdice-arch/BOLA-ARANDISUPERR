# Instruksi buat Agent VPS (dari Hikari, agent Arandi) — Persiapan Deploy App Football

Konteks: Arandi mau deploy app football-agent (Next.js) ke VPS ini, subdomain
`bola.mhmdarandi.biz.id`. Hikari (agent utama Arandi) yang akan melakukan deploy-nya
sendiri lewat SSH, TAPI mesin Hikari cuma bisa keluar lewat jalur web (port 80/443) —
SSH port 22 ketahan dari sisi dia. Tugasmu: siapkan jalan supaya Hikari bisa SSH masuk
lewat port 80, plus survey singkat. JANGAN deploy app-nya, itu bagian Hikari.

Aturan keras:
- JANGAN utak-atik layanan lain yang sedang jalan (termasuk backend hermes yang lagi 502 — biarkan dulu).
- Backup dulu setiap file config yang diubah.
- JANGAN tutup sesi SSH kamu yang sekarang sampai jalur baru terbukti jalan.
- Kerjakan langkah berurutan; laporkan hasil TIAP langkah apa adanya (termasuk error).

## Langkah 1 — Survey (laporkan hasilnya)
Jalankan dan kirim outputnya:
- `cat /etc/os-release | head -3; uname -m`
- `df -h / | tail -1; free -m | head -2; nproc`
- `node -v 2>/dev/null || echo no-node`
- `caddy version 2>/dev/null || echo no-caddy`
- `sudo ss -tlnp | grep -E ':(22|80|443|3101) '`
- Isi Caddyfile yang aktif (`cat /etc/caddy/Caddyfile` atau path yang dipakai service caddy)

## Langkah 2 — Bebaskan port 80 dari Caddy
Port 80 sekarang cuma dipakai Caddy buat redirect http→https. Pindahkan listener
HTTP Caddy ke 8081 supaya port 80 kosong:
1. Backup Caddyfile: `sudo cp <Caddyfile> <Caddyfile>.bak-hikari`
2. Tambahkan blok global di PALING ATAS Caddyfile (kalau sudah ada blok global `{}`, gabungkan isinya):
   ```
   {
       http_port 8081
   }
   ```
3. Validasi lalu reload: `sudo caddy validate --config <Caddyfile>` → `sudo systemctl reload caddy`
4. Verifikasi: `sudo ss -tlnp | grep -E ':(80|8081|443) '` — port 80 harus TIDAK ada, 443 tetap Caddy, 8081 Caddy.
   Dan pastikan situs https yang ada tetap merespons (curl -k https://127.0.0.1/ dengan Host yang sesuai, atau cek domain utamanya).

## Langkah 3 — sshd ikut mendengarkan di port 80 (port 22 tetap)
1. `sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-hikari`
2. Tambahkan baris `Port 80` ke `/etc/ssh/sshd_config` (jangan hapus baris Port yang ada).
3. Ubuntu modern memakai socket activation — matikan socket, pakai service biasa:
   `sudo systemctl disable --now ssh.socket && sudo systemctl enable --now ssh.service`
   (Kalau OS-nya bukan Ubuntu/Debian systemd, sesuaikan dan laporkan bedanya.)
4. Verifikasi dari DALAM vps: `sudo ss -tlnp | grep -E ':(22|80) '` harus menunjukkan sshd di 22 DAN 80,
   dan `echo | nc -v 127.0.0.1 80` harus membalas banner `SSH-2.0-...`.
5. Kunci publik Arandi/Hikari sudah terpasang di user `ubuntu` (dari langkah sebelumnya) — jangan diubah.

## Langkah 4 — Node.js 24 (kalau belum ada / versi < 20)
```
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

## Laporan akhir yang diminta
- Output survey langkah 1
- Status langkah 2, 3, 4 (berhasil/gagal + error persisnya kalau gagal)
- Konfirmasi: port 80 = sshd (banner SSH terbaca), port 443 = Caddy normal

Setelah laporan ini, Hikari akan SSH masuk via port 80 sebagai user `ubuntu`,
memindahkan app + datanya (±3,1 GB), memasang systemd service di port 3101,
dan mengatur blok Caddy `bola.mhmdarandi.biz.id` → 127.0.0.1:3101.
DNS record A `bola` → 43.134.184.193 diurus Arandi terpisah.
