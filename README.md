# disumpel — Web Pre-Order

Website pre-order **disumpel · Dimsum & Jelly Splash**. Pembeli memilih menu dari HP, checkout tanpa registrasi, lalu mengirim konfirmasi lewat WhatsApp. Setiap pesanan otomatis tercatat di Google Sheets dan dibuatkan detailnya di Google Drive.

## Fitur

- Menu bergeser (carousel) dengan kategori, keranjang, dan catatan per item
- Checkout: ambil sendiri / diantar, pilihan pembayaran (QRIS, transfer, tunai)
- Konfirmasi pesanan otomatis ke WhatsApp toko
- Pesanan tercatat di Google Sheets beserta status yang bisa diubah dari HP
- Buka/tutup pre-order, stok, dan kuota porsi diatur dari spreadsheet tanpa deploy ulang
- Rekap jumlah pesanan, omzet, dan porsi per menu untuk tiap jadwal produksi

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
