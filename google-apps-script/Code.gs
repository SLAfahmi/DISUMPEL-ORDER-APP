/**
 * disumpel — penerima pesanan dari website (Vercel).
 *
 * Spreadsheet "Rekap Pesanan disumpel" berisi tiga tab:
 *   - Pesanan    : satu baris per pesanan. Tim memverifikasi "Status Bayar" dari bukti bayar,
 *                  lalu memperbarui "Status Pesanan". Keduanya bisa diubah dari HP.
 *   - Pengaturan : buka/tutup PO, batas waktu, batch, stok & kuota tiap menu, dan daftar
 *                  jadwal pengantaran yang bisa dipilih pembeli.
 *   - Rekap      : per batch & per jadwal pengantaran: jumlah pesanan, omzet lunas, porsi tiap menu.
 * Bukti bayar & Google Doc detail tiap pesanan disimpan di folder Drive "Pesanan disumpel/<yyyy-MM-dd>".
 *
 * Cara pakai singkat (panduan lengkap: PANDUAN-SETUP.local.md, hanya di laptop pemilik):
 *   1. Pilih fungsi `setup` lalu klik Run → izinkan akses. Catat ORDER_SECRET dari log.
 *   2. Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 *   3. Simpan URL /exec sebagai GAS_WEBHOOK_URL dan ORDER_SECRET di Vercel.
 */

const TZ = 'Asia/Jakarta';
const ROOT_FOLDER_NAME = 'Pesanan disumpel';
const SPREADSHEET_NAME = 'Rekap Pesanan disumpel';
const SHEET_NAME = 'Pesanan';
const SETTINGS_SHEET_NAME = 'Pengaturan';
const RECAP_SHEET_NAME = 'Rekap';
const HEADER_BG = '#fde9dc';

// Status Bayar diisi tim setelah mengecek kolom "Bukti Bayar".
const PAY_STATUSES = ['Menunggu Verifikasi', 'Lunas', 'Ditolak'];
const PAY_REJECTED = 'Ditolak';
const ORDER_STATUSES = ['Baru', 'Diproses', 'Siap Diambil', 'Dikirim', 'Selesai', 'Dibatalkan'];
const CANCELLED = 'Dibatalkan';
const HEADERS = [
  'Waktu', 'ID Pesanan', 'Status Bayar', 'Status Pesanan', 'Nama', 'WhatsApp', 'Penerimaan', 'Jadwal Pengantaran',
  'Alamat', 'Batch', 'Item', 'Jumlah Item', 'Subtotal', 'Ongkir', 'Total', 'Bukti Bayar', 'Catatan', 'Detail',
];
// Posisi kolom di tab Pesanan. Setelah kolom Detail, tiap menu (bukan paket) otomatis mendapat satu
// kolom berjudul nama menu berisi jumlah porsinya, termasuk porsi dari paket (untuk kuota & rekap).
const COL = {
  ID: 2, PAY: 3, STATUS: 4, SLOT: 8, ADDRESS: 9, BATCH: 10, ITEMS: 11, SUBTOTAL: 13, TOTAL: 15, PROOF: 16, DETAIL: 18,
};

// Tab Pengaturan: label di kolom A, nilai di kolom B, lalu tabel menu dan tabel jadwal pengantaran.
const LABEL_OPEN = 'PO Dibuka';
const LABEL_CLOSE_AT = 'Tutup Otomatis';
const LABEL_BATCH = 'Batch PO';
const MENU_HEADERS = ['ID Menu', 'Menu', 'Tersedia', 'Kuota per Batch', 'Terpesan', 'Sisa'];
const SLOT_HEADERS = ['Jadwal Pengantaran', 'Untuk', 'Aktif'];
// Pilihan kolom "Untuk": harus sama dengan label ORDER_TYPES di lib/config.js.
const SLOT_FOR = ['Semua', 'Diantar', 'Ambil Sendiri'];
const SLOT_FOR_ALL = 'Semua';
const SLOT_ROWS = 30; // baris tabel jadwal yang disiapkan dropdown & checkbox-nya
const MENU_SPARE_ROWS = 5; // baris kosong untuk menu, sebelum tabel jadwal

// Bukti bayar yang diterima (website mengirim JPG hasil kompres, biasanya < 500 KB).
const PROOF_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

// Batas pesanan dalam 10 menit. Satu IP bisa dipakai banyak pembeli (mis. Wi-Fi kampus), jadi lebih longgar.
const RATE_WINDOW_SEC = 600;
const RATE_LIMIT_PHONE = 3;
const RATE_LIMIT_CLIENT = 12;
// Lama ID kiriman diingat untuk mencegah pesanan dobel. 6 jam = batas maksimum CacheService.
const REF_TTL_SEC = 21600;

/** Jalankan sekali dari editor Apps Script. Aman dijalankan ulang, termasuk untuk memperbarui versi lama. */
function setup() {
  const props = PropertiesService.getScriptProperties();

  const folderId = props.getProperty('FOLDER_ID');
  const folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.createFolder(ROOT_FOLDER_NAME);

  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  let ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : null;
  // Format tabel Pesanan berubah: spreadsheet lama diganti namanya (datanya tetap ada di Drive),
  // lalu dibuat spreadsheet baru dengan format terbaru.
  if (ss && !isCurrentLayout_(ss)) {
    const archivedName = SPREADSHEET_NAME + ' (format lama ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') + ')';
    ss.rename(archivedName);
    Logger.log('Spreadsheet format lama disimpan sebagai "%s": %s', archivedName, ss.getUrl());
    ss = null;
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    ss.getSheets()[0].setName(SHEET_NAME);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
  }
  ss.setSpreadsheetTimeZone(TZ);
  prepareSheet_(ss);
  prepareSettings_(ss);
  refreshFormulas_(ss);

  const secret = props.getProperty('ORDER_SECRET') || Utilities.getUuid().replace(/-/g, '');
  props.setProperties({ FOLDER_ID: folder.getId(), SPREADSHEET_ID: ss.getId(), ORDER_SECRET: secret });

  Logger.log('Setup selesai.');
  Logger.log('Folder Drive : %s', folder.getUrl());
  Logger.log('Spreadsheet  : %s', ss.getUrl());
  Logger.log('ORDER_SECRET : %s', secret);
  Logger.log('Salin ORDER_SECRET di atas ke Environment Variables Vercel.');
  Logger.log('Daftar menu muncul otomatis di tab Pengaturan setelah website dibuka pertama kali.');
}

/** Cek cepat apakah Web App sudah aktif: buka URL /exec di browser. */
function doGet() {
  const ready = Boolean(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  return json_({ ok: true, service: 'order-makanan', ready: ready });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();

    const secret = props.getProperty('ORDER_SECRET');
    if (!secret || payload.secret !== secret) {
      return json_({ ok: false, error: 'Unauthorized' });
    }

    const ss = SpreadsheetApp.openById(requireProp_(props, 'SPREADSHEET_ID'));
    if (!isCurrentLayout_(ss)) {
      throw new Error('Tabel Pesanan masih format lama. Jalankan fungsi setup() lagi di Apps Script.');
    }
    const menu = cleanMenu_(payload.menu);
    if (payload.action === 'status') return json_(handleStatus_(ss, menu));
    return json_(handleOrder_(props, ss, menu, payload));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Status toko untuk website: PO buka/tutup, batch, jadwal pengantaran, dan ketersediaan tiap menu. */
function handleStatus_(ss, menu) {
  if (menuNeedsSync_(ss, menu)) {
    withLock_(function () { syncMenu_(ss, menu); });
  }
  const shop = readShop_(ss, new Date(), menu);
  const items = {};
  Object.keys(shop.menu).forEach(function (id) {
    items[id] = { available: shop.menu[id].available, remaining: shop.menu[id].remaining };
  });
  return {
    ok: true,
    open: shop.open,
    closeAt: shop.closeAt ? shop.closeAt.toISOString() : null,
    batch: shop.batch,
    slots: shop.slots,
    items: items,
  };
}

function handleOrder_(props, ss, menu, payload) {
  const order = payload.order;
  if (!order || !order.customer || !Array.isArray(order.items) || order.items.length === 0) {
    return { ok: false, error: 'Data pesanan tidak lengkap' };
  }

  const cache = CacheService.getScriptCache();
  const refKey = /^[\w-]{8,64}$/.test(String(payload.ref || '')) ? 'ref:' + payload.ref : '';
  const limits = [{ key: 'rl:phone:' + order.customer.phone, max: RATE_LIMIT_PHONE }];
  if (payload.client) limits.push({ key: 'rl:client:' + payload.client, max: RATE_LIMIT_CLIENT });
  const now = new Date();

  // Kiriman ulang dari checkout yang sama (mis. koneksi putus padahal sudah tersimpan):
  // kembalikan pesanan yang sudah tercatat tanpa menyimpan bukti bayar lagi.
  const previous = refKey && cache.get(refKey);
  if (previous) return JSON.parse(previous);
  if (isLimited_(cache, limits)) return reject_(tooManyMessage_());

  // Bukti bayar disimpan dulu di luar lock karena lambat; dihapus lagi bila pesanan batal dicatat.
  const folder = withLock_(function () { return getDayFolder_(props, now); });
  const proofFile = saveProof_(payload.proof, folder, now);

  let slot;
  try {
    // Cek stok & jadwal, beri nomor urut, dan catat ke Sheet dalam satu lock, supaya kuota
    // tidak terlampaui dan nomor tidak dobel saat pesanan masuk bersamaan.
    slot = withLock_(function () {
      const again = refKey && cache.get(refKey);
      if (again) return { result: JSON.parse(again) };
      if (isLimited_(cache, limits)) return { result: reject_(tooManyMessage_()) };

      if (menuNeedsSync_(ss, menu)) syncMenu_(ss, menu);
      const shop = readShop_(ss, now, menu);
      if (!shop.open) return { result: reject_('Maaf, pre-order sedang ditutup. Nantikan batch berikutnya ya!') };
      const problem = stockProblem_(shop, order.items) || slotProblem_(shop, order);
      if (problem) return { result: reject_(problem) };

      const orderId = nextOrderId_(props, now);
      appendOrderRow_(ss, orderId, order, now, shop.batch, proofFile ? proofFile.getUrl() : '');

      const result = { ok: true, orderId: orderId, batch: shop.batch, slot: order.slot };
      if (refKey) cache.put(refKey, JSON.stringify(result), REF_TTL_SEC);
      limits.forEach(function (l) {
        cache.put(l.key, String(Number(cache.get(l.key) || 0) + 1), RATE_WINDOW_SEC);
      });
      return { result: result, recorded: true, batch: shop.batch };
    });
  } catch (err) {
    if (proofFile) proofFile.setTrashed(true);
    throw err;
  }

  if (!slot.recorded) {
    if (proofFile) proofFile.setTrashed(true);
    return slot.result;
  }

  // Langkah lanjutan di luar lock. Pesanan sudah tercatat di Sheet, jadi bila ada yang gagal
  // pesanan tetap sah; hanya nama file atau kolom Detail yang tidak lengkap.
  const orderId = slot.result.orderId;
  try {
    if (proofFile) proofFile.setName(orderId + ' - bukti bayar.' + PROOF_TYPES[payload.proof.mime]);
    const doc = createDetailDoc_(orderId, order, now, folder, slot.batch, proofFile ? proofFile.getUrl() : '');
    withLock_(function () { setDetailLink_(ss, orderId, doc.getUrl()); });
  } catch (err) {
    console.error('Gagal melengkapi pesanan ' + orderId + ': ' + err);
  }
  return slot.result;
}

/** Simpan bukti bayar ke folder harian. Null bila tidak ada atau bukan gambar yang didukung. */
function saveProof_(proof, folder, now) {
  const ext = proof && PROOF_TYPES[proof.mime];
  if (!ext || typeof proof.data !== 'string') return null;
  const bytes = Utilities.base64Decode(proof.data);
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) return null;
  const name = 'bukti-' + Utilities.formatDate(now, TZ, 'HHmmss') + '-' + Utilities.getUuid().slice(0, 8) + '.' + ext;
  return folder.createFile(Utilities.newBlob(bytes, proof.mime, name));
}

function isLimited_(cache, limits) {
  return limits.some(function (l) { return Number(cache.get(l.key) || 0) >= l.max; });
}

function tooManyMessage_() {
  return 'Terlalu banyak pesanan dalam waktu singkat. Coba lagi beberapa menit lagi atau hubungi kami via WhatsApp.';
}

/**
 * Pesan penolakan bila ada menu yang habis atau melebihi sisa kuota; '' bila aman.
 * Porsi dari paket dijumlahkan ke menu isinya, jadi paket tidak bisa melewati kuota dimsum/jelly.
 */
function stockProblem_(shop, items) {
  const wanted = {};
  const add = function (id, name, qty) {
    wanted[id] = wanted[id] || { name: name, qty: 0 };
    wanted[id].qty += Number(qty) || 0;
  };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const stock = shop.menu[item.id];
    if (stock && !stock.available) return 'Maaf, ' + item.name + ' sedang habis.';
    if (Array.isArray(item.parts)) {
      item.parts.forEach(function (p) { add(p.id, p.name, p.qty); });
    } else {
      add(item.id, item.name, item.qty);
    }
  }
  for (const id in wanted) {
    const stock = shop.menu[id];
    if (!stock) continue;
    if (!stock.available || stock.remaining === 0) return 'Maaf, ' + wanted[id].name + ' sedang habis.';
    if (stock.remaining !== null && wanted[id].qty > stock.remaining) {
      return 'Maaf, ' + wanted[id].name + ' tinggal ' + stock.remaining + ' porsi (termasuk isi paket). Kurangi jumlahnya lalu kirim lagi.';
    }
  }
  return '';
}

/**
 * Pesan penolakan bila jadwal pengantaran pilihan pembeli tidak aktif lagi; '' bila aman.
 * Bila tidak ada jadwal aktif untuk tipe pesanan ini, jadwal dikosongkan (tidak wajib dipilih).
 */
function slotProblem_(shop, order) {
  const options = slotsFor_(shop.slots, order.typeLabel);
  if (!options.length) {
    order.slot = '';
    return '';
  }
  if (options.some(function (s) { return s.label === order.slot; })) return '';
  return order.slot
    ? 'Maaf, jadwal "' + order.slot + '" sudah tidak tersedia. Pilih jadwal lain ya.'
    : 'Pilih jadwal pengantaran dulu ya.';
}

function slotsFor_(slots, typeLabel) {
  return slots.filter(function (s) { return s.for === SLOT_FOR_ALL || s.for === typeLabel; });
}

function reject_(message) {
  return { ok: false, rejected: true, error: message };
}

/* ---------- Tab Pengaturan ---------- */

/** Baca status PO, batch, sisa kuota tiap menu (termasuk paket), dan jadwal pengantaran yang aktif. */
function readShop_(ss, now, menu) {
  const range = ss.getSheetByName(SETTINGS_SHEET_NAME).getDataRange();
  const values = range.getValues();
  const display = range.getDisplayValues();
  const shop = { open: false, closeAt: null, batch: '', menu: {}, slots: [] };

  let r = 0;
  for (; r < values.length; r++) {
    const label = String(values[r][0]).trim();
    if (label === MENU_HEADERS[0]) break;
    if (label === LABEL_OPEN) shop.open = isChecked_(values[r][1]);
    if (label === LABEL_CLOSE_AT && values[r][1] instanceof Date) shop.closeAt = values[r][1];
    if (label === LABEL_BATCH) shop.batch = display[r][1].trim();
  }
  if (shop.closeAt && now >= shop.closeAt) shop.open = false;

  const booked = bookedQty_(ss, shop.batch);
  for (r++; r < values.length; r++) {
    const id = String(values[r][0]).trim();
    if (!id || id === SLOT_HEADERS[0]) break;
    const quota = values[r][3] === '' ? NaN : Number(values[r][3]);
    shop.menu[id] = {
      available: isChecked_(values[r][2]),
      // null = tanpa batas (kolom kuota kosong).
      remaining: isFinite(quota) ? Math.max(0, Math.floor(quota) - (booked[String(values[r][1]).trim()] || 0)) : null,
    };
  }

  // Tabel jadwal: dari judul "Jadwal Pengantaran" sampai akhir sheet; baris kosong dilewati.
  while (r < values.length && String(values[r][0]).trim() !== SLOT_HEADERS[0]) r++;
  for (r++; r < values.length; r++) {
    const label = display[r][0].trim();
    if (!label || !isChecked_(values[r][2])) continue;
    shop.slots.push({ label: label, for: String(values[r][1]).trim() || SLOT_FOR_ALL });
  }

  applyBundles_(shop, menu);
  return shop;
}

/** Ketersediaan & sisa paket bundling mengikuti menu isinya (dan centang Tersedia milik paket itu sendiri). */
function applyBundles_(shop, menu) {
  menu.forEach(function (m) {
    if (!m.parts) return;
    const own = shop.menu[m.id];
    let available = own ? own.available : true;
    let remaining = null;
    m.parts.forEach(function (p) {
      const part = shop.menu[p.id];
      if (!part) return;
      if (!part.available) available = false;
      if (part.remaining !== null) {
        const packs = Math.floor(part.remaining / p.qty);
        remaining = remaining === null ? packs : Math.min(remaining, packs);
      }
    });
    shop.menu[m.id] = { available: available, remaining: remaining };
  });
}

/**
 * Total porsi per nama menu yang sudah dipesan untuk batch ini.
 * Pesanan Dibatalkan atau yang pembayarannya Ditolak tidak dihitung.
 */
function bookedQty_(ss, batch) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const totals = {};
  if (lastRow < 2 || lastCol <= HEADERS.length) return totals;

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0].map(function (h) { return String(h).trim(); });
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row[COL.STATUS - 1] === CANCELLED || row[COL.PAY - 1] === PAY_REJECTED) continue;
    if (String(row[COL.BATCH - 1]).trim() !== batch) continue;
    for (let c = HEADERS.length; c < lastCol; c++) {
      const qty = Number(row[c]);
      if (header[c] && qty > 0) totals[header[c]] = (totals[header[c]] || 0) + qty;
    }
  }
  return totals;
}

/** Daftar menu {id, name, parts?} dari website (lib/config.js). `parts` hanya ada pada paket bundling. */
function cleanMenu_(menu) {
  return (Array.isArray(menu) ? menu : [])
    .filter(function (m) { return m && typeof m.id === 'string' && typeof m.name === 'string' && m.id.trim() && m.name.trim(); })
    .map(function (m) {
      const item = { id: m.id.trim(), name: m.name.trim() };
      const parts = (Array.isArray(m.parts) ? m.parts : []).filter(function (p) { return p && typeof p.id === 'string'; });
      if (parts.length) {
        item.parts = parts.map(function (p) { return { id: p.id, qty: Math.max(1, Math.floor(Number(p.qty) || 1)) }; });
      }
      return item;
    });
}

/** True bila tab, kolom, atau baris untuk menu dari website belum lengkap di spreadsheet. */
function menuNeedsSync_(ss, menu) {
  const orders = ss.getSheetByName(SHEET_NAME);
  const settings = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!orders || !settings || !ss.getSheetByName(RECAP_SHEET_NAME)) return true;

  const header = headerRow_(orders);
  const rows = menuRows_(settings);
  if (!header.length || !rows.headerRow || !rows.slotHeaderRow) return true;
  return menu.some(function (m) {
    const row = rows.byId[m.id];
    return !row || row.name !== m.name || (!m.parts && header.indexOf(m.name, HEADERS.length) === -1);
  });
}

/** Lengkapi tab Pesanan, Pengaturan, dan Rekap untuk menu dari website. Aman diulang. */
function syncMenu_(ss, menu) {
  const orders = prepareSheet_(ss);
  const settings = prepareSettings_(ss);

  // Kolom jumlah porsi per menu di tab Pesanan. Paket tidak punya kolom: porsinya masuk ke menu isi.
  const header = headerRow_(orders);
  const newNames = menu
    .filter(function (m) { return !m.parts; })
    .map(function (m) { return m.name; })
    .filter(function (name, i, all) { return header.indexOf(name, HEADERS.length) === -1 && all.indexOf(name) === i; });
  if (newNames.length) {
    const start = Math.max(header.length, HEADERS.length) + 1;
    ensureColumns_(orders, start + newNames.length - 1);
    orders.getRange(1, start, 1, newNames.length).setValues([newNames]).setFontWeight('bold').setBackground(HEADER_BG);
  }

  // Baris Tersedia & Kuota per menu di tab Pengaturan.
  const rows = menuRows_(settings);
  menu.forEach(function (m) {
    const existing = rows.byId[m.id];
    if (existing) {
      if (existing.name !== m.name) settings.getRange(existing.row, 2).setValue(m.name);
      return;
    }
    const row = rows.next++;
    // Sisakan satu baris kosong sebelum tabel jadwal; geser tabel jadwal ke bawah bila perlu.
    if (!isBlankRow_(settings, row) || !isBlankRow_(settings, row + 1)) settings.insertRowsAfter(row - 1, 1);
    settings.getRange(row, 1, 1, 2).setValues([[m.id, m.name]]);
    settings.getRange(row, 3).insertCheckboxes().setValue(true);
    if (m.parts) settings.getRange(row, 4).setNote('Paket bundling: stok & kuotanya mengikuti menu isi paket. Kolom ini tidak dipakai.');
    rows.byId[m.id] = { row: row, name: m.name };
  });

  refreshFormulas_(ss);
}

/**
 * Posisi tabel di tab Pengaturan: baris judul menu, baris kosong berikutnya, { id: { row, name } },
 * dan baris judul tabel jadwal pengantaran (0 bila belum ada).
 */
function menuRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const rows = { headerRow: 0, next: 0, byId: {}, slotHeaderRow: 0 };
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === SLOT_HEADERS[0]) {
      rows.slotHeaderRow = i + 1;
      break;
    }
  }

  let r = 0;
  while (r < values.length && String(values[r][0]).trim() !== MENU_HEADERS[0]) r++;
  if (r === values.length) return rows;

  rows.headerRow = r + 1;
  for (r++; r < values.length; r++) {
    const id = String(values[r][0]).trim();
    if (!id || id === SLOT_HEADERS[0]) break;
    rows.byId[id] = { row: r + 1, name: String(values[r][1]).trim() };
  }
  rows.next = r + 1;
  return rows;
}

function prepareSettings_(ss) {
  let sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    sheet.getRange(1, 1).setValue('Pengaturan Toko').setFontWeight('bold').setFontSize(14);
    sheet.getRange(2, 1, 3, 3).setValues([
      [LABEL_OPEN, '', 'Centang = pembeli bisa memesan. Hapus centang untuk menutup PO.'],
      [LABEL_CLOSE_AT, '', 'Opsional. Isi tanggal & jam; setelah lewat, PO tertutup otomatis.'],
      [LABEL_BATCH, 'Batch 1', 'Nama periode PO, dicatat di kolom Batch. Ganti teksnya untuk batch baru, kuota mulai lagi dari 0.'],
    ]);
    sheet.getRange(2, 1, 3, 1).setFontWeight('bold');
    sheet.getRange(2, 3, 3, 1).setFontColor('#868e96');
    sheet.getRange(2, 2).insertCheckboxes().setValue(true);
    sheet.getRange(3, 2)
      .setNumberFormat('dd/mm/yyyy hh:mm')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    // Teks biasa, supaya "18/10" tidak berubah jadi tanggal.
    sheet.getRange(4, 2).setNumberFormat('@');
    sheet.setColumnWidth(1, 240);
    sheet.setColumnWidth(2, 190);
    sheet.setColumnWidths(3, 4, 110);
  }

  if (!menuRows_(sheet).headerRow) {
    const row = sheet.getLastRow() + 2;
    sheet.getRange(row, 1, 1, MENU_HEADERS.length)
      .setValues([MENU_HEADERS]).setFontWeight('bold').setBackground(HEADER_BG);
    sheet.getRange(row, 3).setNote('Hapus centang bila menu sedang habis / tidak dijual.');
    sheet.getRange(row, 4).setNote('Maksimal porsi untuk satu batch. Kosongkan bila tanpa batas.');
    sheet.getRange(row, 5, 1, 2).setNote('Dihitung otomatis dari tab Pesanan, termasuk porsi dari paket (Dibatalkan & bayar Ditolak tidak dihitung). Jangan diisi.');
  }

  if (!menuRows_(sheet).slotHeaderRow) {
    const layout = menuRows_(sheet);
    const row = Math.max(sheet.getLastRow(), layout.headerRow + MENU_SPARE_ROWS) + 2;
    sheet.getRange(row, 1, 1, SLOT_HEADERS.length + 1)
      .setValues([SLOT_HEADERS.concat(['Isi jadwal, pilih Untuk, lalu centang Aktif. Yang aktif muncul sebagai pilihan saat checkout.'])]);
    sheet.getRange(row, 1, 1, SLOT_HEADERS.length).setFontWeight('bold').setBackground(HEADER_BG);
    sheet.getRange(row, 4).setFontColor('#868e96');
    ensureRows_(sheet, row + SLOT_ROWS);
    sheet.getRange(row + 1, 1, SLOT_ROWS, 1).setNumberFormat('@');
    sheet.getRange(row + 1, 2, SLOT_ROWS, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(SLOT_FOR, true).setAllowInvalid(false).build());
    sheet.getRange(row + 1, 3, SLOT_ROWS, 1).insertCheckboxes();
    // Contoh (belum aktif) supaya tim tahu formatnya.
    sheet.getRange(row + 1, 1, 2, 2).setValues([
      ['Contoh: Sabtu, 25 Okt · 10.00–12.00', SLOT_FOR_ALL],
      ['Contoh: Sabtu, 25 Okt · 15.00–17.00', 'Diantar'],
    ]);
  }
  return sheet;
}

/* ---------- Rumus Terpesan/Sisa & tab Rekap ---------- */

/** Tulis ulang rumus Terpesan/Sisa di tab Pengaturan dan seluruh tab Rekap sesuai kolom menu terkini. */
function refreshFormulas_(ss) {
  const header = headerRow_(ss.getSheetByName(SHEET_NAME));
  const settings = ss.getSheetByName(SETTINGS_SHEET_NAME);

  const column = function (col) {
    const letter = colLetter_(col);
    return SHEET_NAME + '!$' + letter + '$2:$' + letter;
  };
  // 1 untuk pesanan dengan nilai kolom `col` = value yang tidak Dibatalkan dan bayarnya tidak Ditolak.
  const counted = function (col, value) {
    return '(' + column(col) + '=' + value + ')' +
      '*(' + column(COL.STATUS) + '<>"' + CANCELLED + '")' +
      '*(' + column(COL.PAY) + '<>"' + PAY_REJECTED + '")';
  };

  const batchRow = labelRow_(settings, LABEL_BATCH);
  const batchCell = batchRow ? '$B$' + batchRow : '""';
  const rows = menuRows_(settings);
  Object.keys(rows.byId).forEach(function (id) {
    const r = rows.byId[id].row;
    const col = header.indexOf(rows.byId[id].name, HEADERS.length) + 1;
    settings.getRange(r, 5, 1, 2).setFormulas([col
      ? ['=SUMPRODUCT(' + counted(COL.BATCH, batchCell) + ',' + column(col) + ')', '=IF($D' + r + '="","",MAX($D' + r + '-$E' + r + ',0))']
      // Paket bundling tidak punya kolom porsi sendiri.
      : ['="ikut isi paket"', '=""']]);
  });

  const menuCols = [];
  for (let c = HEADERS.length; c < header.length; c++) {
    if (header[c]) menuCols.push(c + 1);
  }
  const menuNames = menuCols.map(function (c) { return header[c - 1]; });
  // Rumus untuk satu tabel ringkasan: baris = nilai unik kolom `keyCol`, mulai di kolom `startCol`.
  const summary = function (keyCol, startCol, extra) {
    const keys = '$' + colLetter_(startCol) + '$2:$' + colLetter_(startCol);
    const perKey = function (expr) { return '=MAP(' + keys + ',LAMBDA(kunci,IF(kunci="","",' + expr + ')))'; };
    return [
      '=IFERROR(UNIQUE(FILTER(' + column(keyCol) + ',' + column(keyCol) + '<>"",' +
        column(COL.STATUS) + '<>"' + CANCELLED + '",' + column(COL.PAY) + '<>"' + PAY_REJECTED + '")),"")',
      perKey('SUMPRODUCT(' + counted(keyCol, 'kunci') + '*(' + column(COL.ID) + '<>""))'),
    ].concat(extra.map(function (expr) { return perKey(expr(counted(keyCol, 'kunci'))); }))
      .concat(menuCols.map(function (c) { return perKey('SUMPRODUCT(' + counted(keyCol, 'kunci') + ',' + column(c) + ')'); }));
  };

  // Tabel 1: per batch. Tabel 2 (di kanannya): per jadwal pengantaran.
  const batchHeads = ['Batch', 'Jumlah Pesanan', 'Belum Diverifikasi', 'Omzet Lunas'].concat(menuNames);
  const batchFormulas = summary(COL.BATCH, 1, [
    function (c) { return 'SUMPRODUCT(' + c + '*(' + column(COL.PAY) + '="' + PAY_STATUSES[0] + '"))'; },
    function (c) { return 'SUMPRODUCT(' + c + '*(' + column(COL.PAY) + '="' + PAY_STATUSES[1] + '"),' + column(COL.TOTAL) + ')'; },
  ]);
  const slotStart = batchHeads.length + 2;
  const slotHeads = ['Jadwal Pengantaran', 'Jumlah Pesanan'].concat(menuNames);
  const slotFormulas = summary(COL.SLOT, slotStart, []);

  const recap = ss.getSheetByName(RECAP_SHEET_NAME) || ss.insertSheet(RECAP_SHEET_NAME);
  recap.clear();
  ensureColumns_(recap, slotStart + slotHeads.length - 1);
  recap.getRange(1, 1, 1, batchHeads.length).setValues([batchHeads]).setFontWeight('bold').setBackground(HEADER_BG);
  recap.getRange(1, slotStart, 1, slotHeads.length).setValues([slotHeads]).setFontWeight('bold').setBackground(HEADER_BG);
  recap.getRange(1, 1).setNote('Dihitung otomatis dari tab Pesanan. Porsi paket sudah dihitung ke menu isinya. Pesanan Dibatalkan & bayar Ditolak tidak dihitung. Jangan diubah manual.');
  recap.getRange(2, 1, 1, batchFormulas.length).setFormulas([batchFormulas]);
  recap.getRange(2, slotStart, 1, slotFormulas.length).setFormulas([slotFormulas]);
  recap.getRange(2, 4, recap.getMaxRows() - 1, 1).setNumberFormat('"Rp"#,##0');
  recap.setFrozenRows(1);
  recap.setColumnWidth(1, 160);
  recap.setColumnWidths(2, 3, 130);
  recap.setColumnWidth(slotStart, 220);
}

/* ---------- Tab Pesanan & dokumen ---------- */

/** True bila tab Pesanan kosong / belum ada, atau judul kolomnya sesuai format terbaru. */
function isCurrentLayout_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() === 0) return true;
  const header = headerRow_(sheet);
  return HEADERS.every(function (h, i) { return header[i] === h; });
}

function prepareSheet_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() > 0) return sheet;

  sheet.getRange(1, 1, 1, HEADERS.length)
    .setValues([HEADERS])
    .setFontWeight('bold')
    .setBackground(HEADER_BG);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setColumnWidths(1, HEADERS.length, 120);
  sheet.setColumnWidth(COL.PAY, 160);
  sheet.setColumnWidth(COL.SLOT, 200);
  sheet.setColumnWidth(COL.ADDRESS, 240);
  sheet.setColumnWidth(COL.ITEMS, 260);
  // Teks biasa, supaya jadwal/batch seperti "18/10" tidak berubah jadi tanggal.
  sheet.getRange(2, COL.SLOT, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  sheet.getRange(2, COL.BATCH, sheet.getMaxRows() - 1, 1).setNumberFormat('@');

  const pay = sheet.getRange(colLetter_(COL.PAY) + '2:' + colLetter_(COL.PAY));
  const status = sheet.getRange(colLetter_(COL.STATUS) + '2:' + colLetter_(COL.STATUS));
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(PAY_STATUSES[0])
      .setBackground('#fff3bf').setBold(true).setRanges([pay]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(PAY_STATUSES[1])
      .setBackground('#d3f9d8').setRanges([pay]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(PAY_REJECTED)
      .setBackground('#ffe3e3').setFontColor('#c92a2a').setRanges([pay]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Selesai')
      .setBackground('#d3f9d8').setRanges([status]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(CANCELLED)
      .setFontColor('#868e96').setStrikethrough(true).setRanges([status]).build(),
  ]);
  return sheet;
}

function nextOrderId_(props, now) {
  const day = Utilities.formatDate(now, TZ, 'yyMMdd');
  const seq = props.getProperty('SEQ_DAY') === day ? Number(props.getProperty('SEQ_NO')) + 1 : 1;
  props.setProperties({ SEQ_DAY: day, SEQ_NO: String(seq) });
  return 'ORD-' + day + '-' + String(seq).padStart(3, '0');
}

function getDayFolder_(props, now) {
  const root = DriveApp.getFolderById(requireProp_(props, 'FOLDER_ID'));
  const name = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const existing = root.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : root.createFolder(name);
}

function createDetailDoc_(orderId, order, now, folder, batch, proofUrl) {
  const doc = DocumentApp.create(orderId + ' - ' + order.customer.name);
  const body = doc.getBody();

  body.getParagraphs()[0].setText('Pesanan ' + orderId).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph((order.store || 'Order Makanan') + ' · ' + formatTime_(now))
    .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  const info = [
    ['Nama', order.customer.name],
    ['WhatsApp', '+' + order.customer.phone],
    ['Penerimaan', order.typeLabel],
  ];
  if (order.slot) info.push(['Jadwal', order.slot]);
  if (order.address) info.push(['Alamat', order.address]);
  if (batch) info.push(['Batch', batch]);
  info.push(['Pembayaran', order.paymentLabel]);
  if (proofUrl) info.push(['Bukti bayar', proofUrl]);
  if (order.notes) info.push(['Catatan', order.notes]);

  const infoTable = body.appendTable(info).setBorderWidth(0).setColumnWidth(0, 120);
  for (let r = 0; r < info.length; r++) {
    infoTable.getCell(r, 0).editAsText().setBold(true);
    if (info[r][0] === 'Bukti bayar') infoTable.getCell(r, 1).editAsText().setLinkUrl(proofUrl);
  }

  body.appendParagraph('Item Pesanan').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [['Menu', 'Qty', 'Harga', 'Jumlah']].concat(order.items.map(function (item) {
    return [itemLabel_(item), String(item.qty), rupiah_(item.price), rupiah_(item.lineTotal)];
  }));
  rows.push(['Subtotal', '', '', rupiah_(order.subtotal)]);
  rows.push(['Ongkir', '', '', rupiah_(order.deliveryFee)]);
  rows.push(['TOTAL', '', '', rupiah_(order.total)]);

  const table = body.appendTable(rows).setBorderColor('#e0d6cc').setColumnWidth(1, 40);
  const header = table.getRow(0);
  for (let c = 0; c < header.getNumCells(); c++) header.getCell(c).setBackgroundColor(HEADER_BG);
  header.editAsText().setBold(true);
  table.getRow(table.getNumRows() - 1).editAsText().setBold(true);

  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  return file;
}

function appendOrderRow_(ss, orderId, order, now, batch, proofUrl) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  const header = headerRow_(sheet);
  const phone = String(order.customer.phone).replace(/\D/g, '');
  const itemCount = order.items.reduce(function (n, item) { return n + Number(item.qty); }, 0);
  const asText = function (s) { return s ? "'" + s : ''; }; // apostrof: selalu disimpan sebagai teks

  const values = [
    now,
    orderId,
    PAY_STATUSES[0],
    ORDER_STATUSES[0],
    safe_(order.customer.name),
    '=HYPERLINK("https://wa.me/' + phone + '","' + phone + '")',
    safe_(order.typeLabel),
    asText(order.slot),
    safe_(order.address),
    asText(batch),
    safe_(order.items.map(function (item) { return item.qty + 'x ' + itemLabel_(item); }).join('\n')),
    itemCount,
    order.subtotal,
    order.deliveryFee,
    order.total,
    proofUrl ? '=HYPERLINK("' + proofUrl + '","Lihat bukti")' : 'Tidak ada',
    safe_(order.notes),
    '', // Detail: diisi tautan setelah dokumen selesai dibuat.
  ];
  // Porsi per menu; paket dipecah ke menu isinya.
  const addQty = function (name, qty) {
    const c = header.indexOf(name, HEADERS.length);
    if (c !== -1) values[c] = (Number(values[c]) || 0) + Number(qty);
  };
  order.items.forEach(function (item) {
    if (Array.isArray(item.parts)) item.parts.forEach(function (p) { addQty(p.name, p.qty); });
    else addQty(item.name, item.qty);
  });
  for (let c = 0; c < values.length; c++) {
    if (values[c] === undefined) values[c] = '';
  }
  sheet.appendRow(values);

  const row = sheet.getLastRow();
  sheet.getRange(row, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange(row, COL.PAY).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(PAY_STATUSES, true).setAllowInvalid(false).build()
  );
  sheet.getRange(row, COL.STATUS).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ORDER_STATUSES, true).setAllowInvalid(false).build()
  );
  sheet.getRange(row, COL.ITEMS).setWrap(true);
  sheet.getRange(row, COL.SUBTOTAL, 1, 3).setNumberFormat('"Rp"#,##0');
}

/** Isi kolom Detail. Baris dicari lewat ID karena urutan baris bisa berubah saat sheet disortir. */
function setDetailLink_(ss, orderId, url) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  const cell = sheet.getRange(2, COL.ID, sheet.getLastRow() - 1, 1)
    .createTextFinder(orderId).matchEntireCell(true).findNext();
  if (cell) sheet.getRange(cell.getRow(), COL.DETAIL).setFormula('=HYPERLINK("' + url + '","Buka")');
}

/* ---------- Utilitas ---------- */

function itemLabel_(item) {
  return item.name + (item.note ? ' (' + item.note + ')' : '');
}

// Teks yang diawali = + - @ akan dianggap rumus oleh Sheets; beri awalan ' agar tetap teks.
function safe_(value) {
  const s = value == null ? '' : String(value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function isChecked_(value) {
  return value === true || /^(ya|true|buka|1)$/i.test(String(value).trim());
}

function headerRow_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

/** Nomor baris (1-based) dari label di kolom A, atau 0 bila tidak ada. */
function labelRow_(sheet, label) {
  const labels = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  for (let r = 0; r < labels.length; r++) {
    if (String(labels[r][0]).trim() === label) return r + 1;
  }
  return 0;
}

function isBlankRow_(sheet, row) {
  if (row > sheet.getMaxRows()) return true;
  return sheet.getRange(row, 1, 1, MENU_HEADERS.length).getValues()[0].every(function (v) { return v === ''; });
}

function ensureRows_(sheet, count) {
  const max = sheet.getMaxRows();
  if (max < count) sheet.insertRowsAfter(max, count - max);
}

function ensureColumns_(sheet, count) {
  const max = sheet.getMaxColumns();
  if (max < count) sheet.insertColumnsAfter(max, count - max);
}

function colLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function rupiah_(n) {
  return 'Rp ' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatTime_(date) {
  return Utilities.formatDate(date, TZ, 'dd/MM/yyyy HH:mm') + ' WIB';
}

function requireProp_(props, key) {
  const value = props.getProperty(key);
  if (!value) throw new Error(key + ' belum ada. Jalankan fungsi setup() terlebih dahulu.');
  return value;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
