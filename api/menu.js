import { STORE, ORDER_TYPES, PAYMENT, MENU } from "../lib/config.js";
import { callGas, gasConfig } from "../lib/gas.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method tidak diizinkan." });
  }

  // Status dari tab Pengaturan di spreadsheet: PO buka/tutup, batch, jadwal pengantaran, stok & sisa kuota.
  const live = await liveStatus();
  const listedAvailable = (id) => MENU.find((m) => m.id === id)?.available !== false;

  res.setHeader("Cache-Control", live ? "public, s-maxage=30, stale-while-revalidate=300" : "no-store");
  return res.status(200).json({
    ok: true,
    store: {
      ...STORE,
      isOpen: STORE.isOpen !== false && live?.open !== false,
      batch: live?.batch || "",
      closeAt: live?.closeAt || null,
      // [{ label, for }] — `for`: "Semua" atau label tipe pesanan (lihat ORDER_TYPES).
      slots: Array.isArray(live?.slots) ? live.slots : [],
    },
    orderTypes: ORDER_TYPES,
    payment: PAYMENT,
    menu: MENU.map((item) => {
      const stock = live?.items?.[item.id];
      // null = tanpa batas kuota.
      const remaining = Number.isInteger(stock?.remaining) ? stock.remaining : null;
      const partsAvailable = Object.keys(item.contains || {}).every(listedAvailable);
      return {
        ...item,
        available: item.available !== false && partsAvailable && stock?.available !== false && remaining !== 0,
        remaining,
      };
    }),
  });
}

// Bila Apps Script tidak bisa dihubungi, menu tetap tampil memakai lib/config.js saja.
// Pesanan tetap diperiksa ulang oleh Apps Script saat dikirim.
async function liveStatus() {
  const gas = gasConfig();
  if (!gas) return null;
  try {
    return await callGas(gas, "status", {}, 8_000);
  } catch (err) {
    console.error("Gagal membaca status toko dari Apps Script:", err);
    return null;
  }
}
