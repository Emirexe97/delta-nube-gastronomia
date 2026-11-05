import { createHash } from "node:crypto";

/** A tenant-neutral storefront document. All catalogue/customer data is rendered as text, never HTML. */
export const storefrontHtml = String.raw`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Menú online</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #29251f;
        --muted: #756d61;
        --paper: #f7f3eb;
        --card: #fffdf8;
        --line: #ded6c8;
        --accent: #9c4329;
        --accent-dark: #71301e;
        --sage: #435d4b;
        --shadow: 0 16px 42px #382b1a12;
        font-family: Georgia, "Times New Roman", serif;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: radial-gradient(ellipse at 90% 0%, #eadfc9 0, transparent 32rem), var(--paper);
        color: var(--ink);
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1.5;
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      button {
        cursor: pointer;
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.52;
      }
      .wrap {
        max-width: 1120px;
        margin: 0 auto;
        padding: 0 22px;
      }
      .hero {
        padding: 42px 0 28px;
        border-bottom: 1px solid var(--line);
      }
      .eyebrow {
        font-size: 0.74rem;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
        font-weight: 700;
      }
      .hero h1 {
        font:
          clamp(2.5rem, 7vw, 5rem)/0.97 Georgia,
          "Times New Roman",
          serif;
        letter-spacing: -0.045em;
        margin: 0.28rem 0 0.8rem;
      }
      .hero p {
        max-width: 650px;
        margin: 0.35rem 0;
        color: var(--muted);
      }
      .topline {
        display: flex;
        justify-content: space-between;
        gap: 1.5rem;
        align-items: flex-end;
      }
      .channel {
        min-width: 220px;
      }
      .channel label,
      .field label {
        display: block;
        font-size: 0.9rem;
        font-weight: 700;
        margin-bottom: 0.35rem;
      }
      .channel select,
      .field input,
      .field textarea {
        width: 100%;
        border: 1px solid #cfc5b5;
        border-radius: 8px;
        background: #fffdf8;
        color: var(--ink);
        padding: 0.78rem 0.85rem;
      }
      .channel select:focus,
      .field input:focus,
      .field textarea:focus,
      button:focus-visible,
      a:focus-visible {
        outline: 3px solid #c8795f;
        outline-offset: 2px;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        gap: 34px;
        padding: 30px 0 80px;
      }
      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        border-bottom: 1px solid var(--line);
        padding-bottom: 12px;
        margin-bottom: 20px;
      }
      .section-head h2,
      .checkout h2 {
        font:
          2rem Georgia,
          "Times New Roman",
          serif;
        margin: 0;
      }
      .category {
        margin: 28px 0 36px;
      }
      .category h3 {
        font:
          1.38rem Georgia,
          "Times New Roman",
          serif;
        margin: 0 0 12px;
        color: var(--sage);
      }
      .menu-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .item {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 17px 17px 15px;
        box-shadow: var(--shadow);
        display: flex;
        flex-direction: column;
        min-height: 154px;
      }
      .item h4 {
        font:
          1.12rem Georgia,
          "Times New Roman",
          serif;
        margin: 0 0 5px;
      }
      .item .cat {
        font-size: 0.78rem;
        color: var(--muted);
      }
      .item .price {
        font-weight: 700;
        margin: auto 0 12px;
        padding-top: 14px;
      }
      .add,
      .primary {
        border: 0;
        border-radius: 8px;
        background: var(--accent);
        color: white;
        padding: 0.72rem 1rem;
        font-weight: 700;
      }
      .add:hover,
      .primary:hover {
        background: var(--accent-dark);
      }
      .aside {
        position: relative;
      }
      .cartbox {
        position: sticky;
        top: 16px;
        background: #fffdf9;
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 20px;
        box-shadow: var(--shadow);
      }
      .cartbox h2 {
        font:
          1.75rem Georgia,
          "Times New Roman",
          serif;
        margin: 0;
      }
      .subtle {
        font-size: 0.82rem;
        color: var(--muted);
      }
      .cart-empty {
        padding: 18px 0;
        color: var(--muted);
      }
      .cart-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px;
        padding: 12px 0;
        border-bottom: 1px solid #ece6dc;
      }
      .cart-title {
        font-weight: 700;
      }
      .cart-price {
        font-size: 0.85rem;
        color: var(--muted);
      }
      .quantity {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .quantity button {
        width: 32px;
        height: 32px;
        border: 1px solid var(--line);
        border-radius: 50%;
        background: transparent;
        font-size: 1.1rem;
        color: var(--ink);
      }
      .total {
        display: flex;
        justify-content: space-between;
        font-weight: 700;
        font-size: 1.07rem;
        padding: 16px 0 7px;
      }
      .fee-note {
        font-size: 0.77rem;
        color: var(--muted);
        margin: 0 0 16px;
      }
      .checkout {
        border-top: 1px solid var(--line);
        margin-top: 14px;
        padding-top: 16px;
      }
      .checkout h3 {
        font:
          1.25rem Georgia,
          "Times New Roman",
          serif;
        margin: 0 0 12px;
      }
      .field {
        margin: 11px 0;
      }
      .field textarea {
        min-height: 82px;
        resize: vertical;
      }
      .primary {
        width: 100%;
        margin-top: 12px;
      }
      .notice {
        padding: 14px 15px;
        border: 1px solid #d2a96c;
        border-left: 5px solid #c17a2f;
        background: #fff6e6;
        border-radius: 8px;
        margin: 16px 0;
      }
      .notice h2 {
        font:
          1.1rem Georgia,
          "Times New Roman",
          serif;
        margin: 0 0 5px;
      }
      .notice p {
        margin: 0.25rem 0;
      }
      .notice ul {
        margin: 0.35rem 0;
        padding-left: 1.3rem;
      }
      .notice button {
        margin-top: 9px;
      }
      .status {
        min-height: 1.5em;
        font-size: 0.91rem;
        margin: 12px 0 0;
      }
      .status[aria-live] {
        color: var(--sage);
      }
      .success {
        padding: 14px;
        border-radius: 8px;
        background: #eaf1e9;
        border: 1px solid #b8c9b5;
        margin-top: 12px;
      }
      .success a {
        color: var(--accent-dark);
        font-weight: 700;
      }
      .hidden {
        display: none !important;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .skeleton {
        color: var(--muted);
        padding: 2rem 0;
      }
      @media (max-width: 760px) {
        .wrap {
          padding: 0 16px;
        }
        .hero {
          padding-top: 28px;
        }
        .topline {
          align-items: flex-start;
          flex-direction: column;
        }
        .channel {
          width: 100%;
          max-width: 360px;
        }
        .layout {
          grid-template-columns: 1fr;
          gap: 18px;
          padding-top: 18px;
        }
        .menu-grid {
          grid-template-columns: 1fr;
        }
        .item {
          min-height: 132px;
        }
        .aside {
          order: -1;
        }
        .cartbox {
          position: static;
        }
        .cartbox .checkout-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0 12px;
        }
        .cartbox .checkout-grid .wide {
          grid-column: 1/-1;
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .item {
          animation: rise 0.35s both;
        }
        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(7px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      }
    </style>
  </head>
  <body>
    <header class="hero">
      <div class="wrap">
        <div class="topline">
          <div>
            <div class="eyebrow">Carta · pedidos online</div>
            <h1>Menú online</h1>
            <p>
              Elegí tus favoritos. La solicitud queda pendiente hasta que el comercio confirme
              disponibilidad e importe.
            </p>
          </div>
          <div class="channel">
            <label for="channel">¿Cómo lo recibís?</label>
            <select id="channel">
              <option value="TAKEAWAY">Para retirar</option>
              <option value="DELIVERY">Delivery</option>
            </select>
          </div>
        </div>
        <p id="deliveryHint" class="subtle hidden">
          El costo y la zona de envío se confirman al aceptar tu solicitud.
        </p>
      </div>
    </header>
    <div class="wrap">
      <div id="catalogNotice" class="notice hidden" role="alert"></div>
      <div id="recoveryNotice" class="notice hidden" role="alert"></div>
      <div class="layout">
        <main>
          <div class="section-head">
            <h2>La carta</h2>
            <span id="itemCount" class="subtle"></span>
          </div>
          <div id="menu" class="skeleton">Cargando carta…</div>
        </main>
        <aside class="aside">
          <section class="cartbox" aria-labelledby="cartTitle">
            <h2 id="cartTitle">Tu pedido</h2>
            <p class="subtle">Precios en pesos argentinos</p>
            <div id="cart" aria-live="polite"></div>
            <div class="total">
              <span>Total estimado</span>
              <span id="total">$ 0,00</span>
            </div>
            <p class="fee-note">
              El total no incluye delivery. El importe final se confirma con el comercio; enviar no
              implica pago.
            </p>
            <form id="checkout" class="checkout">
              <h3>Tus datos</h3>
              <div class="checkout-grid">
                <div class="field">
                  <label for="customerName">Nombre</label>
                  <input
                    id="customerName"
                    name="name"
                    autocomplete="name"
                    maxlength="120"
                    required
                  />
                </div>
                <div class="field">
                  <label for="customerPhone">Teléfono</label>
                  <input
                    id="customerPhone"
                    name="phone"
                    type="tel"
                    autocomplete="tel"
                    maxlength="30"
                    inputmode="tel"
                    required
                  />
                </div>
                <div id="addressField" class="field wide hidden">
                  <label for="address">Dirección de entrega</label>
                  <textarea
                    id="address"
                    name="address"
                    autocomplete="street-address"
                    maxlength="500"
                  ></textarea>
                </div>
                <div class="field wide">
                  <label for="notes">
                    Notas para el comercio
                    <span class="subtle">(opcional)</span>
                  </label>
                  <textarea id="notes" name="notes" maxlength="1000"></textarea>
                </div>
              </div>
              <p class="subtle">
                Pago: a coordinar con el comercio. No se realiza ningún cobro online.
              </p>
              <button id="submit" class="primary" type="submit" disabled>Enviar solicitud</button>
              <p id="status" class="status" role="status" aria-live="polite"></p>
              <div id="success" class="success hidden" role="status"></div>
            </form>
          </section>
        </aside>
      </div>
    </div>
    <script>
      (() => {
        "use strict";
        const byId = (id) => document.getElementById(id);
        const els = {
          menu: byId("menu"),
          cart: byId("cart"),
          total: byId("total"),
          count: byId("itemCount"),
          channel: byId("channel"),
          address: byId("addressField"),
          addressInput: byId("address"),
          deliveryHint: byId("deliveryHint"),
          form: byId("checkout"),
          submit: byId("submit"),
          status: byId("status"),
          notice: byId("catalogNotice"),
          recovery: byId("recoveryNotice"),
          success: byId("success"),
        };
        const money = (value) =>
          new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
            value / 100,
          );
        const state = {
          catalog: null,
          cart: new Map(),
          channel: "TAKEAWAY",
          pending: null,
          locked: false,
          priceApproval: false,
          catalogMismatch: false,
        };
        const catalogUrl = "/api/catalog",
          checkoutUrl = "/api/checkout",
          storageKey = "web-commerce-checkout-v1";
        function priceOf(product) {
          return state.channel === "DELIVERY"
            ? product.deliveryPriceMinor
            : product.takeawayPriceMinor;
        }
        function announce(message) {
          els.status.textContent = message;
        }
        function make(tag, className, text) {
          const node = document.createElement(tag);
          if (className) node.className = className;
          if (text !== undefined) node.textContent = text;
          return node;
        }
        function lockEdits(locked) {
          state.locked = locked;
          els.channel.disabled = locked;
          els.form.querySelectorAll("input,textarea,button").forEach((control) => {
            if (control.id !== "submit") control.disabled = locked;
          });
          renderMenu();
          renderCart();
          updateSubmit();
        }
        function updateSubmit() {
          els.submit.disabled =
            state.locked ||
            state.catalogMismatch ||
            !state.cart.size ||
            !state.catalog ||
            !state.priceApproval;
        }
        function renderMenu() {
          els.menu.replaceChildren();
          if (!state.catalog) {
            els.menu.textContent = "No se pudo cargar la carta.";
            return;
          }
          const grouped = new Map();
          for (const product of state.catalog.products) {
            if (!grouped.has(product.category)) grouped.set(product.category, []);
            grouped.get(product.category).push(product);
          }
          const categories = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
          if (!categories.length) {
            els.menu.textContent = "La carta no tiene productos disponibles por el momento.";
            return;
          }
          let index = 0;
          for (const [category, products] of categories) {
            const section = make("section", "category");
            const heading = make("h3", "", category);
            section.append(heading);
            const grid = make("div", "menu-grid");
            for (const product of products) {
              const card = make("article", "item");
              card.style.animationDelay = index++ * 35 + "ms";
              card.append(
                make("h4", "", product.name),
                make("span", "cat", category),
                make("div", "price", money(priceOf(product))),
              );
              const add = make("button", "add", "Agregar");
              add.type = "button";
              add.disabled = state.locked;
              add.setAttribute("aria-label", "Agregar " + product.name);
              add.addEventListener("click", () => addProduct(product));
              card.append(add);
              grid.append(card);
            }
            section.append(grid);
            els.menu.append(section);
          }
          els.count.textContent =
            state.catalog.products.length +
            " " +
            (state.catalog.products.length === 1 ? "opción" : "opciones");
        }
        function addProduct(product) {
          if (state.locked) return;
          const old = state.cart.get(product.productRef);
          state.cart.set(product.productRef, {
            productRef: product.productRef,
            name: product.name,
            quantity: (old?.quantity ?? 0) + 1,
          });
          if (!state.catalogMismatch) state.priceApproval = true;
          renderCart();
          updateSubmit();
        }
        function changeQuantity(ref, delta) {
          if (state.locked) return;
          const item = state.cart.get(ref);
          if (!item) return;
          const quantity = item.quantity + delta;
          if (quantity <= 0) state.cart.delete(ref);
          else state.cart.set(ref, { ...item, quantity });
          renderCart();
          updateSubmit();
        }
        function renderCart() {
          els.cart.replaceChildren();
          let total = 0;
          if (!state.cart.size)
            els.cart.append(make("p", "cart-empty", "Todavía no agregaste productos."));
          for (const item of state.cart.values()) {
            const product = state.catalog?.products.find(
              (entry) => entry.productRef === item.productRef,
            );
            const price = product ? priceOf(product) : 0;
            total += price * item.quantity;
            const row = make("div", "cart-row");
            const info = make("div");
            info.append(
              make("div", "cart-title", item.name),
              make("div", "cart-price", product ? money(price) + " c/u" : "Ya no disponible"),
            );
            const controls = make("div", "quantity");
            const minus = make("button", "", "−");
            minus.type = "button";
            minus.disabled = state.locked;
            minus.setAttribute("aria-label", "Quitar una unidad de " + item.name);
            minus.addEventListener("click", () => changeQuantity(item.productRef, -1));
            const quantity = make("span", "", String(item.quantity));
            const plus = make("button", "", "+");
            plus.type = "button";
            plus.disabled = state.locked;
            plus.setAttribute("aria-label", "Agregar una unidad de " + item.name);
            plus.addEventListener("click", () => changeQuantity(item.productRef, 1));
            controls.append(minus, quantity, plus);
            row.append(info, controls);
            els.cart.append(row);
          }
          els.total.textContent = money(total);
          updateSubmit();
        }
        function validateCatalog(snapshot) {
          if (!snapshot || !Array.isArray(snapshot.products))
            throw Error("La carta recibida no es válida.");
          return snapshot;
        }
        async function fetchCatalog() {
          const response = await fetch(catalogUrl, {
            headers: { accept: "application/json" },
            cache: "no-store",
          });
          if (!response.ok) throw Error("No se pudo actualizar la carta.");
          return validateCatalog((await response.json()).snapshot);
        }
        function operationBody() {
          const form = new FormData(els.form);
          const name = String(form.get("name") || "").trim(),
            phone = String(form.get("phone") || "").trim(),
            address = String(form.get("address") || "").trim();
          if (!name || !phone) throw Error("Completá nombre y teléfono.");
          if (state.channel === "DELIVERY" && !address)
            throw Error("Completá la dirección de entrega.");
          const items = [...state.cart.values()].map((item) => {
            const product = state.catalog.products.find(
              (entry) => entry.productRef === item.productRef,
            );
            if (!product) throw Error("Quitá los productos que ya no están disponibles.");
            return {
              productRef: item.productRef,
              name: product.name,
              quantity: item.quantity,
              unitPriceMinor: priceOf(product),
            };
          });
          if (!items.length) throw Error("Agregá al menos un producto.");
          return {
            schemaVersion: 1,
            currency: "ARS",
            customer: { name, phone },
            fulfillment:
              state.channel === "DELIVERY" ? { type: "DELIVERY", address } : { type: "TAKEAWAY" },
            items,
            deliveryFeeMinor: 0,
            paymentMethod: "OTHER",
            ...(String(form.get("notes") || "").trim()
              ? { notes: String(form.get("notes")).trim() }
              : {}),
          };
        }
        function savePending(operation) {
          state.pending = operation;
          try {
            sessionStorage.setItem(storageKey, JSON.stringify(operation));
          } catch {}
          lockEdits(true);
        }
        function clearPending() {
          state.pending = null;
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
          lockEdits(false);
        }
        function showRetry(message) {
          els.recovery.replaceChildren(
            make("h2", "", "Resultado pendiente"),
            make("p", "", message),
          );
          const retry = make("button", "add", "Reenviar la misma solicitud");
          retry.type = "button";
          retry.addEventListener("click", sendPending);
          els.recovery.append(retry);
          els.recovery.classList.remove("hidden");
        }
        function restorePending() {
          try {
            const value = sessionStorage.getItem(storageKey);
            if (!value) return;
            const operation = JSON.parse(value);
            if (
              operation &&
              typeof operation.key === "string" &&
              typeof operation.serialized === "string" &&
              operation.body &&
              typeof operation.body === "object"
            ) {
              state.pending = operation;
              lockEdits(true);
              showRetry(
                "No sabemos si el envío anterior se recibió. Para evitar duplicados, no edites el pedido: podés reenviar exactamente la misma solicitud con la misma clave.",
              );
              announce("Hay un envío cuyo resultado no se pudo confirmar.");
            }
          } catch {}
        }
        function renderCatalogConflict(latest) {
          const available = new Map(
            latest.products.map((product) => [product.productRef, product]),
          );
          const changes = [];
          for (const item of state.cart.values()) {
            const next = available.get(item.productRef);
            const old = state.catalog?.products.find(
              (product) => product.productRef === item.productRef,
            );
            if (!next) changes.push(item.name + " ya no está disponible.");
            else if (
              old &&
              priceOf(old) !==
                (state.channel === "DELIVERY" ? next.deliveryPriceMinor : next.takeawayPriceMinor)
            )
              changes.push(
                item.name +
                  ": " +
                  money(priceOf(old)) +
                  " → " +
                  money(
                    state.channel === "DELIVERY"
                      ? next.deliveryPriceMinor
                      : next.takeawayPriceMinor,
                  ) +
                  ".",
              );
          }
          els.notice.replaceChildren(
            make("h2", "", "La carta cambió"),
            make(
              "p",
              "",
              "Tu selección se conservó y no se envió. Revisá los cambios antes de continuar.",
            ),
          );
          const list = make("ul");
          if (changes.length) for (const change of changes) list.append(make("li", "", change));
          else list.append(make("li", "", "Revisá la disponibilidad y los precios actuales."));
          els.notice.append(list);
          const accept = make("button", "add", "Aceptar nuevos precios y quitar no disponibles");
          accept.type = "button";
          accept.addEventListener("click", () => {
            state.catalog = latest;
            for (const [ref] of state.cart) if (!available.has(ref)) state.cart.delete(ref);
            state.priceApproval = true;
            state.catalogMismatch = false;
            els.notice.classList.add("hidden");
            els.notice.replaceChildren();
            renderMenu();
            renderCart();
            announce("Cambios aceptados. Revisá el total y enviá nuevamente si estás de acuerdo.");
          });
          els.notice.append(accept);
          els.notice.classList.remove("hidden");
          renderCart();
        }
        async function refreshCatalogConflict() {
          try {
            const latest = await fetchCatalog();
            renderCatalogConflict(latest);
          } catch {
            els.notice.replaceChildren(
              make("h2", "", "La carta todavía no está disponible"),
              make(
                "p",
                "",
                "No se volvió a enviar tu solicitud. Tu carrito se conserva y no se puede enviar con precios antiguos. Cuando vuelva la conexión, actualizá la carta para revisar los cambios.",
              ),
            );
            const retry = make("button", "add", "Volver a consultar la carta");
            retry.type = "button";
            retry.addEventListener("click", refreshCatalogConflict);
            els.notice.append(retry);
            els.notice.classList.remove("hidden");
            updateSubmit();
          }
        }
        async function handleCatalogConflict() {
          state.pending = null;
          state.catalogMismatch = true;
          state.priceApproval = false;
          try {
            sessionStorage.removeItem(storageKey);
          } catch {}
          lockEdits(false);
          await refreshCatalogConflict();
        }
        async function sendPending() {
          if (!state.pending || state.sending) return;
          state.sending = true;
          els.submit.disabled = true;
          const operation = state.pending;
          announce("Enviando solicitud…");
          try {
            const response = await fetch(checkoutUrl, {
              method: "POST",
              headers: { "content-type": "application/json", "idempotency-key": operation.key },
              body: operation.serialized,
              cache: "no-store",
            });
            let data = {};
            try {
              data = await response.json();
            } catch {}
            if (response.status === 409 && data.error === "catalog_changed") {
              state.sending = false;
              await handleCatalogConflict();
              return;
            }
            if (response.ok) {
              clearPending();
              state.sending = false;
              state.cart.clear();
              renderCart();
              els.success.replaceChildren(
                make(
                  "strong",
                  "",
                  "Solicitud " + String(data.order?.reference || "recibida") + " recibida.",
                ),
                make(
                  "p",
                  "",
                  "El comercio debe confirmar disponibilidad e importe. No se realizó ningún cobro.",
                ),
              );
              if (typeof data.whatsappUrl === "string") {
                try {
                  const url = new URL(data.whatsappUrl);
                  if (url.protocol === "https:" && url.hostname === "wa.me") {
                    const link = make("a", "", "Abrir WhatsApp");
                    link.href = url.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    els.success.append(link);
                  }
                } catch {}
              }
              els.success.classList.remove("hidden");
              els.recovery.classList.add("hidden");
              announce("Solicitud recibida.");
              return;
            }
            if (response.status >= 400 && response.status < 500) {
              clearPending();
              state.sending = false;
              els.recovery.classList.add("hidden");
              announce("No se pudo aceptar la solicitud. Revisá los datos y volvé a intentarlo.");
              return;
            }
            // A timeout/5xx may happen after durable creation. Keep body and key frozen for a safe retry.
            state.sending = false;
            lockEdits(true);
            showRetry(
              "No se pudo confirmar el resultado. El pedido está bloqueado para evitar duplicados. Reintentá exactamente el mismo envío.",
            );
            announce("No se pudo confirmar el resultado.");
          } catch {
            state.sending = false;
            lockEdits(true);
            showRetry(
              "Se perdió la conexión y no sabemos si el pedido llegó. Reintentá exactamente el mismo envío; no se harán cambios al cuerpo ni a la clave.",
            );
            announce("Se perdió la conexión y no sabemos si el pedido llegó.");
          } finally {
            state.sending = false;
            updateSubmit();
          }
        }
        els.channel.addEventListener("change", () => {
          if (state.locked) return;
          state.channel = els.channel.value;
          els.address.classList.toggle("hidden", state.channel !== "DELIVERY");
          els.addressInput.required = state.channel === "DELIVERY";
          els.deliveryHint.classList.toggle("hidden", state.channel !== "DELIVERY");
          renderMenu();
          renderCart();
        });
        els.form.addEventListener("submit", (event) => {
          event.preventDefault();
          if (state.locked || state.sending) return;
          try {
            const body = operationBody();
            const serialized = JSON.stringify(body);
            const operation = {
              key: crypto.randomUUID().replaceAll("-", "_") + "abcdefgh",
              serialized,
              body,
              createdAt: new Date().toISOString(),
            };
            savePending(operation);
            sendPending();
          } catch (error) {
            announce(error.message || "Revisá los datos ingresados.");
          }
        });
        let refreshingCatalog = false,
          initialized = false;
        async function refreshIdleCatalog() {
          if (
            !initialized ||
            document.visibilityState !== "visible" ||
            state.cart.size ||
            state.pending ||
            state.locked ||
            state.catalogMismatch ||
            refreshingCatalog
          )
            return;
          refreshingCatalog = true;
          try {
            const latest = await fetchCatalog();
            if (
              document.visibilityState !== "visible" ||
              state.cart.size ||
              state.pending ||
              state.locked
            )
              return;
            if (JSON.stringify(latest.products) !== JSON.stringify(state.catalog?.products)) {
              state.catalog = latest;
              renderMenu();
              renderCart();
            }
          } catch {
          } finally {
            refreshingCatalog = false;
          }
        }
        window.addEventListener("focus", refreshIdleCatalog);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") refreshIdleCatalog();
        });
        window.setInterval(refreshIdleCatalog, 45_000);
        async function init() {
          restorePending();
          try {
            state.catalog = await fetchCatalog();
            renderMenu();
            renderCart();
          } catch {
            els.menu.textContent =
              "No pudimos cargar la carta. Revisá tu conexión e intentá recargar la página.";
            announce("Carta no disponible.");
          } finally {
            initialized = true;
          }
        }
        init();
      })();
    </script>
  </body>
</html>
`;

const inlineScript = [...storefrontHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (inlineScript.length !== 1) throw new Error("Expected exactly one bundled inline storefront script");
export const storefrontScriptCspHash = createHash("sha256").update(inlineScript[0]!).digest("base64");

/** Merchant-controlled branding is text-only; the only style input is a validated color. */
export function renderTenantStorefront(site: { display_name: string; tagline: string; accent: string; design_mode: string; template_key: string | null }, published: boolean): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const color = /^#[0-9a-fA-F]{6}$/.test(site.accent) ? site.accent : "#1f6f50";
  const name = esc(site.display_name.slice(0, 80)), tagline = esc(site.tagline.slice(0, 180));
  let html = storefrontHtml.replace("<title>Menú online</title>", () => `<title>${name} · Pedidos</title>`)
    .replace("--accent: #9c4329;", `--accent: ${color};`).replace("--accent-dark: #71301e;", `--accent-dark: ${color};`)
    .replace("<h1>Menú online</h1>", () => `<h1>${name}</h1>`);
  if (tagline) html = html.replace("Elegí tus favoritos. La solicitud queda pendiente hasta que el comercio confirme\n              disponibilidad e importe.", () => `${tagline}\n              La solicitud queda pendiente hasta que el comercio confirme disponibilidad e importe.`);
  // Do not vary the inline script: its digest is pinned in the CSP for every tenant.
  if (!published) html = html.replace("<div class=\"eyebrow\">Carta · pedidos online</div>", "<div class=\"eyebrow\">Tienda en preparación</div>")
    .replace("<h2>La carta</h2>", "<h2>La carta todavía no está publicada</h2>");
  // Developer-owned templates are allowlisted. The custom template key selects a fixed, bundled design.
  if (site.design_mode === "CUSTOM" && site.template_key === "midnight-market-v1") {
    html = html.replace("</style>", `.hero{background:#172321;color:#f6f1e8;padding-top:70px}.hero p{color:#d7dfd3}.eyebrow{color:#e4b85c}.item{border-radius:2px;box-shadow:none}.card{border-radius:2px}\n      </style>`);
  }
  return html;
}
