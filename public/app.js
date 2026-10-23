const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const CART_KEY = "disumpel_cart_v1";
const CUSTOMER_KEY = "disumpel_customer_v1";
const REF_KEY = "disumpel_order_ref_v1";
const PHONE_RE = /^(?:\+?62|0)8\d{7,12}$/;
// Bukti bayar diperkecil di browser sebelum dikirim: cukup tajam untuk dibaca, tetap ringan di kuota.
const PROOF_MAX_SIDE = 1600;
const PROOF_MAX_BYTES = 3 * 1024 * 1024;

const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14m7-7H5"/></svg>`;
const ICON_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M19 12H5"/></svg>`;

const rupiahFormat = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const rupiah = (n) => rupiahFormat.format(n);
const deadlineFormat = new Intl.DateTimeFormat("id-ID", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
});

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  store: null,
  menu: [],
  byId: new Map(),
  orderTypes: [],
  payment: null,
  cart: load(CART_KEY, {}), // { [menuId]: { qty, note } }
  ref: load(REF_KEY, null),
  proof: null, // { dataUrl, name } bukti bayar yang sudah diperkecil
};

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Mode privat / storage diblokir: keranjang tetap jalan, hanya tidak tersimpan.
  }
}

init();

async function init() {
  try {
    const res = await fetch("/api/menu");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.store = data.store;
    state.menu = data.menu;
    state.byId = new Map(data.menu.map((item) => [item.id, item]));
    state.orderTypes = data.orderTypes;
    state.payment = data.payment;
  } catch (err) {
    console.error(err);
    $("#menu-grid").innerHTML = `<p class="lines-empty">Gagal memuat menu. <button type="button" class="link-btn" id="retry">Coba lagi</button></p>`;
    $("#retry").addEventListener("click", () => location.reload());
    return;
  }

  pruneCart();
  renderStore();
  renderMenu();
  renderCheckoutOptions();
  renderCart();
  bindEvents();
}

// Buang item keranjang lama yang sudah tidak ada / habis, dan sesuaikan dengan sisa kuota.
function pruneCart() {
  let changed = false;
  for (const id of Object.keys(state.cart)) {
    const item = state.byId.get(id);
    const qty = state.cart[id]?.qty;
    if (!item || !item.available || !Number.isInteger(qty) || qty < 1) {
      delete state.cart[id];
      changed = true;
    } else if (qty > maxQty(item)) {
      state.cart[id].qty = maxQty(item);
      changed = true;
    }
  }
  if (changed) saveCart();
}

// Isi keranjang berubah → kiriman berikutnya dihitung sebagai pesanan baru (lihat orderRef).
function saveCart() {
  save(CART_KEY, state.cart);
  state.ref = null;
  save(REF_KEY, null);
}

// ID unik untuk satu isi keranjang. Bila kiriman sebelumnya ternyata sudah tersimpan (mis. koneksi
// putus sebelum balasan diterima), mengirim ulang dengan ID yang sama tidak membuat pesanan dobel.
function orderRef() {
  state.ref ||= crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  save(REF_KEY, state.ref);
  return state.ref;
}

// remaining: sisa kuota dari spreadsheet, null bila tanpa batas.
const maxQty = (item) => Math.min(99, item.remaining ?? 99);

const isOpen = () =>
  state.store.isOpen !== false && !(state.store.closeAt && Date.now() >= Date.parse(state.store.closeAt));

/* ---------- Render ---------- */

function renderStore() {
  const { store } = state;
  document.title = `${store.name} - ${store.tagline}`;
  if (store.logo) $("#store-logo").src = store.logo;
  $("#store-logo").alt = `${store.name} - ${store.tagline}`;

  const status = $("#store-status");
  status.hidden = false;
  status.classList.toggle("is-closed", !isOpen());
  $("#store-status-text").textContent = isOpen() ? store.statusOpen : store.statusClosed;

  // Kata "disumpel" di judul diberi stabilo.
  $("#hero-title").innerHTML = esc(store.headline).replace(/(disumpel)/i, "<mark>$1</mark>");
  $("#hero-sub").textContent = store.subheadline || "";
  $("#perks").innerHTML = (store.perks || []).map((perk) => `<li>${esc(perk)}</li>`).join("");

  const ticker = [store.headline, isOpen() ? store.statusOpen : store.statusClosed, ...(store.perks || [])]
    .map((text) => `<span>${esc(text)} ✦</span>`)
    .join("");
  // Animasi menggeser -50%, jadi isi diulang genap supaya putarannya tanpa jeda.
  $("#ticker-track").innerHTML = ticker.repeat(4);

  const chips = [
    store.batch,
    isOpen() && store.closeAt && `PO tutup ${deadlineFormat.format(new Date(store.closeAt))}`,
  ].filter(Boolean);
  $("#store-schedule").innerHTML = chips.map((part) => `<span>${esc(part)}</span>`).join("");
  $("#store-schedule").hidden = !chips.length;

  const wa = $("#foot-wa");
  wa.hidden = !store.whatsapp;
  wa.href = `https://wa.me/${store.whatsapp}`;

  if (state.payment?.qrisImage) {
    $("#qris-img").src = state.payment.qrisImage;
    $("#qris-download").href = state.payment.qrisImage;
  }
}

function renderMenu() {
  $("#menu-grid").innerHTML = state.menu.map(dishHTML).join("");
}

function photoHTML(item) {
  return item.image
    ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" decoding="async">`
    : `<span class="emoji" role="img" aria-label="${esc(item.name)}">${esc(item.emoji || "🥟")}</span>`;
}

// Harga normal paket = jumlah harga menu isinya bila dibeli satuan (0 untuk menu biasa).
function normalPrice(item) {
  return Object.entries(item.contains || {}).reduce((sum, [id, qty]) => sum + (state.byId.get(id)?.price || 0) * qty, 0);
}

function dishHTML(item) {
  const badge = item.badge ? `<span class="badge">${esc(item.badge)}</span>` : "";
  const stock = item.available && item.remaining != null ? `<span class="stock">Sisa ${item.remaining}</span>` : "";
  const normal = normalPrice(item);
  const save = normal > item.price ? normal - item.price : 0;
  const classes = ["dish", item.contains ? "is-bundle" : "", item.available ? "" : "is-soldout"].filter(Boolean).join(" ");
  return `<article class="${classes}">
    <div class="dish-photo">
      ${photoHTML(item)}${badge}${stock}
      <span class="price-tag">${save ? `<s class="price-old">${rupiah(normal)}</s>` : ""}${rupiah(item.price)}</span>
    </div>
    <div class="dish-body">
      <h3 class="dish-name">${esc(item.name)}</h3>
      <p class="dish-desc">${esc(item.description || "")}</p>
      ${save ? `<p class="dish-save">Hemat ${rupiah(save)} dibanding beli satuan</p>` : ""}
      <div class="dish-foot" data-slot="${esc(item.id)}">${controlsHTML(item)}</div>
    </div>
  </article>`;
}

function controlsHTML(item) {
  if (!item.available) return `<span class="soldout">Habis</span>`;
  const qty = state.cart[item.id]?.qty || 0;
  if (!qty) {
    return `<button type="button" class="add-btn" data-action="inc" data-id="${esc(item.id)}" aria-label="Tambah ${esc(item.name)} ke pesanan">${ICON_PLUS}Tambah</button>`;
  }
  return stepperHTML(item, qty);
}

function stepperHTML(item, qty) {
  return `<div class="stepper" role="group" aria-label="Jumlah ${esc(item.name)}">
    <button type="button" class="minus" data-action="dec" data-id="${esc(item.id)}" aria-label="Kurangi ${esc(item.name)}">${ICON_MINUS}</button>
    <output aria-live="polite">${qty}</output>
    <button type="button" data-action="inc" data-id="${esc(item.id)}" aria-label="Tambah ${esc(item.name)}">${ICON_PLUS}</button>
  </div>`;
}

function cartTotals() {
  const entries = Object.entries(state.cart)
    .map(([id, line]) => ({ item: state.byId.get(id), qty: line.qty, note: line.note || "" }))
    .filter((entry) => entry.item);
  const count = entries.reduce((sum, e) => sum + e.qty, 0);
  const subtotal = entries.reduce((sum, e) => sum + e.item.price * e.qty, 0);
  return { entries, count, subtotal };
}

function renderCart() {
  const { entries, count, subtotal } = cartTotals();

  const badge = $("#cart-count");
  if (count > Number(badge.textContent)) {
    badge.classList.add("bump");
    setTimeout(() => badge.classList.remove("bump"), 180);
  }
  badge.textContent = count;
  $("#cart-label").textContent = !count
    ? "Belum ada item"
    : entries.length === 1
      ? `${entries[0].qty}x ${entries[0].item.name}`
      : `${count} item dipilih`;
  $("#cart-total").textContent = rupiah(subtotal);
  $("#reset-cart").disabled = !count;

  $("#order-btn").disabled = !isOpen();
  $("#order-btn-label").textContent = isOpen() ? "Lanjut Bayar" : state.store.statusClosed;

  const empty = `<div class="lines-empty"><span aria-hidden="true">🥟</span>Belum ada menu dipilih.</div>`;
  const sidebar = $("#cart-lines");
  preserveFocus(sidebar, () => {
    sidebar.innerHTML = entries.length ? entries.map((entry) => lineHTML(entry, false)).join("") : empty;
  });
  const sheet = $("#sheet-items");
  preserveFocus(sheet, () => {
    sheet.innerHTML = entries.length ? entries.map((entry) => lineHTML(entry, true)).join("") : empty;
  });
  syncCheckout();
}

function lineHTML({ item, qty, note }, withNote) {
  const noteInput = withNote
    ? `<input class="line-note" data-note="${esc(item.id)}" value="${esc(note)}" maxlength="100"
        placeholder="Catatan, mis. saus dipisah" aria-label="Catatan untuk ${esc(item.name)}">`
    : "";
  return `<div class="line">
    <div class="line-thumb" aria-hidden="true">${item.image ? `<img src="${esc(item.image)}" alt="">` : `<span class="emoji">${esc(item.emoji || "🥟")}</span>`}</div>
    <div>
      <div class="line-name">${esc(item.name)}</div>
      <div class="line-price">${rupiah(item.price * qty)}</div>
      ${noteInput}
    </div>
    ${stepperHTML(item, qty)}
  </div>`;
}

// Saat area di-render ulang, kembalikan fokus keyboard ke tombol yang setara.
function preserveFocus(container, render) {
  const active = document.activeElement;
  const target = container.contains(active) && active.dataset.action ? { action: active.dataset.action, id: active.dataset.id } : null;
  render();
  if (!target) return;
  const selector = (action) => `[data-action="${action}"][data-id="${CSS.escape(target.id)}"]`;
  const next = container.querySelector(selector(target.action)) || container.querySelector(selector("inc"));
  next?.focus();
}

function renderCheckoutOptions() {
  $("#type-options").innerHTML = state.orderTypes
    .map(
      (type, i) => `<label class="choice">
        <input type="radio" name="type" value="${esc(type.id)}"${i === 0 ? " checked" : ""}>
        <span>${esc(type.label)}<small>${esc(type.hint || (type.fee ? `Ongkir ${rupiah(type.fee)}` : "Gratis ongkir"))}</small></span>
      </label>`
    )
    .join("");
}

/* ---------- Interaksi ---------- */

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { id, action } = button.dataset;
    const current = state.cart[id]?.qty || 0;
    setQty(id, action === "inc" ? current + 1 : current - 1);
  });

  $("#sheet-items").addEventListener("input", (event) => {
    const id = event.target.dataset.note;
    if (!id || !state.cart[id]) return;
    state.cart[id].note = event.target.value;
    saveCart();
  });

  $("#reset-cart").addEventListener("click", () => {
    state.cart = {};
    saveCart();
    refreshMenuControls();
    renderCart();
    toast("Pesanan dikosongkan");
  });

  $("#summary-open").addEventListener("click", openCheckout);
  $("#order-btn").addEventListener("click", openCheckout);
  $("#checkout-form").addEventListener("change", syncCheckout);
  $("#checkout-form").addEventListener("input", (event) => {
    if (!event.target.hasAttribute("aria-invalid")) return;
    event.target.removeAttribute("aria-invalid");
    $("#form-error").hidden = true;
  });
  $("#checkout-form").addEventListener("submit", submitOrder);
  $("#f-proof").addEventListener("change", pickProof);
  $("#copy-total").addEventListener("click", copyTotal);

  for (const button of $$("[data-close-dialog]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }
  // Ketuk area gelap di luar sheet untuk menutup.
  for (const dialog of $$("dialog.sheet")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
}

function refreshMenuControls() {
  $$("[data-slot]").forEach((slot) => (slot.innerHTML = controlsHTML(state.byId.get(slot.dataset.slot))));
}

function setQty(id, qty) {
  const item = state.byId.get(id);
  if (!item || !item.available) return;
  if (!isOpen()) return toast(`Maaf, ${state.store.statusClosed.toLowerCase()}`);

  if (qty > maxQty(item)) {
    if (item.remaining != null) toast(`${item.name} tinggal ${item.remaining} porsi`);
    return;
  }
  const next = Math.max(0, qty);
  if (next === 0) delete state.cart[id];
  else state.cart[id] = { qty: next, note: state.cart[id]?.note || "" };
  saveCart();

  const slot = $(`[data-slot="${CSS.escape(id)}"]`);
  if (slot) preserveFocus(slot, () => (slot.innerHTML = controlsHTML(item)));
  renderCart();
}

/* ---------- Checkout ---------- */

function selectedType(form) {
  return state.orderTypes.find((t) => t.id === form.elements.type.value) || state.orderTypes[0];
}

function checkoutTotal() {
  const fee = selectedType($("#checkout-form")).fee || 0;
  return cartTotals().subtotal + fee;
}

function openCheckout() {
  if (!isOpen()) return toast(`Maaf, ${state.store.statusClosed.toLowerCase()}`);
  if (!cartTotals().count) return toast("Pilih menu dulu ya! Tekan + Tambah pada menu 🥟");

  const form = $("#checkout-form");
  const saved = load(CUSTOMER_KEY, {});
  for (const key of ["name", "phone", "address"]) {
    if (saved[key] && !form.elements[key].value) form.elements[key].value = saved[key];
  }
  if (saved.type && state.orderTypes.some((t) => t.id === saved.type)) form.elements.type.value = saved.type;

  $("#form-error").hidden = true;
  syncCheckout();
  $("#checkout-sheet").showModal();
  $(".sheet-body").scrollTop = 0;
}

// Jadwal aktif dari spreadsheet untuk tipe pesanan ini ("Semua" berlaku untuk kedua tipe).
function slotsFor(type) {
  return (state.store.slots || []).filter((slot) => slot.for === "Semua" || slot.for === type.label);
}

function selectedSlot() {
  return $('#slot-options input[name="slot"]:checked')?.value || "";
}

let renderedSlots = "";
function renderSlots(type) {
  const slots = slotsFor(type);
  $("#slot-field").hidden = !slots.length;
  $("#slot-label").textContent = type.needsAddress ? "Jadwal pengantaran" : "Jadwal pengambilan";

  // Render ulang hanya bila daftar berubah, supaya pilihan pembeli tidak hilang.
  const key = slots.map((slot) => slot.label).join("\n");
  if (key === renderedSlots) return;
  renderedSlots = key;
  const previous = selectedSlot();
  $("#slot-options").innerHTML = slots
    .map((slot) => {
      const checked = slot.label === previous || slots.length === 1;
      return `<label class="choice">
        <input type="radio" name="slot" value="${esc(slot.label)}"${checked ? " checked" : ""}>
        <span>${esc(slot.label)}</span>
      </label>`;
    })
    .join("");
}

function syncCheckout() {
  const form = $("#checkout-form");
  if (!state.orderTypes.length) return;
  const type = selectedType(form);
  const { entries, subtotal } = cartTotals();
  const fee = type.fee || 0;
  const total = subtotal + fee;

  renderSlots(type);
  $("#address-field").hidden = !type.needsAddress;
  $("#sum-subtotal").textContent = rupiah(subtotal);
  $("#sum-fee").textContent = fee ? rupiah(fee) : "Gratis";
  $("#sum-total").textContent = rupiah(total);
  $("#pay-total").textContent = rupiah(total);
  $("#submit-total").textContent = rupiah(total);
  $("#submit-btn").disabled = !entries.length;
}

async function copyTotal() {
  const amount = String(checkoutTotal());
  try {
    await navigator.clipboard.writeText(amount);
    toast(`Nominal ${amount} disalin`);
  } catch {
    toast(`Nominal yang dibayar: ${amount}`);
  }
}

async function pickProof(event) {
  const file = event.target.files?.[0];
  const box = $(".upload");
  box.classList.remove("is-invalid");
  if (!file) return;

  $("#proof-title").textContent = "Memproses gambar…";
  try {
    const dataUrl = await compressImage(file);
    state.proof = { dataUrl, name: file.name };
    $("#proof-preview").src = dataUrl;
    $("#proof-preview").hidden = false;
    box.classList.add("has-file");
    $("#proof-title").textContent = "Bukti bayar siap dikirim ✓";
    $("#proof-sub").textContent = `${file.name} · ketuk untuk mengganti`;
    $("#form-error").hidden = true;
  } catch (err) {
    clearProof();
    box.classList.add("is-invalid");
    showFormError(err.message);
  } finally {
    event.target.value = "";
  }
}

function clearProof() {
  state.proof = null;
  $("#proof-preview").hidden = true;
  $("#proof-preview").removeAttribute("src");
  $(".upload").classList.remove("has-file", "is-invalid");
  $("#proof-title").textContent = "Pilih screenshot bukti bayar";
  $("#proof-sub").textContent = "Gambar JPG / PNG dari aplikasi pembayaranmu";
}

// Perkecil ke sisi terpanjang PROOF_MAX_SIDE dan simpan sebagai JPEG (data URL).
async function compressImage(file) {
  if (!file.type.startsWith("image/")) throw new Error("Bukti bayar harus berupa gambar (screenshot atau foto).");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error("Gambar tidak bisa dibaca. Coba kirim screenshot berformat JPG atau PNG.");
    }
    const scale = Math.min(1, PROOF_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; // latar putih untuk PNG transparan
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if ((dataUrl.length * 3) / 4 > PROOF_MAX_BYTES) throw new Error("Gambar terlalu besar. Coba kirim screenshot saja.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function validate(form) {
  const name = form.elements.name.value.trim();
  const phone = form.elements.phone.value.replace(/[\s().-]/g, "");
  const address = form.elements.address.value.trim();

  if (name.length < 2) return { field: "name", message: "Nama wajib diisi." };
  if (!PHONE_RE.test(phone)) return { field: "phone", message: "Nomor WhatsApp tidak valid. Contoh: 081234567890." };
  const type = selectedType(form);
  if (slotsFor(type).length && !selectedSlot()) {
    return { field: "slot", message: `Pilih ${type.needsAddress ? "jadwal pengantaran" : "jadwal pengambilan"} dulu ya.` };
  }
  if (type.needsAddress && address.length < 10) {
    return { field: "address", message: "Alamat pengantaran wajib diisi dengan lengkap." };
  }
  if (!state.proof) return { field: "proof", message: "Unggah bukti pembayaran QRIS dulu ya (langkah 4)." };
  return null;
}

function showFormError(message, field) {
  const box = $("#form-error");
  box.textContent = message;
  box.hidden = false;
  if (field === "proof") {
    const upload = $(".upload");
    const body = $(".sheet-body");
    upload.classList.add("is-invalid");
    // Gulir isi formulir saja (bukan dialognya) sampai kotak unggah terlihat.
    body.scrollBy({ top: upload.getBoundingClientRect().top - body.getBoundingClientRect().top - 24, behavior: "smooth" });
  } else if (field === "slot") {
    $("#slot-options input")?.focus();
  } else if (field) {
    const input = $("#checkout-form").elements[field];
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
}

async function submitOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#submit-btn");
  if (button.classList.contains("is-loading")) return;

  $("#form-error").hidden = true;
  const problem = validate(form);
  if (problem) return showFormError(problem.message, problem.field);

  const data = Object.fromEntries(new FormData(form));
  const { entries } = cartTotals();
  if (!entries.length) return showFormError("Belum ada menu yang dipilih.");

  button.disabled = true;
  button.classList.add("is-loading");
  try {
    const res = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        ref: orderRef(),
        items: entries.map(({ item, qty, note }) => ({ id: item.id, qty, note })),
        proof: state.proof.dataUrl,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) throw new Error(result.error || "Pesanan gagal dikirim. Silakan coba lagi.");

    save(CUSTOMER_KEY, { name: data.name, phone: data.phone, address: data.address, type: data.type });
    form.elements.notes.value = "";
    state.cart = {};
    saveCart();
    clearProof();
    refreshMenuControls();
    renderCart();

    $("#checkout-sheet").close();
    showSuccess(result.orderId, result.order);
  } catch (err) {
    const offline = err instanceof TypeError;
    showFormError(offline ? "Koneksi bermasalah. Periksa internet kamu lalu coba lagi." : err.message);
  } finally {
    button.classList.remove("is-loading");
    syncCheckout();
  }
}

function showSuccess(orderId, order) {
  $("#success-id").textContent = orderId;
  $("#success-total").textContent = rupiah(order.total);
  $("#success-slot").textContent = order.slot || "";
  $("#success-slot-row").hidden = !order.slot;

  const wa = $("#wa-link");
  wa.hidden = !state.store.whatsapp;
  wa.href = `https://wa.me/${state.store.whatsapp}?text=${encodeURIComponent(whatsappMessage(orderId, order))}`;

  $("#success-sheet").showModal();
}

function whatsappMessage(orderId, order) {
  const lines = [
    `Halo ${state.store.name}! Saya sudah pesan lewat website:`,
    "",
    `ID Pesanan: ${orderId}`,
    `Nama: ${order.customer.name}`,
    `Penerimaan: ${order.typeLabel}`,
  ];
  if (order.slot) lines.push(`Jadwal: ${order.slot}`);
  if (order.batch) lines.push(`Batch: ${order.batch}`);
  if (order.address) lines.push(`Alamat: ${order.address}`);
  lines.push("");
  for (const item of order.items) {
    lines.push(`- ${item.name} (${item.qty}x)${item.note ? ` [${item.note}]` : ""} : ${rupiah(item.lineTotal)}`);
  }
  lines.push("");
  lines.push(`Total: ${rupiah(order.total)}`, `Pembayaran: ${order.paymentLabel} (bukti sudah saya unggah di website)`);
  if (order.notes) lines.push(`Catatan: ${order.notes}`);
  lines.push("", "Mohon dicek ya. Terima kasih!");
  return lines.join("\n");
}
