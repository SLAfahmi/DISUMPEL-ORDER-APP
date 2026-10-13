import { createHash } from "node:crypto";
import { STORE, ORDER_TYPES, PAYMENT_METHODS, MENU } from "../lib/config.js";
import { GasRejection, callGas, gasConfig } from "../lib/gas.js";

const MENU_BY_ID = new Map(MENU.map((item) => [item.id, item]));
const TYPE_BY_ID = new Map(ORDER_TYPES.map((type) => [type.id, type]));
const PAYMENT_BY_ID = new Map(PAYMENT_METHODS.map((method) => [method.id, method]));

const rupiah = (n) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method tidak diizinkan." });
  }

  if (STORE.isOpen === false) {
    return res.status(403).json({ ok: false, error: "Maaf, pre-order sedang ditutup. Nantikan batch berikutnya ya!" });
  }

  const body = parseBody(req.body);

  // Honeypot: field tersembunyi yang hanya diisi oleh bot.
  if (body.website) {
    return res.status(400).json({ ok: false, error: "Pesanan tidak valid." });
  }

  const { order, error } = buildOrder(body);
  if (error) {
    return res.status(400).json({ ok: false, error });
  }

  const gas = gasConfig();
  if (!gas) {
    console.error("GAS_WEBHOOK_URL / ORDER_SECRET belum diatur di Environment Variables.");
    return res
      .status(503)
      .json({ ok: false, error: "Sistem pemesanan belum dikonfigurasi. Silakan hubungi pemilik toko." });
  }

  try {
    const saved = await callGas(
      gas,
      "order",
      { ref: orderRef(body.ref), client: clientKey(req, gas.secret), order },
      25_000
    );
    if (!saved.orderId) throw new Error("Apps Script tidak mengembalikan ID pesanan.");
    return res.status(200).json({ ok: true, orderId: saved.orderId, order: { ...order, schedule: saved.schedule || "" } });
  } catch (err) {
    // PO ditutup, stok habis, atau terlalu banyak pesanan: tampilkan alasannya ke pembeli.
    if (err instanceof GasRejection) return res.status(409).json({ ok: false, error: err.message });
    console.error("Gagal menyimpan pesanan ke Google Drive:", err);
    return res
      .status(502)
      .json({ ok: false, error: "Pesanan gagal disimpan. Silakan coba lagi beberapa saat lagi." });
  }
}

function parseBody(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

const text = (value, max) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

// Terima 08xx / 628xx / +628xx, simpan sebagai 628xx.
function normalizePhone(value) {
  const cleaned = String(value ?? "").replace(/[\s().-]/g, "");
  const match = cleaned.match(/^(?:\+?62|0)(8\d{7,12})$/);
  return match ? `62${match[1]}` : null;
}

function buildOrder(body) {
  const name = text(body.name, 60);
  if (name.length < 2) return { error: "Nama wajib diisi." };

  const phone = normalizePhone(body.phone);
  if (!phone) return { error: "Nomor WhatsApp tidak valid. Contoh: 081234567890." };

  const type = TYPE_BY_ID.get(body.type);
  if (!type) return { error: "Pilih tipe pesanan." };

  const address = type.needsAddress ? text(body.address, 300) : "";
  if (type.needsAddress && address.length < 10) {
    return { error: "Alamat pengantaran wajib diisi dengan lengkap." };
  }

  const payment = PAYMENT_BY_ID.get(body.payment);
  if (!payment) return { error: "Pilih metode pembayaran." };

  if (!Array.isArray(body.items) || body.items.length === 0) return { error: "Keranjang masih kosong." };
  if (body.items.length > 50) return { error: "Terlalu banyak jenis item dalam satu pesanan." };

  const items = [];
  for (const raw of body.items) {
    const menu = MENU_BY_ID.get(raw?.id);
    if (!menu) return { error: "Ada menu yang tidak dikenal. Muat ulang halaman lalu coba lagi." };
    if (menu.available === false) return { error: `Maaf, ${menu.name} sedang habis.` };

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { error: `Jumlah ${menu.name} tidak valid.` };

    items.push({
      id: menu.id,
      name: menu.name,
      price: menu.price,
      qty,
      note: text(raw.note, 100),
      lineTotal: menu.price * qty,
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (subtotal < STORE.minOrder) return { error: `Minimal pemesanan ${rupiah(STORE.minOrder)}.` };

  const deliveryFee = type.fee || 0;

  return {
    order: {
      createdAt: new Date().toISOString(),
      store: STORE.name,
      customer: { name, phone },
      type: type.id,
      typeLabel: type.label,
      address,
      payment: payment.id,
      paymentLabel: payment.label,
      notes: text(body.notes, 300),
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
    },
  };
}

// ID kiriman dari browser. Kiriman ulang dengan ID yang sama tidak dicatat dua kali oleh Apps Script.
function orderRef(value) {
  return typeof value === "string" && /^[\w-]{8,64}$/.test(value) ? value : "";
}

// Penanda perangkat untuk pembatasan spam di Apps Script. IP di-hash, tidak dikirim apa adanya.
function clientKey(req, secret) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwarded || req.headers["x-real-ip"] || req.socket?.remoteAddress;
  return ip ? createHash("sha256").update(`${secret}:${ip}`).digest("hex").slice(0, 32) : "";
}
