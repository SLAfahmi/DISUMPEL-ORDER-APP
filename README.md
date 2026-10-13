# disumpel — Web Pre-Order (Vercel + Google Drive)

Website pre-order **disumpel · Dimsum & Jelly Splash** yang di-hosting di **Vercel**. Desain mengikuti folder `REFERENSI/` (DESIGN.md, code.html, screen.png): kontainer mobile, kartu menu yang bisa digeser, dan lengkung oranye berisi ringkasan pesanan. Setiap pesanan otomatis:

1. tercatat sebagai satu baris di **Google Sheet "Rekap Pesanan disumpel"** (dengan kolom status yang bisa diubah dari HP), dan
2. dibuatkan **Google Doc detail pesanan** di folder Drive `Pesanan disumpel/<tanggal>/`.

Buka/tutup PO, stok "habis", dan kuota porsi per batch diatur langsung dari tab **Pengaturan** di spreadsheet yang sama, tanpa perlu deploy ulang.

```
Pembeli (browser)
   │  GET /api/menu, POST /api/order
   ▼
Vercel Function  ── validasi data & hitung ulang harga dari lib/config.js
   │  POST + ORDER_SECRET
   ▼
Google Apps Script (Web App, berjalan sebagai akun Google kamu)
   ├─▶ Google Sheet  "Rekap Pesanan disumpel"
   │      ├─ Pesanan    : 1 baris / pesanan
   │      ├─ Pengaturan : PO buka/tutup, jadwal, stok & kuota  (dibaca website)
   │      └─ Rekap      : jumlah pesanan, omzet, porsi per menu per jadwal
   └─▶ Google Doc    "ORD-261011-001 - Nama"  di Drive/Pesanan disumpel/2026-10-11/
```

## Struktur folder

| Path | Isi |
| --- | --- |
| `public/` | Tampilan web (HTML, CSS, JS). Tanpa framework, tanpa build. |
| `public/images/` | Logo & foto menu (diambil dari referensi, disimpan lokal). |
| `api/menu.js` | `GET /api/menu`: data toko, menu, tipe pesanan, metode bayar, ditambah status PO & stok dari spreadsheet. |
| `api/order.js` | `POST /api/order`: validasi pesanan lalu kirim ke Apps Script. |
| `lib/config.js` | **Ubah di sini**: nama toko, menu, harga, ongkir, nomor WhatsApp, info pembayaran. |
| `lib/gas.js` | Pemanggil Apps Script yang dipakai kedua fungsi di atas. |
| `google-apps-script/Code.gs` | Kode yang di-paste ke Google Apps Script. |
| `scripts/dev.mjs` | Server lokal untuk uji coba (`npm run dev`). |
| `REFERENSI/` | Acuan desain. Tidak ikut ter-deploy (lihat `.vercelignore`). |

---

## Langkah 1: Hubungkan ke Google Drive (Apps Script)

1. Buka <https://script.google.com> lalu klik **New project**. Beri nama, misalnya `disumpel Order`.
2. Hapus isi `Code.gs`, lalu **paste seluruh isi** `google-apps-script/Code.gs`. Klik 💾 Save.
3. (Disarankan) Klik ⚙️ **Project Settings**, centang **Show "appsscript.json"**, lalu ganti isinya dengan `google-apps-script/appsscript.json` (zona waktu Asia/Jakarta).
4. Di toolbar, pilih fungsi **`setup`** lalu klik **Run**.
   - Muncul *Authorization required*: klik **Review permissions**, pilih akun Google.
   - Jika muncul *Google hasn't verified this app*: klik **Advanced** → **Go to disumpel Order (unsafe)** → **Allow**.
     (Ini normal untuk skrip buatan sendiri, karena skrip berjalan di akun kamu sendiri.)
5. Buka **Execution log** dan catat:
   - link **Folder Drive** & **Spreadsheet** yang baru dibuat
   - **`ORDER_SECRET`** (kode rahasia, dipakai di Vercel)
6. Klik **Deploy** → **New deployment** → ⚙️ *Select type* → **Web app**:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Klik **Deploy**, lalu salin **Web app URL** (berakhiran `/exec`).
7. Cek: buka URL tersebut di browser. Harus tampil `{"ok":true,"service":"order-makanan","ready":true}`.

> ⚠️ Setiap kali `Code.gs` diubah, buka **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
> Tanpa langkah ini, Web App tetap memakai versi lama. URL-nya tidak berubah.

### Sudah pernah setup versi sebelumnya?

Versi ini menambah tab **Pengaturan** dan **Rekap**, serta kolom **Jadwal** dan kolom per menu di tab Pesanan. Data pesanan lama tetap aman.

1. Ganti seluruh isi `Code.gs` di Apps Script dengan versi baru, lalu Save.
2. Jalankan **`setup`** sekali lagi. `ORDER_SECRET` tetap sama, jadi Vercel tidak perlu diubah.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
4. Deploy ulang website (push ke GitHub atau `npx vercel --prod`).
5. Buka website sekali. Daftar menu otomatis muncul di tab Pengaturan.

## Langkah 2: Coba di komputer (opsional)

Butuh Node.js 20.12 atau lebih baru.

```bash
cd "D:\BACKUP FAHMI\KULIAH\KULIAH semester 7\KWU\MOBILE WEB ORDER"
npm run dev
```

Buka <http://localhost:3000>.

- Tanpa `.env.local`, pesanan **disimulasikan** dan hanya dicetak di terminal, cocok untuk mencoba tampilan. Dalam mode ini PO selalu buka dan semua menu tanpa kuota.
- Untuk menyimpan ke Google Drive sungguhan, salin `.env.example` menjadi `.env.local` lalu isi `GAS_WEBHOOK_URL` dan `ORDER_SECRET`.

## Langkah 3: Deploy ke Vercel

### Opsi A: lewat GitHub (paling mudah)

1. Upload folder ini ke repository GitHub (file `.env.local` otomatis tidak ikut karena ada di `.gitignore`).
2. Buka <https://vercel.com/new>, lalu **Import** repository tersebut. Framework Preset: **Other**.
3. Buka **Environment Variables** lalu tambahkan:
   - `GAS_WEBHOOK_URL` = URL `/exec` dari langkah 1.6
   - `ORDER_SECRET` = secret dari langkah 1.5
4. Klik **Deploy**. Selesai, website online di `https://<nama-proyek>.vercel.app`.

### Opsi B: lewat Vercel CLI

```bash
npx vercel login
npx vercel link
npx vercel env add GAS_WEBHOOK_URL production
npx vercel env add ORDER_SECRET production
npx vercel --prod
```

> Jika Environment Variables diubah setelah deploy, lakukan **Redeploy** agar nilainya terpakai.

---

## Mengubah menu & toko

Semua ada di `lib/config.js`:

- `STORE`: nama, logo, judul & subjudul di lengkung oranye, daftar keunggulan, **nomor WhatsApp** (format `62…`), minimal order.
  - `isOpen: false` adalah saklar utama: PO tertutup apa pun isi spreadsheet. Untuk buka/tutup sehari-hari, cukup pakai tab Pengaturan (lihat di bawah).
- `ORDER_TYPES`: Ambil Sendiri / Diantar, beserta ongkir (`fee`) dan keterangan (`hint`).
- `PAYMENT_METHODS`: metode bayar & instruksinya (mis. nomor rekening).
- `MENU`: daftar menu. Tiap item punya `id` unik, `name`, `category`, `price`, `description`, dan `image` (foto di `public/images/`, tampil bulat).
  - Tanpa `image`, `emoji` dipakai sebagai gantinya.
  - `badge: { text: "Best Seller", tone: "red" }` menampilkan label di pojok kartu (tone: `red`, `amber`, `green`, `orange`).
  - `priceLabel` mengganti tulisan "Harga" (mis. "Harga Hemat").
  - `available: false` menampilkan label "Habis" (tidak bisa dipesan).

Harga selalu dihitung ulang di server dari file ini, jadi pembeli tidak bisa mengubah harga lewat browser.
Setelah mengubah, push ke GitHub (atau `npx vercel --prod`) agar website ter-update.
Menu baru otomatis mendapat baris di tab Pengaturan dan kolom di tab Pesanan & Rekap begitu website dibuka.

## Mengatur PO dari spreadsheet (tanpa deploy)

Buka tab **Pengaturan** di spreadsheet. Bisa diubah lewat aplikasi Google Sheets di HP. Perubahan tampil di website dalam ±30 detik, sedangkan pesanan yang masuk selalu dicek dengan isi terbaru.

| Isian | Fungsi |
| --- | --- |
| **PO Dibuka** | Centang = pembeli bisa memesan. Hapus centang = **PRE-ORDER DITUTUP**. |
| **Tutup Otomatis** | Opsional. Isi tanggal & jam; setelah lewat, PO tertutup sendiri. Website menampilkan "PO tutup …". |
| **Jadwal Ambil/Kirim** | Teks bebas, mis. `Sabtu, 18 Okt (15.00–18.00)`. Tampil di website, dicatat di kolom **Jadwal** tiap pesanan. |

Tabel menu di bawahnya:

| Kolom | Fungsi |
| --- | --- |
| **Tersedia** | Hapus centang bila menu sedang habis / tidak dijual. |
| **Kuota per Jadwal** | Maksimal porsi untuk satu jadwal, mis. `50`. Kosongkan bila tanpa batas. Website menampilkan "Sisa N" dan otomatis "Habis" saat kuota terpenuhi. |
| **Terpesan** / **Sisa** | Dihitung otomatis dari tab Pesanan. Pesanan **Dibatalkan** tidak dihitung, jadi kuotanya kembali. |

**Memulai batch baru:** ganti teks **Jadwal Ambil/Kirim**. Kuota otomatis dihitung dari 0 lagi untuk jadwal baru, sedangkan pesanan jadwal lama tetap tersimpan.

## Rekap produksi & omzet

Tab **Rekap** dihitung otomatis: satu baris per jadwal berisi jumlah pesanan, omzet (total termasuk ongkir), dan **jumlah porsi tiap menu**, yaitu daftar yang harus diproduksi untuk batch itu. Pesanan Dibatalkan tidak dihitung. Kolom **Terpesan** di tab Pengaturan menampilkan angka yang sama untuk jadwal yang sedang aktif.

## Mengelola pesanan

- Buka spreadsheet **Rekap Pesanan disumpel**. Pesanan baru berstatus **Baru** (disorot kuning).
- Ubah kolom **Status** lewat dropdown: Baru → Diproses → Dikirim → Selesai / Dibatalkan.
- Klik nomor di kolom **WhatsApp** untuk langsung chat pembeli, dan **Buka** di kolom **Detail** untuk melihat Google Doc pesanan.
- Setelah memesan, pembeli juga bisa menekan **Kirim Konfirmasi via WhatsApp**, yang mengirim ringkasan pesanan ke nomor toko.
- Kolom setelah **Jadwal** berisi jumlah porsi per menu. Pesanan yang masuk lewat WA bisa dicatat manual sebagai baris baru. Isi **Jadwal** dan jumlah porsinya, maka kuota & rekap ikut menghitungnya.
- ⚠️ Boleh menyortir atau memfilter tab Pesanan, tapi **jangan menyisipkan, menghapus, atau memindah kolom**, karena skrip menulis data berdasarkan posisi kolom.

## Keamanan

- `ORDER_SECRET` dan URL Apps Script hanya disimpan di server (Vercel Environment Variables), tidak pernah dikirim ke browser.
- Apps Script menolak permintaan tanpa secret yang benar.
- Teks dari pembeli yang diawali `=`, `+`, `-`, atau `@` disimpan sebagai teks biasa, bukan rumus spreadsheet.
- Ada *honeypot* sederhana untuk menyaring bot spam.
- **Anti pesanan dobel:** tiap checkout membawa ID unik. Kalau koneksi putus padahal pesanan sudah tersimpan lalu pembeli menekan kirim lagi, pesanan yang sama dikembalikan, bukan dicatat dua kali.
- **Pembatas spam:** maksimal 3 pesanan per nomor WhatsApp dan 12 pesanan per perangkat/IP dalam 10 menit. Batas IP dibuat longgar karena banyak pembeli bisa berbagi satu Wi-Fi (mis. kampus). Angkanya bisa diubah di bagian atas `Code.gs` (`RATE_LIMIT_PHONE`, `RATE_LIMIT_CLIENT`).
- Google Doc detail dibuat setelah pesanan tercatat di Sheet. Kalau pembuatan Doc gagal (mis. kuota harian Google habis), pesanan tetap sah dan hanya kolom Detail yang kosong.
#   D I S U M P E L - O R D E R - A P P  
 