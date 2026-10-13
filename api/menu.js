import { STORE, ORDER_TYPES, PAYMENT_METHODS, MENU } from "../lib/config.js";
import { callGas, gasConfig } from "../lib/gas.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method tidak diizinkan." });
  }

  // Status dari tab Pengaturan di spreadsheet: PO buka/tutup, jadwal, stok & sisa kuota.
  const live = await liveStatus();

  res.setHeader("Cache-Control", live ? "public, s-maxage=30, stale-while-revalidate=300" : "no-store");
  return res.status(200).json({
    ok: true,
    store: {
      ...STORE,
      isOpen: STORE.isOpen !== false && live?.open !== false,
      schedule: live?.schedule || "",
      closeAt: live?.closeAt || null,
    },
    orderTypes: ORDER_TYPES,
    paymentMethods: PAYMENT_METHODS,
    menu: MENU.map((item) => {
      const stock = live?.items?.[item.id];
      // null = tanpa batas kuota.
      const remaining = Number.isInteger(stock?.remaining) ? stock.remaining : null;
      return {
        ...item,
        available: item.available !== false && stock?.available !== false && remaining !== 0,
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
