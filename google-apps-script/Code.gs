/**
 * disumpel — penerima pesanan dari website (Vercel).
 *
 * Spreadsheet "Rekap Pesanan disumpel" berisi tiga tab:
 *   - Pesanan    : satu baris per pesanan. Kolom Status bisa diubah dari HP.
 *   - Pengaturan : buka/tutup PO, batas waktu, jadwal ambil/kirim, serta stok & kuota tiap menu.
 *   - Rekap      : jumlah pesanan, omzet, dan porsi tiap menu per jadwal (daftar produksi).
 * Setiap pesanan juga dibuatkan Google Doc detail di folder Drive "Pesanan disumpel/<yyyy-MM-dd>".
 *
 * Cara pakai singkat (lengkapnya di README.md):
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
const STATUSES = ['Baru', 'Diproses', 'Dikirim', 'Selesai', 'Dibatalkan'];
const CANCELLED = 'Dibatalkan';
const HEADERS = [
  'Waktu', 'ID Pesanan', 'Status', 'Nama', 'WhatsApp', 'Tipe', 'Alamat', 'Pembayaran',
  'Item', 'Jumlah Item', 'Subtotal', 'Ongkir', 'Total', 'Catatan', 'Detail', 'Jadwal',
];
// Posisi kolom di tab Pesanan. Setelah kolom Jadwal, tiap menu otomatis mendapat satu kolom
// berjudul nama menu yang berisi jumlah porsinya (dipakai untuk kuota & rekap).
const COL = { ID: 2, STATUS: 3, TOTAL: 13, DETAIL: 15, SCHEDULE: 16 };

// Tab Pengaturan: label di kolom A, nilai di kolom B, lalu tabel menu di bawahnya.
const LABEL_OPEN = 'PO Dibuka';
const LABEL_CLOSE_AT = 'Tutup Otomatis';
const LABEL_SCHEDULE = 'Jadwal Ambil/Kirim';
const MENU_HEADERS = ['ID Menu', 'Menu', 'Tersedia', 'Kuota per Jadwal', 'Terpesan', 'Sisa'];

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
  let ss;
  if (spreadsheetId) {
    ss = SpreadsheetApp.openById(spreadsheetId);
  } else {
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
    const menu = cleanMenu_(payload.menu);
    if (payload.action === 'status') return json_(handleStatus_(ss, menu));
    return json_(handleOrder_(props, ss, menu, payload));
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Status toko untuk website: PO buka/tutup, jadwal, dan ketersediaan tiap menu. */
function handleStatus_(ss, menu) {
  if (menuNeedsSync_(ss, menu)) {
    withLock_(function () { syncMenu_(ss, menu); });
  }
  const shop = readShop_(ss, new Date());
  const items = {};
  Object.keys(shop.menu).forEach(function (id) {
    items[id] = { available: shop.menu[id].available, remaining: shop.menu[id].remaining };
  });
  return {
    ok: true,
    open: shop.open,
    closeAt: shop.closeAt ? shop.closeAt.toISOString() : null,
    schedule: shop.schedule,
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

  // Cek stok, beri nomor urut, dan catat ke Sheet dalam satu lock, supaya kuota tidak
  // terlampaui dan nomor tidak dobel saat pesanan masuk bersamaan.
  const slot = withLock_(function () {
    // Kiriman ulang dari checkout yang sama (mis. koneksi putus padahal sudah tersimpan):
    // kembalikan pesanan yang sudah tercatat, jangan catat lagi.
    const previous = refKey && cache.get(refKey);
    if (previous) return { result: JSON.parse(previous) };

    if (limits.some(function (l) { return Number(cache.get(l.key) || 0) >= l.max; })) {
      return { result: reject_('Terlalu banyak pesanan dalam waktu singkat. Coba lagi beberapa menit lagi atau hubungi kami via WhatsApp.') };
    }

    if (menuNeedsSync_(ss, menu)) syncMenu_(ss, menu);
    const shop = readShop_(ss, now);
    if (!shop.open) return { result: reject_('Maaf, pre-order sedang ditutup. Nantikan batch berikutnya ya!') };
    const problem = stockProblem_(shop, order.items);
    if (problem) return { result: reject_(problem) };

    const folder = getDayFolder_(props, now);
    const orderId = nextOrderId_(props, now);
    appendOrderRow_(ss, orderId, order, now, shop.schedule);

    const result = { ok: true, orderId: orderId, schedule: shop.schedule };
    if (refKey) cache.put(refKey, JSON.stringify(result), REF_TTL_SEC);
    limits.forEach(function (l) {
      cache.put(l.key, String(Number(cache.get(l.key) || 0) + 1), RATE_WINDOW_SEC);
    });
    return { result: result, folder: folder };
  });
  if (!slot.folder) return slot.result;

  // Dokumen detail dibuat di luar lock karena lambat. Pesanan sudah tercatat di Sheet,
  // jadi bila langkah ini gagal pesanan tetap sah; hanya kolom Detail yang kosong.
  try {
    const file = createDetailDoc_(slot.result.orderId, order, now, slot.folder, slot.result.schedule);
    withLock_(function () { setDetailLink_(ss, slot.result.orderId, file.getUrl()); });
  } catch (err) {
    console.error('Gagal membuat dokumen ' + slot.result.orderId + ': ' + err);
  }
  return slot.result;
}

/** Pesan penolakan bila ada menu yang habis atau melebihi sisa kuota; '' bila aman. */
function stockProblem_(shop, items) {
  const wanted = {};
  items.forEach(function (item) {
    wanted[item.id] = wanted[item.id] || { name: item.name, qty: 0 };
    wanted[item.id].qty += Number(item.qty) || 0;
  });
  for (const id in wanted) {
    const stock = shop.menu[id];
    if (!stock) continue;
    if (!stock.available || stock.remaining === 0) return 'Maaf, ' + wanted[id].name + ' sedang habis.';
    if (stock.remaining !== null && wanted[id].qty > stock.remaining) {
      return 'Maaf, ' + wanted[id].name + ' tinggal ' + stock.remaining + ' porsi. Kurangi jumlahnya lalu kirim lagi.';
    }
  }
  return '';
}

function reject_(message) {
  return { ok: false, rejected: true, error: message };
}

/* ---------- Tab Pengaturan ---------- */

/** Baca status PO, jadwal, dan sisa kuota tiap menu untuk jadwal yang sedang aktif. */
function readShop_(ss, now) {
  const range = ss.getSheetByName(SETTINGS_SHEET_NAME).getDataRange();
  const values = range.getValues();
  const display = range.getDisplayValues();
  const shop = { open: false, closeAt: null, schedule: '', menu: {} };

  let r = 0;
  for (; r < values.length; r++) {
    const label = String(values[r][0]).trim();
    if (label === MENU_HEADERS[0]) break;
    if (label === LABEL_OPEN) shop.open = isChecked_(values[r][1]);
    if (label === LABEL_CLOSE_AT && values[r][1] instanceof Date) shop.closeAt = values[r][1];
    if (label === LABEL_SCHEDULE) shop.schedule = display[r][1].trim();
  }
  if (shop.closeAt && now >= shop.closeAt) shop.open = false;

  const booked = bookedQty_(ss, shop.schedule);
  for (r++; r < values.length; r++) {
    const id = String(values[r][0]).trim();
    if (!id) break;
    const quota = values[r][3] === '' ? NaN : Number(values[r][3]);
    shop.menu[id] = {
      available: isChecked_(values[r][2]),
      // null = tanpa batas (kolom kuota kosong).
      remaining: isFinite(quota) ? Math.max(0, Math.floor(quota) - (booked[String(values[r][1]).trim()] || 0)) : null,
    };
  }
  return shop;
}

/** Total porsi per nama menu yang sudah dipesan untuk jadwal ini. Pesanan Dibatalkan tidak dihitung. */
function bookedQty_(ss, schedule) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const totals = {};
  if (lastRow < 2 || lastCol <= HEADERS.length) return totals;

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const header = values[0].map(function (h) { return String(h).trim(); });
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (row[COL.STATUS - 1] === CANCELLED || String(row[COL.SCHEDULE - 1]).trim() !== schedule) continue;
    for (let c = HEADERS.length; c < lastCol; c++) {
      const qty = Number(row[c]);
      if (header[c] && qty > 0) totals[header[c]] = (totals[header[c]] || 0) + qty;
    }
  }
  return totals;
}

/** Daftar menu {id, name} dari website (lib/config.js). */
function cleanMenu_(menu) {
  return (Array.isArray(menu) ? menu : [])
    .filter(function (m) { return m && typeof m.id === 'string' && typeof m.name === 'string' && m.id.trim() && m.name.trim(); })
    .map(function (m) { return { id: m.id.trim(), name: m.name.trim() }; });
}

/** True bila tab, kolom, atau baris untuk menu dari website belum lengkap di spreadsheet. */
function menuNeedsSync_(ss, menu) {
  const orders = ss.getSheetByName(SHEET_NAME);
  const settings = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!orders || !settings || !ss.getSheetByName(RECAP_SHEET_NAME)) return true;

  const header = headerRow_(orders);
  const rows = menuRows_(settings);
  if (header[COL.SCHEDULE - 1] !== HEADERS[COL.SCHEDULE - 1] || !rows.headerRow) return true;
  return menu.some(function (m) {
    const row = rows.byId[m.id];
    return !row || row.name !== m.name || header.indexOf(m.name, HEADERS.length) === -1;
  });
}

/** Lengkapi tab Pesanan, Pengaturan, dan Rekap untuk menu dari website. Aman diulang. */
function syncMenu_(ss, menu) {
  const orders = prepareSheet_(ss);
  const settings = prepareSettings_(ss);

  // Kolom jumlah porsi per menu di tab Pesanan.
  const header = headerRow_(orders);
  const newNames = menu
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
    settings.getRange(row, 1, 1, 2).setValues([[m.id, m.name]]);
    settings.getRange(row, 3).insertCheckboxes().setValue(true);
    rows.byId[m.id] = { row: row, name: m.name };
  });

  refreshFormulas_(ss);
}

/** Tabel menu di tab Pengaturan: baris judul, baris kosong berikutnya, dan { id: { row, name } }. */
function menuRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const rows = { headerRow: 0, next: 0, byId: {} };
  let r = 0;
  while (r < values.length && String(values[r][0]).trim() !== MENU_HEADERS[0]) r++;
  if (r === values.length) return rows;

  rows.headerRow = r + 1;
  for (r++; r < values.length; r++) {
    const id = String(values[r][0]).trim();
    if (!id) break;
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
      [LABEL_SCHEDULE, 'Batch 1', 'Tampil di website & dicatat di kolom Jadwal. Ganti teksnya untuk batch baru, kuota mulai lagi dari 0.'],
    ]);
    sheet.getRange(2, 1, 3, 1).setFontWeight('bold');
    sheet.getRange(2, 3, 3, 1).setFontColor('#868e96');
    sheet.getRange(2, 2).insertCheckboxes().setValue(true);
    sheet.getRange(3, 2)
      .setNumberFormat('dd/mm/yyyy hh:mm')
      .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
    // Teks biasa, supaya "18/10" tidak berubah jadi tanggal.
    sheet.getRange(4, 2).setNumberFormat('@');
    sheet.setColumnWidth(1, 170);
    sheet.setColumnWidth(2, 190);
    sheet.setColumnWidths(3, 4, 110);
  }

  if (!menuRows_(sheet).headerRow) {
    const row = sheet.getLastRow() + 2;
    sheet.getRange(row, 1, 1, MENU_HEADERS.length)
      .setValues([MENU_HEADERS]).setFontWeight('bold').setBackground(HEADER_BG);
    sheet.getRange(row, 3).setNote('Hapus centang bila menu sedang habis / tidak dijual.');
    sheet.getRange(row, 4).setNote('Maksimal porsi untuk satu jadwal. Kosongkan bila tanpa batas.');
    sheet.getRange(row, 5, 1, 2).setNote('Dihitung otomatis dari tab Pesanan (Dibatalkan tidak dihitung). Jangan diisi.');
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
  // 1 untuk baris pesanan dengan jadwal tersebut yang tidak Dibatalkan, 0 untuk lainnya.
  const counted = function (schedule) {
    return '(' + column(COL.SCHEDULE) + '=' + schedule + ')*(' + column(COL.STATUS) + '<>"' + CANCELLED + '")';
  };

  const scheduleRow = labelRow_(settings, LABEL_SCHEDULE);
  const scheduleCell = scheduleRow ? '$B$' + scheduleRow : '""';
  const rows = menuRows_(settings);
  Object.keys(rows.byId).forEach(function (id) {
    const r = rows.byId[id].row;
    const col = header.indexOf(rows.byId[id].name, HEADERS.length) + 1;
    settings.getRange(r, 5, 1, 2).setFormulas([[
      col ? '=SUMPRODUCT(' + counted(scheduleCell) + ',' + column(col) + ')' : '=0',
      '=IF($D' + r + '="","",MAX($D' + r + '-$E' + r + ',0))',
    ]]);
  });

  const menuCols = [];
  for (let c = HEADERS.length; c < header.length; c++) {
    if (header[c]) menuCols.push(c + 1);
  }
  const perSchedule = function (expr) {
    return '=MAP($A$2:$A,LAMBDA(jadwal,IF(jadwal="","",' + expr + ')))';
  };
  const heads = ['Jadwal', 'Jumlah Pesanan', 'Omzet'].concat(menuCols.map(function (c) { return header[c - 1]; }));
  const formulas = [
    '=IFERROR(UNIQUE(FILTER(' + column(COL.SCHEDULE) + ',' + column(COL.SCHEDULE) + '<>"",' + column(COL.STATUS) + '<>"' + CANCELLED + '")),"")',
    perSchedule('SUMPRODUCT(' + counted('jadwal') + '*(' + column(COL.ID) + '<>""))'),
    perSchedule('SUMPRODUCT(' + counted('jadwal') + ',' + column(COL.TOTAL) + ')'),
  ].concat(menuCols.map(function (c) { return perSchedule('SUMPRODUCT(' + counted('jadwal') + ',' + column(c) + ')'); }));

  const recap = ss.getSheetByName(RECAP_SHEET_NAME) || ss.insertSheet(RECAP_SHEET_NAME);
  recap.clear();
  ensureColumns_(recap, heads.length);
  recap.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground(HEADER_BG);
  recap.getRange(1, 1).setNote('Dihitung otomatis dari tab Pesanan. Pesanan Dibatalkan tidak dihitung. Jangan diubah manual.');
  recap.getRange(2, 1, 1, formulas.length).setFormulas([formulas]);
  recap.getRange(2, 3, recap.getMaxRows() - 1, 1).setNumberFormat('"Rp"#,##0');
  recap.setFrozenRows(1);
  recap.setColumnWidth(1, 180);
}

/* ---------- Tab Pesanan & dokumen ---------- */

function prepareSheet_(ss) {
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setValues([HEADERS])
      .setFontWeight('bold')
      .setBackground(HEADER_BG);
    sheet.setFrozenRows(1);
    sheet.setColumnWidths(1, HEADERS.length, 120);
    sheet.setColumnWidth(7, 240); // Alamat
    sheet.setColumnWidth(9, 300); // Item

    const statusRange = sheet.getRange('C2:C');
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Baru')
        .setBackground('#fff3bf').setBold(true).setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Selesai')
        .setBackground('#d3f9d8').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Dibatalkan')
        .setFontColor('#868e96').setStrikethrough(true).setRanges([statusRange]).build(),
    ]);
  }

  // Spreadsheet dari versi lama belum punya kolom Jadwal.
  const scheduleHeader = sheet.getRange(1, COL.SCHEDULE);
  if (scheduleHeader.getValue() !== HEADERS[COL.SCHEDULE - 1]) {
    scheduleHeader.setValue(HEADERS[COL.SCHEDULE - 1]).setFontWeight('bold').setBackground(HEADER_BG);
  }
  sheet.getRange(2, COL.SCHEDULE, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
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

function createDetailDoc_(orderId, order, now, folder, schedule) {
  const doc = DocumentApp.create(orderId + ' - ' + order.customer.name);
  const body = doc.getBody();

  body.getParagraphs()[0].setText('Pesanan ' + orderId).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph((order.store || 'Order Makanan') + ' · ' + formatTime_(now))
    .setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  const info = [
    ['Nama', order.customer.name],
    ['WhatsApp', '+' + order.customer.phone],
    ['Tipe pesanan', order.typeLabel],
  ];
  if (schedule) info.push(['Jadwal', schedule]);
  if (order.address) info.push(['Alamat', order.address]);
  info.push(['Pembayaran', order.paymentLabel]);
  if (order.notes) info.push(['Catatan', order.notes]);

  const infoTable = body.appendTable(info).setBorderWidth(0).setColumnWidth(0, 120);
  for (let r = 0; r < infoTable.getNumRows(); r++) {
    infoTable.getCell(r, 0).editAsText().setBold(true);
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

function appendOrderRow_(ss, orderId, order, now, schedule) {
  const sheet = ss.getSheetByName(SHEET_NAME);
  const header = headerRow_(sheet);
  const phone = String(order.customer.phone).replace(/\D/g, '');
  const itemCount = order.items.reduce(function (n, item) { return n + Number(item.qty); }, 0);

  const values = [
    now,
    orderId,
    STATUSES[0],
    safe_(order.customer.name),
    '=HYPERLINK("https://wa.me/' + phone + '","' + phone + '")',
    safe_(order.typeLabel),
    safe_(order.address),
    safe_(order.paymentLabel),
    safe_(order.items.map(function (item) { return item.qty + 'x ' + itemLabel_(item); }).join('\n')),
    itemCount,
    order.subtotal,
    order.deliveryFee,
    order.total,
    safe_(order.notes),
    '', // Detail: diisi tautan setelah dokumen selesai dibuat.
    schedule ? "'" + schedule : '', // Apostrof: selalu disimpan sebagai teks.
  ];
  order.items.forEach(function (item) {
    const c = header.indexOf(item.name, HEADERS.length);
    if (c !== -1) values[c] = (Number(values[c]) || 0) + Number(item.qty);
  });
  for (let c = 0; c < values.length; c++) {
    if (values[c] === undefined) values[c] = '';
  }
  sheet.appendRow(values);

  const row = sheet.getLastRow();
  sheet.getRange(row, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  sheet.getRange(row, COL.STATUS).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build()
  );
  sheet.getRange(row, 9).setWrap(true);
  sheet.getRange(row, 11, 1, 3).setNumberFormat('"Rp"#,##0');
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
