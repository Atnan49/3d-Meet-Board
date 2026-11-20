# Ruang Kolaborasi 3D untuk Discord (`3d-meet-board`)

Aplikasi kolaborasi ruang rapat 3D open-source berbasis **Three.js + Discord Embedded App SDK + Express/WebSocket** menggunakan model ruangan 3D hasil ekspor Blender (`public/models/room.glb`).

Laptop Anda otomatis menjadi server lokal sekaligus terhubung ke Discord lewat tunnel HTTPS Cloudflare gratis (tanpa perlu sewa VPS/DigitalOcean).

Fitur utama:
- **Ruangan 3D interaktif:** Zoom in, zoom out, dan putar kamera atau pakai tombol cepat (`Ruangan`, `Papan Kanan`, `Papan Kiri`).
- **Kursor 3D real-time:** Anggota yang bergabung di ruangan yang sama langsung melihat posisi kursor dan nama rekan mereka.
- **Papan kiri otomatis (Daftar Anggota):** Menampilkan anggota yang sedang aktif di ruangan, dan mendukung pengambilan seluruh anggota server bila `DISCORD_BOT_TOKEN` diisi.
- **Papan kanan (Sticky Note, Foto, & Benang Penghubung):** Tambah, geser, edit, unggah foto, dan tarik benang merah/emas antar catatan. Semua perubahan tersimpan otomatis di `~/.3d-meet-board/rooms/` (atau `data/rooms/` saat dijalankan dari repo).

---

## 1. Cara Install Global via Terminal (Direkomendasikan)

Cukup jalankan perintah berikut di CMD / Terminal (membutuhkan Node.js 18+):

```bat
npm install -g https://github.com/Atnan49/3d-Meet-Board/archive/refs/heads/main.tar.gz
```

> Catatan: Gunakan URL `.tar.gz` langsung agar terhindar dari bug symlink/junction sementara pada `github:` di Windows npm 10 (sampai paket ini dipublikasikan ke registry npm sebagai `npm install -g 3d-meet-board`).

Lalu jalankan wizard setup Discord satu kali:

```bat
3d-meet-board setup
```

Wizard tersebut akan membuka [Discord Developer Portal](https://discord.com/developers/applications) dan memandu Anda mengisi:
- `DISCORD_CLIENT_ID` dan `DISCORD_CLIENT_SECRET` (dari menu **OAuth2** di aplikasi Discord Anda; kosongkan jika hanya ingin pratinjau lokal dulu).
- `DISCORD_BOT_TOKEN` (opsional, jika ingin papan kiri memuat seluruh anggota server; aktifkan **Server Members Intent** di menu **Bot**).

Setelah itu, jalankan server + tunnel HTTPS otomatis dengan satu perintah:

```bat
3d-meet-board
```

Perintah `3d-meet-board` akan menampilkan:
1. **URL Lokal** (`http://localhost:3000`) untuk uji coba langsung di browser.
2. **URL HTTPS Tunnel** (`https://...trycloudflare.com`) otomatis dari Cloudflare.

Salin **URL HTTPS Tunnel** tersebut ke **Activities -> URL Mappings (`/`)** di Discord Developer Portal (dan pastikan **Activities -> Enable Activities** aktif, serta **OAuth2 -> Redirects** berisi `https://127.0.0.1`). Setelah itu Anda tinggal masuk ke Voice/Text Channel server Discord Anda dan buka Activity-nya.

*(Catatan batas platform Discord: Discord mewajibkan pembuatan Application, Client Secret, serta pengaturan URL Mapping dilakukan lewat login akun Anda di Discord Developer Portal sekali saja.)*

### Perintah CLI Tersedia

- `3d-meet-board` / `3d-meet-board start` : Jalankan server lokal dan tunnel HTTPS otomatis.
- `3d-meet-board start --no-tunnel` : Jalankan secara lokal saja tanpa tunnel Cloudflare.
- `3d-meet-board start --port 3500` : Jalankan di port tertentu.
- `3d-meet-board setup` : Jalankan ulang wizard konfigurasi kredensial Discord.
- `3d-meet-board status` : Cek lokasi berkas konfigurasi (`~/.3d-meet-board/config.env`), folder data papan, dan link portal/undang bot.

---

## 2. Mode Pengembang (Clone dari Repository)

Jika Anda ingin memodifikasi kode sumber atau menjalankan test:

```bat
git clone https://github.com/Atnan49/3d-Meet-Board.git
cd 3d-Meet-Board
npm install
npm test
npm run build
npm start
```

Untuk pengembangan dengan live reload (jalankan di 2 terminal):

```bat
npm run dev:server
npm run dev:client
```
