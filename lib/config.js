// Konfigurasi toko & daftar menu.
// Dipakai bersama oleh /api/menu (ditampilkan ke pembeli) dan /api/order
// (validasi + hitung harga di server, jadi harga tidak bisa diakali dari browser).

export const STORE = {
  name: "disumpel",
  tagline: "Dimsum & Jelly Splash",
  logo: "/images/logo.png",
  // Saklar utama. Buka/tutup PO sehari-hari cukup lewat tab "Pengaturan" di spreadsheet (tanpa deploy).
  // false → status berubah jadi "PRE-ORDER DITUTUP" dan pesanan baru ditolak, apa pun isi spreadsheet.
  isOpen: true,
  statusOpen: "OPEN PRE-ORDER",
  statusClosed: "PRE-ORDER DITUTUP",
  headline: "Teman Emosi? Disumpel Aja!",
  subheadline: "Dimsum hangat yang gurih dan jelly splash cocopandan yang adem. Pesan sekarang, bayar pakai QRIS.",
  perks: ["Tanpa Registrasi", "Gratis Ongkir", "Bayar via QRIS"],
  // Nomor WhatsApp toko (format 62…) untuk tombol konfirmasi setelah memesan.
  whatsapp: "6285946635755",
  minOrder: 0,
};

// `label` juga dipakai di kolom "Untuk" pada tabel Jadwal Pengantaran (tab Pengaturan),
// jadi bila label diganti, ganti juga pilihan di kolom tersebut.
export const ORDER_TYPES = [
  { id: "pickup", label: "Ambil Sendiri", fee: 0, hint: "Ambil sesuai jadwal" },
  { id: "delivery", label: "Diantar", fee: 0, hint: "Gratis ongkir", needsAddress: true },
];

// Satu-satunya metode bayar: QRIS GoPay. Pembeli wajib mengunggah bukti bayar,
// lalu tim memverifikasinya lewat kolom "Status Bayar" di spreadsheet.
export const PAYMENT = {
  id: "qris",
  label: "QRIS GoPay",
  qrisImage: "/images/QRIS_KWU.jpeg",
  merchant: "DISUMPEL, MAKANAN & MINUMAN",
};

// `image` → foto di public/images. Tanpa `image`, `emoji` dipakai sebagai gantinya.
// `badge` → label di pojok foto.  `available: false` → tampil "Habis".
// `contains` → menandai paket bundling: { idMenu: jumlah }. Paket memotong stok/kuota menu isinya,
// dan porsinya dihitung ke menu isi di spreadsheet (jadi rekap produksi tetap akurat).
// Stok harian (Tersedia & Kuota) diatur di tab "Pengaturan" spreadsheet; menu baru otomatis muncul di sana.
export const MENU = [
  {
    id: "dimsum-disumpel",
    name: "Dimsum Disumpel",
    price: 16000,
    image: "/images/dimsum.jpg",
    emoji: "🥟",
    description: "4 pcs dimsum ayam juicy dalam box, lengkap dengan saus cabai.",
    badge: "Best Seller",
  },
  {
    id: "jelly-splash-cocopandan",
    name: "Jelly Splash Cocopandan",
    price: 5000,
    image: "/images/jelly-splash.jpg",
    emoji: "🥤",
    description: "Es susu cocopandan dengan potongan jelly kenyal. Manis, wangi, adem.",
    badge: "Segar Dingin",
  },
  {
    id: "paket-teman-emosi",
    name: "Paket Teman Emosi",
    price: 20000,
    image: "/images/paket-bundling.jpg",
    emoji: "🍱",
    description: "1 Dimsum Disumpel + 1 Jelly Splash Cocopandan. Paket kenyang & adem, lebih hemat.",
    badge: "Paket Hemat",
    contains: { "dimsum-disumpel": 1, "jelly-splash-cocopandan": 1 },
  },
];

// Pastikan isi paket menunjuk ke menu yang ada (kesalahan ketik langsung ketahuan saat deploy).
for (const item of MENU) {
  for (const id of Object.keys(item.contains || {})) {
    if (!MENU.some((m) => m.id === id && !m.contains)) throw new Error(`Isi paket "${item.id}" tidak dikenal: ${id}`);
  }
}
