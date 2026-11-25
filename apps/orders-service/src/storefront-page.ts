import { createHash } from "node:crypto";
import { renderStorefrontCover, storefrontAccentForeground, storefrontCoverCss, storefrontProductCss } from "@gastronomy/ui/storefront-cover";
import { storefrontLayoutCss } from "./storefront-layout.js";

/** A tenant-neutral storefront document. All catalogue/customer data is rendered as text, never HTML. */
const storefrontTemplate = String.raw`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <title>Menú online</title>
    <style>
${storefrontLayoutCss}
    </style>
  </head>
  <body>
    <!-- STOREFRONT_COVER -->
    <section class="order-controls">
      <div class="wrap">
        <div class="topline">
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
    </section>
    <div class="wrap">
      <div id="catalogNotice" class="notice hidden" role="alert"></div>
      <div id="recoveryNotice" class="notice hidden" role="alert"></div>
      <div class="layout">
        <main>
          <div id="catalogTop" class="catalog-jump"></div>
          <div class="section-head">
            <div><h2>La carta</h2><span id="itemCount" class="subtle" role="status" aria-live="polite" aria-atomic="true"></span></div>
            <div class="catalog-tools" id="catalogTools" hidden>
              <label class="catalog-search"><span class="sr-only">Buscar en la carta</span><input id="catalogSearch" type="search" autocomplete="off" placeholder="Buscar por nombre o categoría" aria-controls="menu" /></label>
              <button id="catalogSearchClear" class="catalog-search-clear" type="button" hidden>Limpiar</button>
              <div id="categoryFilters" class="category-filters" role="group" aria-label="Filtros de categoría"></div>
              <label class="sr-only" for="categoryJump">Ir a una categoría</label><select id="categoryJump" class="catalog-nav" aria-label="Ir a una categoría" hidden><option value="">Ir a categoría…</option></select>
            </div>
          </div>
          <div id="menu" class="skeleton">Cargando carta…</div>
        </main>
        <aside class="aside">
          <section class="cartbox" aria-labelledby="cartTitle">
            <h2 id="cartTitle" tabindex="-1">Tu pedido</h2>
            <a class="return-menu" href="#catalogTop">Volver a la carta</a>
            <p class="subtle">Precios en pesos argentinos</p>
            <div id="cart" aria-live="polite"></div>
            <div class="total">
              <span>Total estimado</span>
              <span id="total">$ 0,00</span>
            </div>
            <p class="fee-note">
              El total no incluye el costo de envío.
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
              <p class="confirmation-note">La solicitud queda pendiente hasta que el comercio confirme disponibilidad e importe. Enviar no implica ningún pago.</p>
              <button id="submit" class="primary" type="submit" disabled>Enviar solicitud</button>
              <p id="status" class="status" role="status" aria-live="polite"></p>
              <div id="success" class="success hidden" role="status"></div>
            </form>
          </section>
        </aside>
      </div>
    </div>
    <a id="cartJump" class="cart-jump" href="#cartTitle" hidden>Ver mi pedido</a>
    <script>
      (() => {
        "use strict";
        const byId = (id) => document.getElementById(id);
        const els = {
          menu: byId("menu"),
          cart: byId("cart"),
          total: byId("total"),
          count: byId("itemCount"),
          search: byId("catalogSearch"),
          searchClear: byId("catalogSearchClear"),
          categoryFilters: byId("categoryFilters"),
          categoryJump: byId("categoryJump"),
          tools: byId("catalogTools"),
          cartJump: byId("cartJump"),
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
        const pesos = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
        const money = (value) => pesos.format(value / 100);
        const state = {
          catalog: null,
          cart: new Map(),
          channel: "TAKEAWAY",
          pending: null,
          locked: false,
          priceApproval: false,
          catalogMismatch: false,
          cartIsVisible: false,
          productPhotos: new Map(),
          searchQuery: "",
          activeCategory: "",
          categories: [],
          filterIndex: [],
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
        const fold = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
        function filterMenu() {
          const query = fold(state.searchQuery.trim());
          let visible = 0;
          for (const {section, category, items} of state.filterIndex) {
            const categoryMatch = !state.activeCategory || category === state.activeCategory;
            let sectionVisible = 0;
            if (categoryMatch) {
              for (const {card, text} of items) {
                const matches = !query || text.includes(query);
                if (card.hidden === matches) card.hidden = !matches;
                if (matches) sectionVisible++;
              }
            }
            visible += sectionVisible;
            section.hidden = sectionVisible === 0;
          }
          let empty = els.menu.querySelector(".catalog-no-results");
          if (!visible && state.catalog?.products.length) {
            if (!empty) { empty = make("p", "catalog-no-results", "No encontramos opciones con esos filtros."); els.menu.append(empty); }
            empty.hidden = false;
          } else if (empty) empty.hidden = true;
          els.count.textContent = visible + " " + (visible === 1 ? "opción" : "opciones");
          els.searchClear.hidden = !state.searchQuery;
        }
        function setCategory(value) {
          state.activeCategory = value;
          els.categoryFilters.querySelectorAll(".category-filter").forEach((chip) =>
            chip.setAttribute("aria-pressed", String(chip.dataset.category === value)));
          const index = state.categories.findIndex(([name]) => name === value);
          els.categoryJump.value = index < 0 ? "" : "category-" + index;
          filterMenu();
        }
        function renderCategoryFilters(categories) {
          const focused = els.categoryFilters.contains(document.activeElement) ? document.activeElement.dataset.category : undefined;
          els.categoryFilters.replaceChildren();
          const visibleCategories = categories.slice(0, 8);
          const addFilter = (label, value) => {
            const button = make("button", "category-filter", label);
            button.type = "button";
            button.dataset.category = value;
            button.setAttribute("aria-pressed", String(state.activeCategory === value));
            button.addEventListener("click", () => setCategory(value));
            els.categoryFilters.append(button);
          };
          addFilter("Todos", "");
          visibleCategories.forEach(([category]) => addFilter(category, category));
          if (focused !== undefined) [...els.categoryFilters.children].find(chip => chip.dataset.category === focused)?.focus({preventScroll:true});
        }
        function renderMenu() {
          els.menu.replaceChildren();
          state.filterIndex = [];
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
          state.categories = categories;
          els.menu.classList.remove("skeleton");
          const categoryPrompt = make("option", "", "Todas las categorías");
          categoryPrompt.value = "";
          els.categoryJump.replaceChildren(categoryPrompt);
          els.categoryJump.hidden = categories.length <= 8;
          els.tools.hidden = !categories.length;
          if (!categories.length) {
            els.count.textContent = "";
            els.menu.textContent = "La carta no tiene productos disponibles por el momento.";
            return;
          }
          if (state.activeCategory && !categories.some(([category]) => category === state.activeCategory)) state.activeCategory = "";
          renderCategoryFilters(categories);
          categories.forEach(([category], index) => {
            const option = make("option", "", category);
            option.value = "category-" + index;
            option.selected = state.activeCategory === category;
            els.categoryJump.append(option);
          });
          for (const [index, [category, products]] of categories.entries()) {
            const section = make("section", "category");
            section.id = "category-" + index;
            section.dataset.category = category;
            const heading = make("h3", "", category);
            heading.tabIndex = -1;
            section.append(heading);
            const grid = make("div", "menu-grid");
            const items = [];
            state.filterIndex.push({section, category, items});
            for (const product of products) {
              const photoVersion = state.productPhotos.get(product.productRef);
              const card = make("article", "item dn-product" + (photoVersion ? "" : " dn-product--text-only"));
              items.push({card, text:fold(product.name + " " + category)});
              if (photoVersion) {
                const image = make("img", "dn-product__photo");
                const segment = encodeURIComponent(product.productRef).replace(/[!'()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase());
                image.src = "/media/products/" + segment + ".jpg?v=" + photoVersion;
                image.width = 1200;
                image.height = 900;
                image.alt = "";
                image.sizes = "(max-width: 760px) 46vw, (max-width: 1120px) 32vw, 360px";
                image.loading = "lazy";
                image.decoding = "async";
                const frame = make("figure", "dn-product__photo-wrap");
                frame.append(image);
                image.addEventListener("error", () => {
                  frame.remove();
                  card.classList.add("dn-product--text-only");
                }, { once: true });
                card.append(frame);
              }
              const content = make("div", "dn-product__content");
              content.append(
                make("h4", "dn-product__name", product.name),
                make("p", "dn-product__price", money(priceOf(product))),
              );
              const add = make("button", "add dn-product__add", "Agregar");
              add.type = "button";
              add.disabled = state.locked;
              add.setAttribute("aria-label", "Agregar " + product.name);
              add.addEventListener("click", () => addProduct(product));
              content.append(add);
              card.append(content);
              grid.append(card);
            }
            section.append(grid);
            els.menu.append(section);
          }
          filterMenu();
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
          const quantity = [...state.cart.values()].reduce((sum, item) => sum + item.quantity, 0);
          els.cartJump.hidden = quantity === 0 || state.cartIsVisible;
          els.cartJump.replaceChildren(make("span", "cart-jump__label", quantity ? "Ver mi pedido · " + quantity : "Ver mi pedido"),
            make("span", "cart-jump__total", money(total)));
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
            ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
              ? { signal: AbortSignal.timeout(12000) }
              : {}),
          });
          if (!response.ok) throw Error("No se pudo actualizar la carta.");
          const envelope = await response.json();
          const snapshot = validateCatalog(envelope.snapshot);
          const refs = new Set(snapshot.products.map((product) => product.productRef));
          const productPhotos = new Map();
          if (Array.isArray(envelope.productPhotos)) {
            for (const entry of envelope.productPhotos) {
              if (entry && typeof entry.productRef === "string" && refs.has(entry.productRef) && typeof entry.version === "string" && /^[a-f0-9]{64}$/i.test(entry.version)) {
                productPhotos.set(entry.productRef, entry.version.toLowerCase());
              }
            }
          }
          return { snapshot, productPhotos };
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
        function renderCatalogConflict(latestResult) {
          const latest = latestResult.snapshot;
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
            state.productPhotos = latestResult.productPhotos;
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
            const latestResult = await fetchCatalog();
            renderCatalogConflict(latestResult);
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
              ...(typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
                ? { signal: AbortSignal.timeout(12000) }
                : {}),
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
        els.search.addEventListener("input", () => {
          state.searchQuery = els.search.value;
          filterMenu();
        });
        els.searchClear.addEventListener("click", () => {
          state.searchQuery = "";
          els.search.value = "";
          filterMenu();
          els.search.focus();
        });
        els.categoryJump.addEventListener("change", () => {
          if (!els.categoryJump.value) { setCategory(""); return; }
          const target = byId(els.categoryJump.value);
          if (target) {
            setCategory(target.dataset.category || "");
          }
        });
        const cartBox = document.querySelector(".cartbox");
        if (cartBox && "IntersectionObserver" in window) {
          new IntersectionObserver(([entry]) => {
            state.cartIsVisible = entry.isIntersecting;
            els.cartJump.hidden = !state.cart.size || state.cartIsVisible;
          }, { threshold: 0.15 }).observe(cartBox);
        }
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
            state.pending ||
            state.locked ||
            state.catalogMismatch ||
            refreshingCatalog
          )
            return;
          refreshingCatalog = true;
          try {
            const latestResult = await fetchCatalog();
            const latest = latestResult.snapshot;
            if (
              document.visibilityState !== "visible" ||
              state.pending ||
              state.locked
            )
              return;
            const productsChanged = JSON.stringify(latest.products) !== JSON.stringify(state.catalog?.products);
            const photoProducts = state.cart.size ? (state.catalog?.products ?? []) : latest.products;
            const photoRefs = new Set(photoProducts.map((product) => product.productRef));
            const updatedPhotos = new Map([...latestResult.productPhotos].filter(([ref]) => photoRefs.has(ref)));
            const photosChanged = updatedPhotos.size !== state.productPhotos.size || [...updatedPhotos].some(([ref, version]) => state.productPhotos.get(ref) !== version);
            if (productsChanged && !state.cart.size) {
              state.catalog = latest;
              state.productPhotos = updatedPhotos;
              renderMenu();
              renderCart();
            } else if (photosChanged) {
              state.productPhotos = updatedPhotos;
              renderMenu();
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
            const initial = await fetchCatalog();
            state.catalog = initial.snapshot;
            state.productPhotos = initial.productPhotos;
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

const defaultCover = `<div class="hero">${renderStorefrontCover({ displayName: "Menú online", tagline: "Elegí tus favoritos.", accent: "#9c4329" })}</div>`;
export const storefrontHtml = storefrontTemplate
  .replace("<!-- STOREFRONT_COVER -->", () => defaultCover)
  .replace("</style>", () => `${storefrontCoverCss}\n${storefrontProductCss}\n</style>`);

const inlineScript = [...storefrontHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (inlineScript.length !== 1) throw new Error("Expected exactly one bundled inline storefront script");
export const storefrontScriptCspHash = createHash("sha256").update(inlineScript[0]!).digest("base64");

/** Merchant-controlled branding is text-only; the only style input is a validated color. */
export function renderTenantStorefront(site: { display_name: string; tagline: string; accent: string; design_mode: string; template_key: string | null; has_banner?: boolean | number; has_logo?: boolean | number }, published: boolean): string {
  const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
  const color = /^#[0-9a-fA-F]{6}$/.test(site.accent) ? site.accent : "#1f6f50";
  const accentForeground = storefrontAccentForeground(color);
  const name = esc(site.display_name.slice(0, 80));
  const cover = `<div class="hero">${renderStorefrontCover({
    displayName: site.display_name.slice(0, 80),
    tagline: site.tagline.slice(0, 180) || "Elegí tus favoritos.",
    accent: color,
    bannerSrc: site.has_banner ? "/media/banner.jpg" : null,
    logoSrc: site.has_logo ? "/media/logo.jpg" : null,
    unpublished: !published,
  })}</div>`;
  let html = storefrontTemplate.replace("<title>Menú online</title>", () => `<title>${name} · Pedidos</title>`)
    .replace("--accent: #9c4329;", `--accent: ${color};`).replace("--accent-dark: #71301e;", `--accent-dark: ${color};`)
    .replace("--accent-foreground: #ffffff;", `--accent-foreground: ${accentForeground};`)
    .replace("<!-- STOREFRONT_COVER -->", () => cover)
    .replace("</style>", () => `${storefrontCoverCss}\n${storefrontProductCss}\n</style>`);
  // Do not vary the inline script: its digest is pinned in the CSP for every tenant.
  if (!published) html = html.replace("<h2>La carta</h2>", "<h2>La carta todavía no está publicada</h2>");
  // Developer-owned templates are allowlisted. The custom template key selects a fixed, bundled design.
  if (site.design_mode === "CUSTOM" && site.template_key === "midnight-market-v1") {
    html = html.replace("</style>", `.hero{background-color:#172321}[data-storefront-cover]{--dn-field:#172321;--dn-ivory:#f6f1e8;background:#172321}.item{border-radius:2px;box-shadow:none}.cartbox{border-radius:2px}\n      </style>`);
  }
  return html;
}
