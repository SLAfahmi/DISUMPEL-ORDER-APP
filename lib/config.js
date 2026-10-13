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
  subheadline: "Kenyal, gurih & manis bikin harimu adem seketika.",
  perks: ["Tanpa Registrasi", "Siap Ambil / Kirim", "QRIS Ready"],
  // Nomor WhatsApp toko (format 62…) untuk tombol konfirmasi setelah memesan.
  whatsapp: "6285946635755",
  minOrder: 0,
};

export const ORDER_TYPES = [
  { id: "pickup", label: "Ambil Sendiri", fee: 0, hint: "Tanpa ongkir" },
  { id: "delivery", label: "Diantar", fee: 0, hint: "Ongkir dikonfirmasi via WA", needsAddress: true },
];

export const PAYMENT_METHODS = [
  { id: "qris", label: "QRIS", info: "Kode QRIS akan kami kirim lewat WhatsApp setelah pesanan dikonfirmasi." },
  {
    id: "transfer",
    label: "Transfer",
    info: "Transfer ke BCA 1234567890 a.n. disumpel, lalu kirim bukti transfer via WhatsApp.",
  },
  { id: "cash", label: "Tunai / COD", info: "Bayar tunai saat pesanan diambil atau diterima." },
];

// `image` → foto di public/images (tampil bulat). Tanpa `image`, `emoji` dipakai sebagai gantinya.
// `badge.tone`: red | amber | green | orange.  `available: false` → tampil "Habis".
// Stok harian (Tersedia & Kuota) diatur di tab "Pengaturan" spreadsheet; menu baru otomatis muncul di sana.
export const MENU = [
  {
    id: "dimsum-ayam-original",
    name: "Dimsum Ayam Original",
    category: "Dimsum",
    price: 16000,
    image: "/images/dimsum-ayam-original.jpg",
    emoji: "🥟",
    description: "4 pcs siomay daging ayam padat juicy + saus chili oil gurih",
    badge: { text: "Best Seller", tone: "red" },
  },
  {
    id: "dimsum-mentai-mozza",
    name: "Dimsum Mentai Mozza",
    category: "Dimsum",
    price: 20000,
    image: "/images/dimsum-mentai-mozza.jpg",
    emoji: "🥟",
    description: "Topping creamy mayo mentai smoky torch dengan taburan tobiko",
    badge: { text: "Favorit", tone: "amber" },
  },
  {
    id: "jelly-splash-mango",
    name: "Jelly Splash Mango",
    category: "Jelly Splash",
    price: 10000,
    image: "/images/jelly-splash-mango.jpg",
    emoji: "🥭",
    description: "Sensasi jelly kenyal berpadu sirup mangga asam manis segar",
    badge: { text: "Segar Dingin", tone: "green" },
  },
  {
    id: "paket-teman-emosi",
    name: "Paket Teman Emosi",
    category: "Paket Hemat",
    price: 23000,
    priceLabel: "Harga Hemat",
    image: "/images/paket-teman-emosi.jpg",
    emoji: "🍱",
    description: "1 Porsi Dimsum Original + 1 Cup Dingin Jelly Splash",
    badge: { text: "Super Hemat", tone: "orange" },
  },
];
