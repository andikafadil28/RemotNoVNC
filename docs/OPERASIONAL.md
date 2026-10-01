# Panduan Operasional Remote RS

Versi: 1.0
Platform: Ubuntu, Docker Compose, Caddy, React, Fastify, noVNC, TightVNC

## 1. Tujuan

Remote RS menyediakan dashboard web untuk memantau dan mengendalikan komputer Windows yang sudah menjalankan TightVNC Server. Endpoint Windows tidak memerlukan agent baru.

Arsitektur:

```text
Browser IT LAN/VPN
  -> HTTPS/WSS TCP 8443
  -> Caddy + dashboard React
  -> Fastify WebSocket gateway
  -> TightVNC endpoint TCP 5900
```

Stack Docker Remote RS terisolasi dari aplikasi lain. Stack hanya mempublikasikan TCP 8443. API TCP 3000 hanya tersedia di network Docker internal.

## 2. Batasan POC

- Inventory, user, dan audit disimpan sebagai JSON pada Docker volume `remote-rs_remote-rs-data`.
- Maksimal 16 koneksi VNC aktif per halaman.
- Grid mendukung 2 sampai 5 kolom.
- Grid normal bersifat view-only. Kontrol mouse dan keyboard aktif hanya saat fullscreen.
- Password VNC dimasukkan manual dan hanya berada di memori browser selama sesi.
- File transfer, terminal, monitoring CPU/RAM/disk, dan alert tidak termasuk scope.
- Sebelum rollout besar, migrasikan penyimpanan ke PostgreSQL dan lakukan load test.

## 3. Prasyarat Server

- Ubuntu dengan Docker Engine dan Docker Compose.
- Git tersedia.
- TCP 8443 belum dipakai aplikasi lain.
- Server dapat mengakses endpoint TightVNC pada TCP 5900.
- Client IT dapat mengakses server pada TCP 8443 melalui LAN atau VPN.
- Repository: `https://github.com/andikafadil28/RemotNoVNC.git`.

Verifikasi:

```bash
docker --version
docker compose version
sudo ss -ltnp 'sport = :8443'
```

## 4. Instalasi Awal

Clone ke home user deployment:

```bash
git clone https://github.com/andikafadil28/RemotNoVNC.git ~/remote-rs
cd ~/remote-rs
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

Isi konfigurasi dengan hostname atau IP server dan password admin unik:

```env
REMOTE_RS_HOST=<hostname-atau-ip-server>
ADMIN_USERNAME=<username-admin>
ADMIN_PASSWORD=<password-unik-minimal-10-karakter>
```

Jangan commit, screenshot, atau kirim isi `deploy/.env` melalui chat.

Deploy:

```bash
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

Status service `api` dan `web` harus `Up`.

## 5. Firewall

Buka TCP 8443 hanya untuk subnet admin yang disetujui. Contoh LAN `/24`:

```bash
sudo ufw allow from <subnet-admin>/24 to any port 8443 proto tcp
sudo ufw status verbose
```

Jangan membuka TCP 5900 server dashboard ke internet. Pada endpoint Windows, izinkan TCP 5900 hanya dari IP server dashboard.

## 6. HTTPS dan Sertifikat

Caddy membuat CA internal untuk POC. Export root certificate:

```bash
cd ~/remote-rs
docker cp remote-rs-web-1:/data/caddy/pki/authorities/local/root.crt ./remote-rs-root.crt
chmod 600 remote-rs-root.crt
```

Transfer certificate ke PC teknisi melalui kanal internal:

```powershell
scp user@<server>:~/remote-rs/remote-rs-root.crt "$env:USERPROFILE\Downloads\"
```

Import untuk user Windows:

```powershell
certutil -user -addstore Root "$env:USERPROFILE\Downloads\remote-rs-root.crt"
```

Alternatif GUI: buka certificate, pilih `Install Certificate`, `Current User`, lalu `Trusted Root Certification Authorities`.

Jangan gunakan HTTP. Dashboard membawa kredensial, tampilan desktop, keyboard, mouse, clipboard, dan kemungkinan data pasien.

## 7. Akses Dashboard

Buka:

```text
https://<hostname-atau-ip-server>:8443
```

Login memakai akun bootstrap dari `deploy/.env`. Setelah user tersimpan pada volume data, perubahan environment tidak otomatis mengganti password user tersebut.

Admin dapat:

- Scan kandidat VNC.
- Menambah, mengubah, dan menghapus endpoint.
- Membuat akun admin atau teknisi.
- Melihat audit terbaru.

Teknisi dapat:

- Melihat status endpoint.
- Membuka remote desktop.
- Mengontrol endpoint saat tile masuk fullscreen.

## 8. Inventory dan Scan

Dashboard mendukung scan subnet yang sudah diizinkan backend. Scan hanya memeriksa banner RFB pada TCP 5900. Hasil scan bukan bukti kesehatan PC secara keseluruhan.

Saat menambah endpoint, isi:

- Nama PC.
- Group/unit.
- Lokasi.
- IP privat.

Inventory production tidak disimpan di repository public. Tambahkan endpoint melalui dashboard setelah deployment.

## 9. Remote Desktop

1. Pilih group.
2. Masukkan password VNC pada tile.
3. Tile normal hanya untuk pantau.
4. Klik `Fullscreen` untuk mengaktifkan kontrol mouse dan keyboard.
5. Tekan `Esc` untuk keluar dan kembali ke mode pantau.
6. Klik `Reconnect` jika sesi terputus.

Token remote bersifat sekali pakai, terikat session user, dan kedaluwarsa dalam waktu singkat.

## 10. Operasi Harian

Cek service:

```bash
cd ~/remote-rs
docker compose -f deploy/compose.yaml ps
```

Lihat log:

```bash
docker compose -f deploy/compose.yaml logs --tail=100
docker compose -f deploy/compose.yaml logs -f api
docker compose -f deploy/compose.yaml logs -f web
```

Restart stack:

```bash
docker compose -f deploy/compose.yaml restart
```

Stop dan start:

```bash
docker compose -f deploy/compose.yaml stop
docker compose -f deploy/compose.yaml start
```

Container memakai `restart: unless-stopped`. Setelah reboot server atau Docker restart, container otomatis aktif kecuali sebelumnya dihentikan manual.

Pastikan Docker auto-start:

```bash
sudo systemctl enable --now docker
systemctl is-enabled docker
```

## 11. Update Aplikasi

Backup sebelum update. Setelah backup:

```bash
cd ~/remote-rs
git pull --ff-only
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

Verifikasi login, status VNC, remote desktop, fullscreen control, reconnect, dan audit setelah update.

## 12. Backup

Buat folder backup:

```bash
mkdir -p ~/remote-rs-backup
```

Backup volume data JSON:

```bash
docker run --rm \
  -v remote-rs_remote-rs-data:/data:ro \
  -v ~/remote-rs-backup:/backup \
  alpine sh -c 'tar czf /backup/remote-rs-data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
```

Backup konfigurasi lokal:

```bash
cp ~/remote-rs/deploy/.env ~/remote-rs-backup/deploy.env.backup
chmod 600 ~/remote-rs-backup/deploy.env.backup
```

Simpan backup terenkripsi di lokasi terpisah. Uji restore secara berkala.

## 13. Restore

**Peringatan:** restore mengganti data aktif. Pastikan file backup benar dan stack sudah dihentikan.

```bash
cd ~/remote-rs
docker compose -f deploy/compose.yaml stop api
docker run --rm \
  -v remote-rs_remote-rs-data:/data \
  -v ~/remote-rs-backup:/backup \
  alpine sh -c 'rm -rf /data/* && tar xzf /backup/<nama-backup>.tar.gz -C /data'
docker compose -f deploy/compose.yaml start api
```

Verifikasi login, inventory, dan audit setelah restore.

## 14. Troubleshooting

### Dashboard tidak dapat dibuka

```bash
docker compose -f deploy/compose.yaml ps
sudo ss -ltnp 'sport = :8443'
sudo ufw status verbose
docker compose -f deploy/compose.yaml logs --tail=100 web
```

### Login gagal atau respons kosong

```bash
docker compose -f deploy/compose.yaml logs --tail=100 api
docker compose -f deploy/compose.yaml exec web wget -S -O- http://api:3000/api/auth/session
```

Respons `401 Unauthorized` dari tes session berarti API hidup dan meminta login.

### Tile menunjukkan Unknown

- Cek container API.
- Cek endpoint TCP 5900 dari server.
- Pastikan firewall Windows endpoint mengizinkan IP server dashboard.
- Jangan membuka TCP 5900 ke seluruh LAN atau internet.

### Remote terputus

- Klik `Reconnect`.
- Cek audit `remote.failed`, `remote.closed.client`, atau `remote.closed.endpoint`.
- Cek service TightVNC endpoint.
- Cek kehilangan paket dan firewall jaringan.

### Container web Restarting

```bash
docker compose -f deploy/compose.yaml logs --tail=100 web
```

Periksa syntax Caddy dan nilai `REMOTE_RS_HOST`, lalu rebuild.

## 15. Security Checklist

- Gunakan akun personal, bukan akun bersama.
- Gunakan password unik dan ganti jika pernah terekspos.
- Batasi TCP 8443 ke LAN admin atau VPN.
- Batasi TCP 5900 endpoint hanya dari server dashboard.
- Jangan publish `.env`, inventory, audit, atau data user ke GitHub.
- Jangan abaikan warning certificate browser.
- Review audit rutin.
- Backup sebelum update besar.
- Gunakan MFA dan PostgreSQL sebelum rollout production luas.
- Buat SOP karena remote desktop dapat menampilkan data pasien.

## 16. Kontak dan Eskalasi

Saat insiden, catat:

- Waktu kejadian.
- Username teknisi.
- Endpoint target.
- Action audit terakhir.
- Status container.
- Potongan log yang relevan tanpa password atau data pasien.

Hindari mengirim screenshot desktop pasien melalui kanal publik.
