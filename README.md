# disumpel — Web Pre-Order

Website pre-order **disumpel · Dimsum & Jelly Splash**. Pembeli memilih menu dari HP atau laptop, checkout tanpa registrasi, membayar lewat QRIS GoPay, lalu mengunggah bukti bayar. Setiap pesanan otomatis tercatat di Google Sheets untuk diverifikasi tim, dan bukti bayarnya tersimpan di Google Drive.

Menu: **Dimsum Disumpel**, **Jelly Splash Cocopandan**, dan paket bundling **Paket Teman Emosi**.

## Fitur

- Tampilan responsif: satu kolom di HP; menu + keranjang menempel di samping di desktop
- Alur pesan: pilih menu → isi data, pilih diantar / ambil sendiri (gratis ongkir) & jadwalnya → bayar via QRIS → unggah bukti
- Paket bundling dengan harga hemat; stoknya otomatis mengikuti menu isinya
- Pilihan jadwal pengantaran / pengambilan diatur tim langsung dari spreadsheet
- Bukti bayar dikompres otomatis di browser sebelum dikirim
- Pesanan tercatat di Google Sheets dengan **Status Bayar** (diverifikasi tim) dan **Status Pesanan**
- Buka/tutup pre-order, stok, dan kuota porsi diatur dari spreadsheet tanpa deploy ulang
- Rekap jumlah pesanan, omzet lunas, dan porsi per menu untuk tiap jadwal produksi

## Teknologi

- **Tampilan:** HTML, CSS, dan JavaScript murni (tanpa framework, tanpa build)
- **Server:** Vercel Functions (`api/`)
- **Penyimpanan:** Google Apps Script → Google Sheets & Google Docs

## Struktur folder

| Path | Isi |
| --- | --- |
| `public/` | Tampilan web |
| `api/` | Endpoint `GET /api/menu` dan `POST /api/order` |
| `lib/config.js` | Data toko, menu, harga, metode bayar |
| `google-apps-script/` | Kode untuk Google Apps Script |
| `scripts/dev.mjs` | Server lokal untuk uji coba |

## Menjalankan di komputer

Butuh Node.js 20.12 atau lebih baru.

```bash
npm run dev
```

Buka <http://localhost:3000>. Tanpa konfigurasi apa pun, pesanan hanya **disimulasikan** dan dicetak di terminal.

## Konfigurasi

Untuk menyimpan pesanan sungguhan, isi dua variabel berikut di **Vercel → Settings → Environment Variables**. Untuk uji lokal, isi di `.env.local` (lihat `.env.example`).

| Variabel | Isi |
| --- | --- |
| `GAS_WEBHOOK_URL` | URL Web App Google Apps Script (berakhiran `/exec`) |
| `ORDER_SECRET` | Kode rahasia dari fungsi `setup()` di Apps Script |

> Jangan pernah menulis nilai kedua variabel ini di file yang ikut ke repository.
