const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const CART_KEY = "disumpel_cart_v1";
const CUSTOMER_KEY = "disumpel_customer_v1";
const REF_KEY = "disumpel_order_ref_v1";
const ALL = "Semua";
const PHONE_RE = /^(?:\+?62|0)8\d{7,12}$/;

const ICON_PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 4v16m8-8H4"/></svg>`;
const ICON_MINUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M20 12H4"/></svg>`;

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
  paymentMethods: [],
  category: ALL,
  activeIndex: 0,
  cart: load(CART_KEY, {}), // { [menuId]: { qty, note } }
  ref: load(REF_KEY, null),
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
    state.paymentMethods = data.paymentMethods;
  } catch (err) {
    console.error(err);
    $("#track").innerHTML = `<p class="lines-empty">Gagal memuat menu. <button type="button" class="reset-btn" id="retry" style="color:var(--brand)">Coba lagi</button></p>`;
    $("#retry").addEventListener("click", () => location.reload());
    return;
  }

  pruneCart();
  renderStore();
  renderCategories();
  renderMenu();
  renderCheckoutOptions();
  renderCart();
  bindEvents();
}

// Buang item keranjang lama yang sudah tidak ada / sedang habis, dan sesuaikan dengan sisa kuota.
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

  const schedule = [
    store.schedule && `Jadwal: ${store.schedule}`,
    isOpen() && store.closeAt && `PO tutup ${deadlineFormat.format(new Date(store.closeAt))}`,
  ].filter(Boolean);
  $("#store-schedule").innerHTML = schedule.map((part) => `<span>${esc(part)}</span>`).join(" · ");
  $("#store-schedule").hidden = !schedule.length;
  $("#schedule-info").textContent = store.schedule ? `Jadwal ambil/kirim: ${store.schedule}` : "";

  $("#arch-title").textContent = store.headline || "";
  $("#arch-sub").textContent = store.subheadline || "";
  $("#perks").innerHTML = (store.perks || []).map((perk) => `<li>✓ ${esc(perk)}</li>`).join("");
}

function categories() {
  return [...new Set(state.menu.map((item) => item.category))];
}

function renderCategories() {
  $("#categories").innerHTML = [ALL, ...categories()]
    .map((cat) => `<button type="button" class="cat" data-cat="${esc(cat)}" aria-pressed="${cat === state.category}">${esc(cat)}</button>`)
    .join("");
}

function visibleMenu() {
  return state.menu.filter((item) => state.category === ALL || item.category === state.category);
}

function renderMenu() {
  const items = visibleMenu();
  const track = $("#track");
  track.innerHTML = items.map(cardHTML).join("");
  track.scrollLeft = 0;
  state.activeIndex = 0;

  $("#dots").innerHTML = items
    .map((item, i) => `<button type="button" class="dot" data-dot="${i}" aria-label="Lihat ${esc(item.name)}"${i === 0 ? ' aria-current="true"' : ""}></button>`)
    .join("");
}

function photoHTML(item) {
  return item.image
    ? `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" decoding="async">`
    : `<span class="emoji" role="img" aria-label="${esc(item.name)}">${esc(item.emoji || "🥟")}</span>`;
}

function cardHTML(item) {
  const badge = item.badge ? `<span class="tag tag-${esc(item.badge.tone || "orange")}">${esc(item.badge.text)}</span>` : "";
  const stock = item.available && item.remaining != null ? `<span class="tag tag-stock">Sisa ${item.remaining}</span>` : "";
  return `<article class="product${item.available ? "" : " is-soldout"}">
    ${badge}${stock}
    <div class="photo">${photoHTML(item)}</div>
    <h3 class="product-name">${esc(item.name)}</h3>
    <p class="product-desc">${esc(item.description || "")}</p>
    <div class="product-foot">
      <div>
        <span class="price-label">${esc(item.priceLabel || "Harga")}</span>
        <span class="price">${rupiah(item.price)}</span>
      </div>
      <div data-slot="${esc(item.id)}">${controlsHTML(item)}</div>
    </div>
  </article>`;
}

function controlsHTML(item) {
  if (!item.available) return `<span class="soldout">Habis</span>`;
  const qty = state.cart[item.id]?.qty || 0;
  if (!qty) {
    return `<button type="button" class="add-btn" data-action="inc" data-id="${esc(item.id)}" aria-label="Tambah ${esc(item.name)} ke pesanan">${ICON_PLUS}</button>`;
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
    ? "Belum ada item dipilih"
    : entries.length === 1
      ? `${entries[0].qty}x ${entries[0].item.name}`
      : `${count} Item Pesanan Siap Disumpel`;
  $("#cart-total").textContent = rupiah(subtotal);
  $("#reset-cart").disabled = !count;

  $("#order-btn").disabled = !isOpen();
  $("#order-btn-label").textContent = isOpen() ? "Pesan Sekarang" : state.store.statusClosed;

  const list = $("#sheet-items");
  preserveFocus(list, () => {
    list.innerHTML = entries.length
      ? entries.map(lineHTML).join("")
      : `<div class="lines-empty"><span aria-hidden="true">🥟</span>Belum ada menu dipilih.<br>Tutup dan geser menu untuk menambah.</div>`;
  });
  syncCheckout();
}

function lineHTML({ item, qty, note }) {
  return `<div class="line">
    <div class="line-thumb" aria-hidden="true">${item.image ? `<img src="${esc(item.image)}" alt="">` : `<span class="emoji">${esc(item.emoji || "🥟")}</span>`}</div>
    <div>
      <div class="line-name">${esc(item.name)}</div>
      <div class="line-price">${rupiah(item.price * qty)}</div>
      <input class="line-note" data-note="${esc(item.id)}" value="${esc(note)}" maxlength="100"
        placeholder="Catatan, mis. saus dipisah" aria-label="Catatan untuk ${esc(item.name)}">
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
        <span>${esc(type.label)}<small>${esc(type.hint || (type.fee ? `Ongkir ${rupiah(type.fee)}` : "Tanpa ongkir"))}</small></span>
      </label>`
    )
    .join("");

  $("#payment-options").innerHTML = state.paymentMethods
    .map(
      (method, i) => `<label class="choice">
        <input type="radio" name="payment" value="${esc(method.id)}"${i === 0 ? " checked" : ""}>
        <span>${esc(method.label)}</span>
      </label>`
    )
    .join("");
}

/* ---------- Carousel ---------- */

function cards() {
  return $$("#track .product");
}

function scrollToCard(index) {
  const list = cards();
  const card = list[Math.max(0, Math.min(list.length - 1, index))];
  if (!card) return;
  const track = $("#track");
  track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: "smooth" });
}

function updateActiveDot() {
  const track = $("#track");
  const center = track.scrollLeft + track.clientWidth / 2;
  let best = 0;
  let bestDistance = Infinity;
  cards().forEach((card, i) => {
    const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
    if (distance < bestDistance) [best, bestDistance] = [i, distance];
  });
  if (best === state.activeIndex) return;
  state.activeIndex = best;
  $$("#dots .dot").forEach((dot, i) =>
    i === best ? dot.setAttribute("aria-current", "true") : dot.removeAttribute("aria-current")
  );
}

/* ---------- Interaksi ---------- */

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
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

  $("#categories").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-cat]");
    if (!chip || chip.dataset.cat === state.category) return;
    state.category = chip.dataset.cat;
    $$("#categories .cat").forEach((el) => el.setAttribute("aria-pressed", String(el === chip)));
    renderMenu();
  });

  let ticking = false;
  $("#track").addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        updateActiveDot();
        ticking = false;
      });
    },
    { passive: true }
  );
  $("#dots").addEventListener("click", (event) => {
    const dot = event.target.closest("[data-dot]");
    if (dot) scrollToCard(Number(dot.dataset.dot));
  });
  $$(".hint-btn").forEach((btn) => btn.addEventListener("click", () => scrollToCard(state.activeIndex + Number(btn.dataset.step))));

  $("#reset-cart").addEventListener("click", () => {
    state.cart = {};
    saveCart();
    $$("[data-slot]").forEach((slot) => (slot.innerHTML = controlsHTML(state.byId.get(slot.dataset.slot))));
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

function openCheckout() {
  if (!isOpen()) return toast(`Maaf, ${state.store.statusClosed.toLowerCase()}`);
  if (!cartTotals().count) return toast("Pilih menu dulu ya! Tekan tombol + pada menu 🥟");

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

function syncCheckout() {
  const form = $("#checkout-form");
  if (!state.orderTypes.length) return;
  const type = selectedType(form);
  const payment = state.paymentMethods.find((p) => p.id === form.elements.payment.value);
  const { entries, subtotal } = cartTotals();
  const fee = type.fee || 0;

  $("#address-field").hidden = !type.needsAddress;
  $("#payment-info").textContent = payment?.info || "";
  $("#sum-subtotal").textContent = rupiah(subtotal);
  $("#sum-fee-row").hidden = !fee;
  $("#sum-fee").textContent = rupiah(fee);
  $("#sum-total").textContent = rupiah(subtotal + fee);
  $("#submit-total").textContent = rupiah(subtotal + fee);
  $("#submit-btn").disabled = !entries.length;
}

function validate(form) {
  const name = form.elements.name.value.trim();
  const phone = form.elements.phone.value.replace(/[\s().-]/g, "");
  const address = form.elements.address.value.trim();

  if (name.length < 2) return { field: "name", message: "Nama wajib diisi." };
  if (!PHONE_RE.test(phone)) return { field: "phone", message: "Nomor WhatsApp tidak valid. Contoh: 081234567890." };
  if (selectedType(form).needsAddress && address.length < 10) {
    return { field: "address", message: "Alamat pengantaran wajib diisi dengan lengkap." };
  }
  return null;
}

function showFormError(message, field) {
  const box = $("#form-error");
  box.textContent = message;
  box.hidden = false;
  if (field) {
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
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) throw new Error(result.error || "Pesanan gagal dikirim. Silakan coba lagi.");

    save(CUSTOMER_KEY, { name: data.name, phone: data.phone, address: data.address, type: data.type });
    form.elements.notes.value = "";
    state.cart = {};
    saveCart();
    $$("[data-slot]").forEach((slot) => (slot.innerHTML = controlsHTML(state.byId.get(slot.dataset.slot))));
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
  const payment = state.paymentMethods.find((p) => p.id === order.payment);
  $("#success-id").textContent = orderId;
  $("#success-total").textContent = rupiah(order.total);
  $("#success-payment").textContent = payment?.info || "";

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
    `Ambil/Kirim: ${order.typeLabel}`,
  ];
  if (order.schedule) lines.push(`Jadwal: ${order.schedule}`);
  if (order.address) lines.push(`Alamat: ${order.address}`);
  lines.push("");
  for (const item of order.items) {
    lines.push(`- ${item.name} (${item.qty}x)${item.note ? ` [${item.note}]` : ""} : ${rupiah(item.lineTotal)}`);
  }
  lines.push("");
  if (order.deliveryFee) lines.push(`Ongkir: ${rupiah(order.deliveryFee)}`);
  lines.push(`Total: ${rupiah(order.total)}`, `Pembayaran: ${order.paymentLabel}`);
  if (order.notes) lines.push(`Catatan: ${order.notes}`);
  lines.push("", "Mohon info ketersediaan batch hari ini ya. Terima kasih!");
  return lines.join("\n");
}
