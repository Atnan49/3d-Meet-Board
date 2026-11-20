# Ruang Kolaborasi 3D untuk Discord

Aplikasi kolaborasi ruang rapat 3D open-source berbasis **Three.js + Discord Embedded App SDK + Express/WebSocket** menggunakan model ruangan 3D hasil ekspor Blender (`public/models/room.glb`).

Fitur utama:
- **Ruangan 3D interaktif:** Zoom in, zoom out, dan putar kamera atau pakai tombol cepat (`Ruangan`, `Papan Kanan`, `Papan Kiri`).
- **Kursor 3D real-time:** Anggota yang bergabung di ruangan yang sama langsung melihat posisi kursor dan nama rekan mereka.
- **Papan kiri otomatis (Daftar Anggota):** Menampilkan anggota yang sedang aktif di ruangan, dan mendukung pengambilan seluruh anggota server bila `DISCORD_BOT_TOKEN` diisi.
- **Papan kanan (Sticky Note, Foto, & Benang Penghubung):** Tambah, geser, edit, unggah foto, dan tarik benang merah/emas antar catatan. Semua perubahan tersimpan otomatis di `data/rooms/`.

---

## 1. Uji Coba Cepat di Browser Lokal (Tanpa Discord)

Cocok untuk mencoba ruangan 3D, sinkronisasi multi-tab, dan papan catatan langsung dari CMD/terminal laptop Anda:

```bat
git clone https://github.com/Atnan49/3d-Meet-Board.git
cd 3d-Meet-Board
npm install
npm run build
npm start
```

Buka `http://localhost:3000` di dua tab browser berbeda (atau klik tombol **Ubah Nama** di pojok kiri atas untuk membedakan user). Kursor, sticky note, foto, dan benang penghubung akan langsung tersinkron secara real-time.

---

## 2. Menghubungkan dan Memakai di Server Discord Anda (Laptop sebagai Server)

Agar teman organisasi Anda bisa membuka aplikasi ini langsung di dalam server Discord:

### Langkah A: Siapkan Aplikasi di Discord Developer Portal
1. Buka [Discord Developer Portal](https://discord.com/developers/applications) lalu klik **New Application**.
2. Buka menu **OAuth2**, salin **Client ID** dan buat/salin **Client Secret**.
3. Masih di menu **OAuth2 -> Redirects**, tambahkan `https://127.0.0.1` (atau URL tunnel Anda nanti).
4. Buka menu **Activities -> Settings**, nyalakan **Enable Activities** dan atur **Supported Platforms** (Desktop/Web).
5. Buka menu **Activities -> URL Mappings**, pastikan root `/` diarahkan ke URL HTTPS server Anda (lihat Langkah C).

### Langkah B: Isi File `.env`
Salin `.env.example` menjadi `.env`:

```bat
copy .env.example .env
```

Isi dengan kredensial dari Langkah A:

```env
PORT=3000
DISCORD_CLIENT_ID=isi_client_id_anda
DISCORD_CLIENT_SECRET=isi_client_secret_anda
# Opsional: isi jika ingin papan kiri memuat semua anggota server (aktifkan Server Members Intent di tab Bot)
DISCORD_BOT_TOKEN=
```

Lalu build ulang dan jalankan server:

```bat
npm run build
npm start
```

### Langkah C: Sambungkan Laptop ke Internet lewat Tunnel HTTPS Gratis
Discord Activity mewajibkan alamat **HTTPS** yang bisa diakses dari luar. Gunakan salah satu tunnel berikut di jendela terminal terpisah sementara `npm start` tetap berjalan:

- Memakai **Cloudflare Quick Tunnel** (gratis tanpa akun):
  ```bat
  cloudflared tunnel --url http://localhost:3000
  ```
- Atau memakai **ngrok**:
  ```bat
  ngrok http 3000
  ```

Salin alamat `https://...` yang muncul dari tunnel, tempelkan ke **Activities -> URL Mappings (`/`)** di Discord Developer Portal, lalu masuk ke Voice Channel atau Text Channel di server Discord Anda dan jalankan Activity tersebut.

---

## Catatan Pengembang & Testing

- Jalankan test validasi dan penyimpanan backend:
  ```bat
  npm test
  ```
- Mode pengembangan live reload (jalankan di 2 terminal):
  ```bat
  npm run dev:server
  npm run dev:client
  ```
