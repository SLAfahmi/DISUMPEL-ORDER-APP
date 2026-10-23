import { createHash } from "node:crypto";
import { STORE, ORDER_TYPES, PAYMENT, MENU } from "../lib/config.js";
import { GasRejection, callGas, gasConfig } from "../lib/gas.js";

const MENU_BY_ID = new Map(MENU.map((item) => [item.id, item]));
const TYPE_BY_ID = new Map(ORDER_TYPES.map((type) => [type.id, type]));

// Bukti bayar dikirim browser sebagai data URL gambar yang sudah dikompres (biasanya < 500 KB).
const PROOF_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_PROOF_BYTES = 3 * 1024 * 1024;

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

  const proof = parseProof(body.proof);
  if (!proof) {
    return res
      .status(400)
      .json({ ok: false, error: "Unggah bukti pembayaran berupa gambar (screenshot/foto, maks. 3 MB)." });
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
      { ref: orderRef(body.ref), client: clientKey(req, gas.secret), order, proof },
      25_000
    );
    if (!saved.orderId) throw new Error("Apps Script tidak mengembalikan ID pesanan.");
    return res.status(200).json({
      ok: true,
      orderId: saved.orderId,
      order: { ...order, batch: saved.batch || "", slot: saved.slot ?? order.slot },
    });
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

  if (!Array.isArray(body.items) || body.items.length === 0) return { error: "Keranjang masih kosong." };
  if (body.items.length > 50) return { error: "Terlalu banyak jenis item dalam satu pesanan." };

  const items = [];
  for (const raw of body.items) {
    const menu = MENU_BY_ID.get(raw?.id);
    if (!menu) return { error: "Ada menu yang tidak dikenal. Muat ulang halaman lalu coba lagi." };
    if (menu.available === false) return { error: `Maaf, ${menu.name} sedang habis.` };

    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { error: `Jumlah ${menu.name} tidak valid.` };

    const item = {
      id: menu.id,
      name: menu.name,
      price: menu.price,
      qty,
      note: text(raw.note, 100),
      lineTotal: menu.price * qty,
    };
    // Paket bundling: total porsi tiap menu isi, dipakai Apps Script untuk stok & rekap produksi.
    if (menu.contains) {
      item.parts = Object.entries(menu.contains).map(([id, perPack]) => ({
        id,
        name: MENU_BY_ID.get(id).name,
        qty: perPack * qty,
      }));
    }
    items.push(item);
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
      // Jadwal pengantaran/pengambilan pilihan pembeli; Apps Script memastikan masih aktif di spreadsheet.
      slot: text(body.slot, 200),
      address,
      payment: PAYMENT.id,
      paymentLabel: PAYMENT.label,
      notes: text(body.notes, 300),
      items,
      subtotal,
      deliveryFee,
      total: subtotal + deliveryFee,
    },
  };
}

// { mime, data(base64) } bila bukti berupa gambar JPG/PNG/WebP asli dengan ukuran wajar, selain itu null.
function parseProof(value) {
  const match = typeof value === "string" && value.match(PROOF_RE);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES || !isImageBytes(bytes)) return null;
  return { mime: match[1], data: match[2] };
}

// Cek tanda tangan file, supaya file lain yang diberi label "image/…" tidak lolos.
function isImageBytes(bytes) {
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  const webp = bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  return jpeg || png || webp;
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
