// Server lokal sederhana yang meniru Vercel: file statis dari /public dan fungsi dari /api.
// Jalankan: npm run dev
//
// Jika GAS_WEBHOOK_URL belum diatur di .env.local, pesanan dikirim ke Apps Script tiruan
// (/__mock-gas) dan dicetak di terminal, jadi tampilan bisa dicoba tanpa setup Google.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const PORT = Number(process.env.PORT) || 3000;

try {
  process.loadEnvFile(join(ROOT, ".env.local"));
} catch {
  // .env.local opsional.
}

const useMock = !process.env.GAS_WEBHOOK_URL;
if (useMock) {
  process.env.GAS_WEBHOOK_URL = `http://localhost:${PORT}/__mock-gas`;
  process.env.ORDER_SECRET ||= "dev-secret";
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

let mockSeq = 0;
const mockOrders = new Map(); // ref → hasil, meniru pencegahan pesanan dobel di Apps Script

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/__mock-gas") return await mockAppsScript(req, res);
    if (url.pathname.startsWith("/api/")) return await runFunction(url, req, res);
    return await serveStatic(url, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal Server Error");
  }
});

server.listen(PORT, () => {
  console.log(`\n  Order Makanan berjalan di http://localhost:${PORT}\n`);
  console.log(
    useMock
      ? "  Mode simulasi: GAS_WEBHOOK_URL belum diatur, pesanan hanya dicetak di terminal.\n"
      : `  Pesanan dikirim ke Google Apps Script: ${process.env.GAS_WEBHOOK_URL}\n`
  );
});

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function runFunction(url, req, res) {
  const name = url.pathname.slice("/api/".length).replace(/\/$/, "");
  if (!/^[a-z0-9-]+$/i.test(name)) return notFound(res);

  let mod;
  try {
    mod = await import(pathToFileURL(join(ROOT, "api", `${name}.js`)).href);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") return notFound(res);
    throw err;
  }

  const raw = await readBody(req);
  req.query = Object.fromEntries(url.searchParams);
  req.body = raw;
  if (raw && (req.headers["content-type"] || "").includes("application/json")) {
    try {
      req.body = JSON.parse(raw);
    } catch {
      // Biarkan sebagai string, sama seperti body yang tidak valid di Vercel.
    }
  }

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (data) => {
    res.end(typeof data === "string" || Buffer.isBuffer(data) ? data : JSON.stringify(data));
    return res;
  };

  await mod.default(req, res);
}

async function serveStatic(url, res) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = normalize(join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + sep)) return notFound(res);

  try {
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(content);
  } catch {
    notFound(res);
  }
}

async function mockAppsScript(req, res) {
  const payload = JSON.parse((await readBody(req)) || "{}");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (payload.secret !== process.env.ORDER_SECRET) {
    return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  }

  const batch = "Batch 1 (simulasi)";
  if (payload.action === "status") {
    // Tanpa kuota: semua menu tersedia, PO selalu buka. Dua jadwal contoh supaya pilihan jadwal terlihat.
    const slots = [
      { label: "Sabtu, 25 Okt · 10.00–12.00 (simulasi)", for: "Semua" },
      { label: "Sabtu, 25 Okt · 15.00–17.00 (simulasi)", for: "Diantar" },
    ];
    return res.end(JSON.stringify({ ok: true, open: true, closeAt: null, batch, slots, items: {} }));
  }

  if (payload.ref && mockOrders.has(payload.ref)) {
    console.log(`\n[simulasi] Kiriman ulang ${payload.ref}: tidak dicatat dua kali.`);
    return res.end(JSON.stringify(mockOrders.get(payload.ref)));
  }

  const orderId = `DEV-${String(++mockSeq).padStart(3, "0")}`;
  const { order } = payload;
  console.log(`\n[simulasi] Pesanan ${orderId} dari ${order.customer.name} (${order.customer.phone})`);
  for (const item of order.items) {
    console.log(`  ${item.qty}x ${item.name}${item.note ? ` (${item.note})` : ""}  ${item.lineTotal}`);
  }
  console.log(`  ${order.typeLabel}${order.slot ? ` (${order.slot})` : ""} · ${order.paymentLabel} · total ${order.total}`);
  if (payload.proof) console.log(`  bukti bayar: ${payload.proof.mime}, ${Math.round((payload.proof.data.length * 3) / 4 / 1024)} KB`);
  const result = { ok: true, orderId, batch, slot: order.slot };
  if (payload.ref) mockOrders.set(payload.ref, result);
  res.end(JSON.stringify(result));
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}
