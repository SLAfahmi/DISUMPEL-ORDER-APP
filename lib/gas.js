// Pemanggil Web App Google Apps Script, dipakai bersama oleh /api/menu dan /api/order.
import { MENU } from "./config.js";

// Penolakan dari Apps Script (PO ditutup, stok habis, terlalu banyak pesanan).
// Pesannya memang ditulis untuk pembeli, jadi aman ditampilkan apa adanya.
export class GasRejection extends Error {}

export function gasConfig() {
  const { GAS_WEBHOOK_URL: url, ORDER_SECRET: secret } = process.env;
  return url && secret ? { url, secret } : null;
}

// Selalu dikirim agar Apps Script otomatis menambah baris & kolom untuk menu baru di spreadsheet.
// `parts` = isi paket bundling, supaya Apps Script bisa menghitung sisa stok paket dari menu isinya.
const MENU_REFS = MENU.map(({ id, name, contains }) =>
  contains ? { id, name, parts: Object.entries(contains).map(([partId, qty]) => ({ id: partId, qty })) } : { id, name }
);

export async function callGas({ url, secret }, action, data, timeoutMs) {
  // Apps Script membalas POST dengan redirect 302 ke googleusercontent.com;
  // fetch mengikutinya otomatis dan mengembalikan JSON hasil doPost().
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...data, secret, action, menu: MENU_REFS }),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(`Respons Apps Script bukan JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }

  if (result.rejected) throw new GasRejection(result.error);
  if (!result.ok) throw new Error(result.error || "Apps Script menolak permintaan.");
  return result;
}
