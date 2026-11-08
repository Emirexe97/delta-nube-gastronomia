import { sharedThemeCss } from '@gastronomy/ui/theme';

/** Mobile-first companion UI for floor staff. Session credentials stay in tab memory;
 * only the unsent draft and an uncertain batch's stable request id are persisted. */
export const waiterHtml = String.raw`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <title>Comandas</title>
    <style>
      ${sharedThemeCss}
      :root { font: 16px var(--dn-font-sans, system-ui, -apple-system, 'Segoe UI', sans-serif); color: var(--dn-color-text); background: var(--dn-color-background); }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0 0 env(safe-area-inset-bottom);
        background: var(--dn-color-background);
      }
      button,
      input,
      select,
      textarea {
        font: inherit;
      }
      button {
        border: 0;
        border-radius: var(--dn-radius-control);
        padding: 13px 16px;
        background: var(--dn-color-primary);
        color: white;
        font-weight: 700;
        min-height: 46px;
      }
      button:disabled {
        opacity: 0.45;
      }
      button.secondary { background: var(--dn-color-surface-2); color: var(--dn-color-text-body); border: 1px solid var(--dn-color-border); }
      header {
        position: sticky;
        top: 0;
        background: color-mix(in srgb, var(--dn-color-background) 94%, transparent);
        backdrop-filter: blur(12px);
        padding: 12px 16px;
        border-bottom: 1px solid var(--dn-color-border);
        z-index: 2;
      }
      header h1 {
        font-size: 22px;
        letter-spacing: -.035em;
        margin: 0;
      }
      .brand { color: var(--dn-color-primary); font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
      header small {
        color: var(--dn-color-text-muted);
      }
      main {
        max-width: 600px;
        margin: auto;
        padding: 20px 16px 112px;
      }
      .card {
        background: var(--dn-color-surface);
        border: 1px solid var(--dn-color-border);
        border-radius: var(--dn-radius-card);
        padding: 18px;
        margin: 0 0 16px;
        box-shadow: 0 1px 2px color-mix(in srgb, var(--dn-color-text) 5%, transparent);
      }
      h2 {
        font-size: 17px;
        letter-spacing: -.02em;
        margin: 0 0 12px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .row > * {
        min-width: 0;
      }
      .row > button { flex-shrink: 0; }
      .split {
        justify-content: space-between;
      }
      .muted {
        color: var(--dn-color-text-muted);
        font-size: 14px;
      }
      .status {
        padding: 9px 12px;
        border-radius: 12px;
        background: #e9f1eb;
        color: #28543d;
        margin: 10px 0;
      }
      .status.warn {
        background: #fff1d8;
        color: #754f00;
      }
      .status.error {
        background: #fde9e7;
        color: #9d3028;
      }
      input,
      select,
      textarea {
        border: 1px solid var(--dn-color-border);
        background: var(--dn-color-surface);
        border-radius: var(--dn-radius-control);
        padding: 12px;
        min-height: 46px;
        width: 100%;
      }
      .pin {
        font-size: 22px;
        letter-spacing: 0.2em;
        text-align: center;
      }
      .categories {
        display: flex;
        overflow: auto;
        gap: 8px;
        padding: 2px 0 12px;
      }
      .categories button {
        white-space: nowrap;
        background: var(--dn-color-surface-2);
        color: var(--dn-color-text-body);
        padding: 9px 13px;
        min-height: 44px;
      }
      .categories button.active {
        background: var(--dn-color-primary);
        color: white;
      }
      .product {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 2px;
        border-top: 1px solid #eef0ec;
        gap: 10px;
      }
      .product:first-child {
        border: 0;
      }
      .stepper {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .stepper button {
        min-height: 44px;
        width: 44px;
        padding: 0;
        font-size: 20px;
      }
      .stepper output {
        min-width: 20px;
        text-align: center;
      }
      .line {
        padding: 14px 0;
        border-bottom: 1px solid #eef0ec;
      }
      .line:last-child {
        border: 0;
      }
      .line small {
        display: block;
        color: var(--dn-color-text-muted);
      }
      .sticky {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        background: var(--dn-color-surface);
        border-top: 1px solid var(--dn-color-border);
        display: flex;
        justify-content: center;
        z-index: 3;
      }
      .sticky button {
        width: min(568px, 100%);
      }
      #pendingCard { border-color: #fdba74; background: var(--dn-color-primary-soft); }
      #pendingCard .row { flex-wrap: wrap; }
      #pendingCard, #printCard, #pairMessage, #appMessage { scroll-margin-block: 96px; }
      #pendingCard:focus-visible, #printCard:focus-visible { outline: 2px solid var(--dn-color-primary); outline-offset: 3px; }
      .row h2 { margin: 0; }
      .card > .row + .muted { margin-top: 8px; }
      .product > span { font-weight: 600; line-height: 1.35; }
      #table { font-weight: 650; }
      #draft:has(.line) { border-top: 1px solid var(--dn-color-border); margin-top: 10px; }
      .line textarea { margin-top: 9px; min-height: 44px; resize: vertical; }
      button { cursor: pointer; transition: background-color .16s ease, transform .16s ease; }
      button:not(.secondary):not(.help-trigger):hover:not(:disabled) { background: var(--dn-color-primary-hover); color: white; }
      button.secondary:hover:not(:disabled), .categories button:not(.active):hover:not(:disabled), .help-trigger:hover:not(:disabled) { background: var(--dn-color-primary-soft); color: var(--dn-color-primary-hover); }
      button:active:not(:disabled) { transform: translateY(1px); }
      button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 3px solid var(--dn-color-primary); outline-offset: 2px; }
      .help-wrap { position: relative; display: inline-flex; flex: 0 0 auto; }
      .help-trigger { width: 44px; height: 44px; min-height: 44px; padding: 0; border-radius: 50%; background: var(--dn-color-surface-2); color: var(--dn-color-primary); border: 1px solid var(--dn-color-border); font-weight: 800; }
      .help-popover { position: fixed; z-index: 10; width: min(280px, calc(100vw - 24px)); padding: 12px 14px; border: 1px solid var(--dn-color-border); border-radius: var(--dn-radius-control); background: var(--dn-color-surface); color: var(--dn-color-text-body); box-shadow: var(--dn-shadow-card); font-size: 14px; line-height: 1.45; }
      .help-popover[hidden] { display: none; }
      @media (max-width: 380px) { main { padding-inline: 12px; } .card { padding: 14px; } header { padding-inline: 12px; } .row { gap: 8px; } #pairForm .row { align-items: stretch; } #pairForm button { padding-inline: 12px; } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; scroll-behavior: auto !important; } }
      [hidden] {
        display: none !important;
      }
      #qr {
        display: block;
        max-width: 220px;
        max-height: 220px;
        margin: 12px auto;
      }
      code {
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <header>
      <div class="row split">
        <div><div class="brand">Delta Nube</div><h1>Comandas</h1></div>
        <small id="connection">Sin vincular</small>
      </div>
      <small id="sessionExpiry" class="muted"></small>
    </header>
    <main>
      <section id="pairing" class="card">
        <h2>Ingresar como mozo</h2>
        <p class="muted">Escaneá el QR en caja e ingresá tu PIN.</p>
        <div id="qrbox" hidden><div class="muted" id="qrtext"></div></div>
        <form id="pairForm">
          <div class="row split"><label class="muted" for="pin">PIN</label><span class="help-wrap"><button class="help-trigger" type="button" aria-label="Ayuda sobre el PIN" aria-expanded="false" aria-controls="help-pin">?</button><span class="help-popover" id="help-pin" role="tooltip" hidden>Usá el PIN que te dieron en caja. Si no lo tenés, pedí que te vinculen.</span></span></div>
          <div class="row">
            <input
              id="pin"
              class="pin"
              type="password"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="8"
              required
            /><button type="submit">Vincular</button>
          </div>
        </form>
        <div id="pairMessage" class="status" tabindex="-1" hidden></div>
      </section>
      <section id="app" hidden>
        <div class="card">
          <div class="row split">
            <div>
              <h2 id="welcome">Hola</h2>
            </div>
            <button id="reconnect" type="button">Actualizar</button>
          </div>
          <div id="appMessage" class="status" role="status" tabindex="-1" hidden></div>
          <div class="row split"><label class="muted" for="table">Mesa</label><span class="help-wrap"><button class="help-trigger" type="button" aria-label="Ayuda para elegir mesa" aria-expanded="false" aria-controls="help-table">?</button><span class="help-popover" id="help-table" role="tooltip" hidden>Elegí la mesa antes de agregar productos. El pedido se prepara para esa mesa.</span></span></div>
          <select id="table"></select>
        </div>
        <div id="pendingCard" class="card" role="status" aria-live="polite" tabindex="-1" hidden>
          <h2 id="pendingTitle">Pedido por confirmar</h2>
          <p id="pendingText" class="muted"></p>
          <div class="row">
            <button id="checkPending" type="button">Ver estado</button>
            <button id="retryPending" type="button" hidden>Volver a intentar</button>
            <button id="closeOldPending" class="secondary" type="button" hidden>Quitar aviso anterior</button>
          </div>
        </div>
        <div class="card">
          <div class="row split"><h2>Menú</h2><span class="help-wrap"><button class="help-trigger" type="button" aria-label="Ayuda sobre el menú" aria-expanded="false" aria-controls="help-menu">?</button><span class="help-popover" id="help-menu" role="tooltip" hidden>Elegí una categoría y usá + para sumar productos al pedido.</span></span></div>
          <div id="categories" class="categories"></div>
          <div id="products"></div>
        </div>
        <div class="card">
          <div class="row split">
            <h2>Para enviar</h2>
            <button id="clearDraft" class="secondary" type="button">
              Vaciar
            </button>
          </div>
          <div id="draft"><p class="muted">Elegí los productos del pedido.</p></div>
        </div>
        <div id="printCard" class="card" tabindex="-1" hidden>
          <h2>Último envío</h2>
          <div id="printStatus" class="status" role="status"></div>
        </div>
        <button id="logout" class="secondary" type="button" style="width: 100%">
          Desvincular este dispositivo
        </button>
      </section>
    </main>
    <div id="sendBar" class="sticky" hidden>
      <button id="send" type="button">Enviar pedido</button>
    </div>
    <script>
      (() => {
        'use strict';
        const helpButtons = Array.from(document.querySelectorAll('.help-trigger'));
        function closeHelp(except) {
          for (const button of helpButtons) {
            if (button === except) continue;
            button.setAttribute('aria-expanded', 'false');
            button.dataset.helpPinned = 'false';
            button.removeAttribute('aria-describedby');
            document.getElementById(button.getAttribute('aria-controls')).hidden = true;
          }
        }
        function positionHelp(button, panel) {
          const rect = button.getBoundingClientRect(), margin = 12;
          panel.hidden = false;
          const width = Math.min(280, window.innerWidth - margin * 2);
          panel.style.width = width + 'px';
          const height = panel.getBoundingClientRect().height;
          const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
          const top = rect.bottom + height + margin <= window.innerHeight ? rect.bottom + 8 : Math.max(margin, rect.top - height - 8);
          panel.style.left = left + 'px'; panel.style.top = top + 'px';
        }
        for (const button of helpButtons) {
          const panel = document.getElementById(button.getAttribute('aria-controls'));
          function openHelp() { closeHelp(button); positionHelp(button, panel); button.setAttribute('aria-expanded', 'true'); button.setAttribute('aria-describedby', panel.id); }
          let hoverTimer = 0;
          button.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); openHelp(); });
          button.addEventListener('mouseleave', () => { if (document.activeElement !== button) hoverTimer = setTimeout(() => { if (!panel.matches(':hover')) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-describedby'); } }, 180); });
          button.addEventListener('focus', openHelp);
          button.addEventListener('blur', () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-describedby'); });
          button.addEventListener('click', (event) => { event.stopPropagation(); const shouldOpen = button.dataset.helpPinned !== 'true'; closeHelp(); if (shouldOpen) { button.dataset.helpPinned = 'true'; openHelp(); } });
          panel.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
          panel.addEventListener('mouseleave', () => { if (document.activeElement !== button) { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-describedby'); } });
        }
        document.addEventListener('click', (event) => { if (!event.target.closest('.help-wrap')) closeHelp(); });
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeHelp(); });
        window.addEventListener('resize', () => closeHelp());
        window.addEventListener('scroll', () => closeHelp(), true);
        const API = '/v1/waiter',
          TOKEN_KEY = 'waiter:session:v1';
        function newRequestId() {
          if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
          // Older mobile browsers can lack randomUUID; never fall back to Math.random.
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          bytes[6] = (bytes[6] & 15) | 64;
          bytes[8] = (bytes[8] & 63) | 128;
          const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
          return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
        }
        function createServerClockAnchor(serverNow, monotonicAtReceipt, wallAtReceipt) {
          const serverTime = typeof serverNow === 'string' ? Date.parse(serverNow) : NaN;
          if (!Number.isFinite(serverTime) || !Number.isFinite(monotonicAtReceipt) || !Number.isFinite(wallAtReceipt)) return null;
          return { serverTime, monotonicAtReceipt, wallAtReceipt };
        }
        function estimateServerTimestamp(anchor, monotonicNow, wallNow) {
          if (!anchor || !Number.isFinite(monotonicNow) || !Number.isFinite(wallNow)) return null;
          const elapsed = Math.max(0, monotonicNow - anchor.monotonicAtReceipt, wallNow - anchor.wallAtReceipt);
          const timestamp = anchor.serverTime + elapsed;
          return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
        }
        let DRAFT_KEY = '',
          PENDING_KEY = '',
          WATCH_KEY = '',
          watchTimer = null,
          serverClockAnchor = null;
        const renderedSignatures = new WeakMap();
        function renderIfChanged(node, signature, build) {
          if (renderedSignatures.get(node) === signature) return false;
          build();
          renderedSignatures.set(node, signature);
          return true;
        }
        const safeGet = (store, key) => {
            try {
              return store.getItem(key);
            } catch {
              return null;
            }
          },
          safeSet = (store, key, value) => {
            try {
              store.setItem(key, value);
              return true;
            } catch {
              return false;
            }
          },
          safeRemove = (store, key) => {
            try {
              store.removeItem(key);
            } catch {}
          };
        const fragment = new URLSearchParams(location.hash.slice(1));
        let tenantId = fragment.get('tenant') || safeGet(sessionStorage, 'waiter:tenant:v1') || '',
          terminalId = fragment.get('terminal') || safeGet(sessionStorage, 'waiter:terminal:v1') || '',
          challengeId = fragment.get('challenge') || '';
        if (challengeId) safeRemove(sessionStorage, TOKEN_KEY);
        if (tenantId && terminalId) {
          safeSet(sessionStorage, 'waiter:tenant:v1', tenantId);
          safeSet(sessionStorage, 'waiter:terminal:v1', terminalId);
        }
        if (location.hash) history.replaceState(null, '', location.pathname);
        let token = '',
          state = null,
          selectedCategory = '',
          challenge = null,
          oldShiftNotFoundId = '',
          oldShiftNotFoundSessionId = '',
          busy = false,
          checkingPending = false;
        const el = (id) => document.getElementById(id),
          request = async (path, opts = {}) => {
            const headers = {
              accept: 'application/json',
              ...(opts.body ? { 'content-type': 'application/json' } : {}),
              ...(token ? { authorization: 'Bearer ' + token } : {}),
            };
            const res = await fetch(API + path, {
              ...opts,
              headers: { ...headers, ...opts.headers },
              cache: 'no-store',
            });
            let data = {};
            try {
              data = await res.json();
            } catch {}
            if (!res.ok)
              throw Object.assign(new Error(errorText(data.error) || 'Error de conexión'), {
                status: res.status,
                code: data.error?.code || data.error,
              });
            return data;
          },
          errorText = (e) =>
            e && typeof e === 'object' ? e.message || e.code || 'Error' : String(e || 'Error'),
          waitRequest = async (id) => {
            for (let i = 0; i < 120; i++) {
              const r = await request('/requests/' + encodeURIComponent(id));
              if (r.status === 'completed') {
                if (r.error) {
                  const e = new Error(errorText(r.error));
                  e.code = r.error?.code || '';
                  e.definitive = ['rejected', 'reject', 'invalid_batch'].includes(e.code);
                  throw e;
                }
                return r.result;
              }
              if (r.status === 'failed') {
                const e = new Error(errorText(r.error) || r.status);
                e.code = r.error?.code || '';
                e.definitive = ['rejected', 'reject', 'invalid_batch'].includes(e.code);
                throw e;
              }
              if (r.status === 'expired') throw new Error(errorText(r.error) || r.status);
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            throw new Error('request_timeout');
          },
          waitPair = async (id) => {
            for (let i = 0; i < 120; i++) {
              const r = await request('/pair/' + encodeURIComponent(id), {
                headers: { 'X-Waiter-Challenge': challengeId },
              });
              if (r.status === 'completed') {
                if (r.error) throw new Error(errorText(r.error));
                return r.result;
              }
              if (r.status === 'expired' || r.status === 'failed')
                throw new Error(errorText(r.error) || r.status);
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            throw new Error('request_timeout');
          },
          rpc = async (method, params = {}, stableId = newRequestId()) => {
            try {
              const queued = await request('/rpc', {
                method: 'POST',
                body: JSON.stringify({ requestId: stableId, method, params }),
              });
              return await waitRequest(queued.requestId);
            } catch (error) {
              if (error.status === 401 || error.code === 'unauthorized') {
                token = ''; state = null; safeRemove(sessionStorage, TOKEN_KEY);
                if (watchTimer) clearTimeout(watchTimer);
                el('app').hidden = true; el('sendBar').hidden = true;
                el('pairing').hidden = false; el('connection').textContent = 'Sin vincular';
                setMsg('pairMessage','Tu acceso venció o fue revocado. Escaneá un QR nuevo en caja para continuar.','warn');
              }
              throw error;
            }
          };
        function loadDraft() {
          try {
            const v = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
            return v && typeof v === 'object' && Array.isArray(v.lines)
              ? v
              : { tableId: '', expectedOrderId: null, lines: [] };
          } catch {
            return { tableId: '', expectedOrderId: null, lines: [] };
          }
        }
        let draft = { tableId: '', expectedOrderId: null, lines: [] };
        function saveDraft() {
          try {
            localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
            return true;
          } catch {
            setMsg(
              'appMessage',
              'No se pudo guardar el borrador en este dispositivo. No cierres la pestaña.',
              'error',
            );
            return false;
          }
        }
        function setMsg(id, text, kind = '') {
          const n = el(id);
          n.textContent = text;
          n.className = 'status ' + kind;
          n.hidden = false;
          if (id === 'printStatus') el('printCard').hidden = !!pending();
        }
        function showPending(title, text) {
          el('pendingCard').hidden = false;
          el('pendingTitle').textContent = title;
          el('pendingText').textContent = text;
          el('appMessage').hidden = true;
          el('printCard').hidden = true;
        }
        function revealOrderStatus() {
          const ids = el('app').hidden ? ['pairMessage'] : ['pendingCard', 'printCard', 'appMessage'];
          const target = ids.map(el).find((node) => !node.hidden);
          if (!target) return;
          target.focus({ preventScroll: true });
          target.scrollIntoView({
            block: 'center',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          });
        }
        function primaryAction(hasPending, isBusy, hasLines, isChecking = false) {
          return {
            disabled: isBusy || isChecking || (!hasPending && !hasLines),
            label: isBusy ? 'Enviando…' : isChecking ? 'Consultando…' : hasPending ? 'Ver estado del pedido' : 'Enviar pedido',
          };
        }
        function allProducts() {
          return state?.menu?.products || [];
        }
        function render() {
          if (!state) return;
          el('pairing').hidden = true;
          el('app').hidden = false;
          el('sendBar').hidden = false;
          el('sessionExpiry').textContent = state.validUntil === 'CASH_CLOSE' && state.cashSessionId
            ? 'Hasta el cierre de caja'
            : state.expiresAt
              ? 'Sesión hasta ' + new Date(state.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';
          el('welcome').textContent = 'Hola, ' + (state.waiter?.name || 'mozo/a');
          const locked = busy || !!pending(),
            ts = state.tables || [];
          const sel = el('table');
          const previousDraftTableId = draft.tableId;
          const availableTable = (id) => ts.some((t) => String(t.id) === String(id));
          const missingTable = !!(draft.lines.length && !availableTable(draft.tableId));
          const tableSignature = JSON.stringify([ts, missingTable ? draft.tableId : null]);
          renderIfChanged(sel, tableSignature, () => {
            sel.replaceChildren();
            for (const t of ts) {
              const o = document.createElement('option');
              o.value = String(t.id);
              o.textContent = t.name || t.label || 'Mesa ' + (t.number ?? t.id);
              sel.append(o);
            }
            if (missingTable) {
              const missing = document.createElement('option');
              missing.value = String(draft.tableId);
              missing.textContent = 'Mesa original no disponible';
              missing.selected = true;
              sel.prepend(missing);
            }
          });
          if (draft.tableId && ts.some((t) => String(t.id) === String(draft.tableId)))
            sel.value = draft.tableId;
          else if (draft.lines.length) {
            setMsg(
              'appMessage',
              'La mesa del borrador ya no está disponible. No se cambió automáticamente.',
              'warn',
            );
          } else if (ts.length) {
            draft.tableId = String(ts[0].id);
            sel.value = draft.tableId;
          }
          if (!draft.lines.length) {
            const expectedOrderId =
              ts.find((t) => String(t.id) === String(draft.tableId))?.openOrderId ?? null;
            if (draft.tableId !== previousDraftTableId || draft.expectedOrderId !== expectedOrderId) {
              draft.expectedOrderId = expectedOrderId;
              saveDraft();
            }
          }
          sel.disabled =
            locked ||
            Boolean(draft.lines.length && !ts.some((t) => String(t.id) === String(draft.tableId)));
          const cats = state.menu?.categories || [];
          if (!selectedCategory || !cats.some((c) => String(c.id ?? c) === selectedCategory))
            selectedCategory = String(cats[0]?.id ?? cats[0] ?? '');
          const cs = el('categories');
          const categorySignature = JSON.stringify(cats.map((c) => [String(c.id ?? c), c.name || String(c)]));
          renderIfChanged(cs, categorySignature, () => {
            cs.replaceChildren();
            for (const c of cats) {
              const id = String(c.id ?? c), b = document.createElement('button');
              b.textContent = c.name || String(c);
              b.onclick = () => { selectedCategory = id; render(); };
              cs.append(b);
            }
          });
          Array.from(cs.children).forEach((button, index) => {
            button.className = String(cats[index]?.id ?? cats[index]) === selectedCategory ? 'active' : '';
          });
          const ps = el('products');
          const visibleProducts = allProducts().filter((p) => !p.categoryId || String(p.categoryId) === selectedCategory);
          const productSignature = JSON.stringify([selectedCategory, visibleProducts]);
          const focusedProductId = document.activeElement?.dataset?.productId || '';
          renderIfChanged(ps, productSignature, () => {
            ps.replaceChildren();
            for (const p of visibleProducts) {
              const row = document.createElement('div'); row.className = 'product';
              const info = document.createElement('span'); info.textContent = p.name || p.label || String(p.id);
              const control = document.createElement('div'); control.className = 'stepper';
              const add = document.createElement('button'); add.textContent = '+';
              add.dataset.productId = String(p.id ?? p.productId);
              add.setAttribute('aria-label', 'Agregar ' + info.textContent);
              add.onclick = () => change(p, 1); control.append(add); row.append(info, control); ps.append(row);
            }
          });
          for (const button of ps.querySelectorAll('.stepper button')) button.disabled = locked;
          if (focusedProductId) {
            const matchingButton = Array.from(ps.querySelectorAll('.stepper button')).find((button) => button.dataset.productId === focusedProductId);
            if (matchingButton && document.activeElement !== matchingButton) matchingButton.focus({ preventScroll: true });
          }
          const box = el('draft');
          box.replaceChildren();
          if (!draft.lines.length) {
            const p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'Elegí los productos del pedido.';
            box.append(p);
          }
          for (const line of draft.lines) {
            const p = allProducts().find((x) => String(x.id ?? x.productId) === String(line.productId));
            const row = document.createElement('div');
            row.className = 'line';
            const head = document.createElement('div');
            head.className = 'row split';
            const name = document.createElement('strong');
            name.textContent = (p?.name || line.name || line.productId) + ' × ' + line.quantity;
            const step = document.createElement('div');
            step.className = 'stepper';
            const minus = document.createElement('button');
            minus.textContent = '−';
            minus.disabled = locked;
            minus.onclick = () => change({ id: line.productId }, -1);
            const plus = document.createElement('button');
            plus.textContent = '+';
            plus.disabled = locked;
            plus.onclick = () => change({ id: line.productId }, 1);
            step.append(minus, plus);
            head.append(name, step);
            row.append(head);
            const note = document.createElement('textarea');
            note.maxLength = 300;
            note.placeholder = 'Nota para cocina (opcional)';
            note.setAttribute('aria-label', 'Nota para cocina de ' + (p?.name || line.name || 'este producto'));
            note.value = line.note || '';
            note.disabled = locked;
            note.oninput = () => {
              line.note = note.value;
              saveDraft();
            };
            row.append(note);
            box.append(row);
          }
          el('clearDraft').disabled = locked;
          const action = primaryAction(!!pending(), busy, draft.lines.length > 0, checkingPending);
          el('send').disabled = action.disabled;
          el('send').textContent = action.label;
          el('checkPending').disabled = checkingPending;
          el('send').onclick = pending() ? () => checkPending(true) : sendBatch;
        }
        function change(product, delta) {
          if (pending()) return;
          const id = String(product.id ?? product.productId);
          let line = draft.lines.find((x) => x.productId === id);
          if (!line && delta > 0) {
            if (draft.lines.length >= 80) {
              setMsg('appMessage', 'Podés enviar hasta 80 productos diferentes a la vez.', 'warn');
              return;
            }
            line = {
              lineId: newRequestId(),
              productId: id,
              quantity: 0,
              name: product.name || '',
              note: '',
            };
            draft.lines.push(line);
          }
          if (line) {
            line.quantity = Math.max(0, Math.min(99, line.quantity + delta));
            if (line.quantity <= 0) draft.lines = draft.lines.filter((x) => x !== line);
          }
          saveDraft();
          render();
        }
        function pending() {
          try {
            return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
          } catch {
            return null;
          }
        }
        function readWatch() {
          try {
            return JSON.parse(localStorage.getItem(WATCH_KEY) || 'null');
          } catch {
            return null;
          }
        }
        function saveWatch(value) {
          try {
            if (value) localStorage.setItem(WATCH_KEY, JSON.stringify(value));
            else localStorage.removeItem(WATCH_KEY);
          } catch {
            setMsg(
              'appMessage',
              'No se pudo guardar el seguimiento de impresión. Consultá el estado antes de cerrar.',
              'warn',
            );
          }
        }
        async function refresh() {
          try {
            state = await rpc('waiter.getState');
            serverClockAnchor = createServerClockAnchor(state?.serverNow, performance.now(), Date.now());
            const scope =
              encodeURIComponent(tenantId) +
              ':' +
              encodeURIComponent(terminalId) +
              ':' +
              encodeURIComponent(state.waiter?.id || 'unknown') +
              ':' +
              encodeURIComponent(state.cashSessionId || 'unknown');
            DRAFT_KEY = 'waiter:draft:v1:' + scope;
            // Pending batches outlive a cash-session change/re-pair, but never
            // cross waiter identities on a shared device.
            PENDING_KEY = 'waiter:pending:v1:' +
              encodeURIComponent(tenantId) + ':' +
              encodeURIComponent(terminalId) + ':' +
              encodeURIComponent(state.waiter?.id || 'unknown');
            // Migrate the older cash-session-scoped key once, without replacing
            // an existing pending request for this waiter.
            if (!safeGet(localStorage, PENDING_KEY)) {
              const legacyPendingKey = 'waiter:pending:v1:' + scope;
              const legacyPending = safeGet(localStorage, legacyPendingKey);
              if (legacyPending) {
                safeSet(localStorage, PENDING_KEY, legacyPending);
                safeRemove(localStorage, legacyPendingKey);
              }
            }
            WATCH_KEY = 'waiter:watch:v1:' + scope;
            draft = loadDraft();
            el('connection').textContent = 'En línea';
            el('appMessage').hidden = true;
            render();
            const p = pending();
            if (p) await checkPending();
            else if (readWatch()) await checkPrint();
          } catch (e) {
            el('connection').textContent = 'Desconectado';
            const unauthorized =
              e.status === 401 || e.code === 'unauthorized';
            setMsg(
              'appMessage',
              unauthorized
                ? 'El vínculo expiró o fue revocado. Escaneá un QR vigente para volver a vincular; el borrador se conserva.'
                : 'Sin conexión con caja. Tu pedido sigue guardado; tocá «Actualizar» para comprobarlo.',
              'warn',
            );
            if (unauthorized) {
              token = '';
              safeRemove(sessionStorage, TOKEN_KEY);
              state = null;
              el('app').hidden = true;
              el('pairing').hidden = false;
            }
          }
        }
        async function loadChallenge() {
          challenge = { tenantId, terminalId, challengeId };
          el('qrbox').hidden = true;
          if (!challengeId)
            setMsg('pairMessage', 'Escaneá un QR nuevo en caja para ingresar.', 'warn');
        }
        el('pairForm').onsubmit = async (e) => {
          e.preventDefault();
          if (!challenge) await loadChallenge();
          if (!challengeId) return;
          try {
            const queued = await request('/pair', {
              method: 'POST',
              body: JSON.stringify({ tenantId, terminalId, challengeId, pin: el('pin').value }),
            });
            const result = await waitPair(queued.requestId);
            token = result.sessionToken;
            safeSet(sessionStorage, TOKEN_KEY, token);
            el('pin').value = '';
            challengeId = '';
            await refresh();
          } catch (err) {
            setMsg(
              'pairMessage',
              err.message === 'invalid_pin'
                ? 'PIN incorrecto.'
                : 'No se pudo vincular. Verificá el PIN y volvé a escanear si expiró la invitación.',
              'error',
            );
          }
        };
        el('table').onchange = () => {
          if (busy || pending()) return;
          draft.tableId = el('table').value;
          draft.expectedOrderId =
            (state.tables || []).find((t) => String(t.id) === draft.tableId)?.openOrderId ?? null;
          saveDraft();
        };
        el('clearDraft').onclick = () => {
          if (busy || pending()) return;
          if (!draft.lines.length || confirm('¿Quitar los productos que todavía no enviaste?')) {
            draft = { tableId: draft.tableId, expectedOrderId: draft.expectedOrderId, lines: [] };
            saveDraft();
            render();
          }
        };
        el('reconnect').onclick = refresh;
        async function sendBatch() {
          if (!state || !token || busy || pending() || !draft.lines.length) return;
          if (
            draft.lines.some(
              (x) => x.quantity < 1 || x.quantity > 99 || String(x.note || '').length > 300,
            ) ||
            draft.lines.length > 80
          )
            return;
          busy = true;
          render();
          const record = {
            requestId: newRequestId(),
            // Immutable across retries; the DB uses this to quarantine delayed sends.
            submittedAt: estimateServerTimestamp(serverClockAnchor, performance.now(), Date.now()),
            tableId: draft.tableId,
            expectedOrderId: draft.expectedOrderId ?? null,
            expectedCashSessionId: state.cashSessionId ?? null,
            lines: draft.lines.map((x) => ({ ...x })),
          };
          try {
            localStorage.setItem(PENDING_KEY, JSON.stringify(record));
          } catch {
            busy = false;
            setMsg('appMessage', 'No pudimos guardar el pedido. No se envió; mantené esta pantalla abierta.', 'error');
            render();
            return;
          }
          try {
            await submit(record);
          } catch (err) {
            if (err.definitive)
              updateBatch({ requestId: record.requestId, status: 'rejected', error: err.message });
            else {
              showPending('Comprobá si llegó', 'No pudimos confirmar el envío. Tocá «Ver estado» antes de volver a pedirlo.');
            }
          } finally {
            busy = false;
            render();
            revealOrderStatus();
          }
        }
        async function submit(record) {
          const d = await rpc(
            'waiter.submitBatch',
            {
              requestId: record.requestId,
              tableId: record.tableId,
              expectedOrderId: record.expectedOrderId,
              expectedCashSessionId: record.expectedCashSessionId ?? null,
              submittedAt: record.submittedAt,
              lines: record.lines,
            },
            record.requestId,
          );
          updateBatch(d);
        }
        function applyAccepted(record, d) {
          const sameCashSession =
            record.expectedCashSessionId != null &&
            String(record.expectedCashSessionId) === String(state?.cashSessionId || '');
          const accepted = new Set(
            (Array.isArray(d.acceptedLineIds)
              ? d.acceptedLineIds
              : record.lines.map((x) => x.lineId)
            ).map(String),
          );
          draft.lines = draft.lines.filter((x) => !accepted.has(String(x.lineId)));
          if (sameCashSession && d.orderId) {
            const table = (state.tables || []).find((t) => String(t.id) === String(record.tableId));
            if (table) table.openOrderId = d.orderId;
            if (String(draft.tableId) === String(record.tableId)) draft.expectedOrderId = d.orderId;
          }
          saveDraft();
          safeRemove(localStorage, PENDING_KEY);
          el('pendingCard').hidden = true;
          el('retryPending').hidden = true;
          const s = String(d.status || d.printStatus || '').toLowerCase();
          if (s === 'printed') {
            saveWatch(null);
            setMsg('printStatus', sameCashSession
              ? 'Comanda enviada a la impresora'
              : 'El pedido del turno anterior ya fue confirmado.', sameCashSession ? '' : 'warn');
          } else if (s === 'failed') {
            saveWatch(null);
            setMsg('printStatus', sameCashSession
              ? 'Pedido recibido. Avisá en caja: falló la impresión. No lo vuelvas a enviar.'
              : 'El pedido del turno anterior fue recibido. Avisá en caja: falló la impresión.', 'warn');
          } else if (s === 'recorded') {
            saveWatch(null);
            setMsg('printStatus', 'Pedido registrado en la mesa, sin impresión.');
          } else {
            saveWatch({
              requestId: record.requestId,
              tableId: record.tableId,
              orderId: d.orderId,
              printJobId: d.printJobId,
            });
            setMsg('printStatus', sameCashSession
              ? 'Pedido recibido. Preparando la comanda…'
              : 'Pedido del turno anterior recibido. Preparando la comanda…', '');
            schedulePrintCheck();
          }
          render();
        }
        function updateBatch(d) {
          const record = pending();
          if (!record || d.requestId !== record.requestId) return;
          const status = String(d.status || d.printStatus || '').toLowerCase();
          oldShiftNotFoundId = '';
          oldShiftNotFoundSessionId = '';
          el('closeOldPending').hidden = true;
          if (status === 'pending_review') {
            showPending('Pedido pendiente de revisión', 'Avisá en caja para que revisen el pedido. Todavía no se envió a cocina.');
            el('retryPending').hidden = true;
            render();
            return;
          }
          if (status === 'not_found') {
            const sameCashSession =
              String(record.expectedCashSessionId || '') === String(state?.cashSessionId || '');
            showPending(sameCashSession ? 'El pedido no llegó' : 'Revisá el pedido anterior', sameCashSession
              ? 'Podés volver a intentar este envío. No agregues los productos de nuevo.'
              : 'Es de un turno anterior. No lo reenvíes: consultá en caja.');
            el('retryPending').hidden = !sameCashSession;
            el('closeOldPending').hidden = sameCashSession || !record.expectedCashSessionId;
            if (!sameCashSession && record.expectedCashSessionId) {
              oldShiftNotFoundId = record.requestId;
              oldShiftNotFoundSessionId = String(state?.cashSessionId || '');
            }
            render();
            return;
          }
          const hasAcceptance = Array.isArray(d.acceptedLineIds) && d.acceptedLineIds.length > 0;
          if (
            hasAcceptance ||
            ['accepted', 'recorded', 'printed', 'printing', 'queued', 'recovering', 'receiving', 'failed'].includes(
              status,
            )
          ) {
            applyAccepted(record, d);
          } else if (status === 'rejected' || d.rejected === true) {
            el('pendingCard').hidden = true;
            el('retryPending').hidden = true;
            setMsg(
              'printStatus',
              'El pedido no se agregó. Revisalo con caja antes de enviarlo otra vez.',
              'error',
            );
            safeRemove(localStorage, PENDING_KEY);
            el('printCard').hidden = false;
            render();
          } else {
            showPending('Comprobá si llegó', 'Todavía no pudimos confirmar el pedido. Tocá «Ver estado»; no lo envíes de nuevo.');
            el('retryPending').hidden = true;
            render();
          }
        }
        function closeOldPending() {
          const record = pending();
          if (
            !record ||
            !state ||
            !oldShiftNotFoundId ||
            !oldShiftNotFoundSessionId ||
            record.requestId !== oldShiftNotFoundId ||
            record.expectedCashSessionId == null ||
            String(record.expectedCashSessionId) === String(state.cashSessionId || '') ||
            String(state.cashSessionId || '') !== oldShiftNotFoundSessionId
          ) return;
          const sessionId = String(state.cashSessionId || '');
          if (!confirm(
            '¿Verificaste con caja que el pedido anterior no llegó? Quitar este aviso no cancela un pedido recibido.'
          )) return;
          const current = pending();
          if (
            !current ||
            current.requestId !== record.requestId ||
            current.requestId !== oldShiftNotFoundId ||
            !state ||
            String(state.cashSessionId || '') !== sessionId ||
            sessionId !== oldShiftNotFoundSessionId ||
            String(current.expectedCashSessionId || '') === sessionId
          ) return;
          safeRemove(localStorage, PENDING_KEY);
          oldShiftNotFoundId = '';
          oldShiftNotFoundSessionId = '';
          el('pendingCard').hidden = true;
          el('closeOldPending').hidden = true;
          setMsg(
            'printStatus',
            'Aviso anterior quitado. Los pedidos recibidos no se cancelaron.',
            'warn',
          );
          render();
        }
        async function checkPrint() {
          const w = readWatch();
          if (!w) return;
          try {
            const d = await rpc('waiter.getBatch', { requestId: w.requestId });
            const status = String(d.status || '').toLowerCase();
            setMsg(
              'printStatus',
              status === 'printed'
                ? 'Comanda enviada a la impresora'
                : status === 'recorded'
                  ? 'Pedido registrado en la mesa, sin impresión.'
                : status === 'failed'
                  ? 'Pedido recibido. Avisá en caja: falló la impresión. No lo vuelvas a enviar.'
                  : 'Pedido recibido. Preparando la comanda…',
              status === 'failed' ? 'warn' : '',
            );
            if (status === 'printed' || status === 'failed' || status === 'recorded') {
              saveWatch(null);
              if (watchTimer) {
                clearTimeout(watchTimer);
                watchTimer = null;
              }
            } else schedulePrintCheck();
          } catch {
            setMsg(
              'printStatus',
              'El pedido ya fue recibido. No pudimos comprobar la impresión; consultá en caja.',
              'warn',
            );
            schedulePrintCheck();
          }
        }
        function schedulePrintCheck() {
          if (watchTimer) clearTimeout(watchTimer);
          if (token && state && readWatch()) watchTimer = setTimeout(checkPrint, 5000);
        }
        async function checkPending(reveal = false) {
          const p = pending();
          if (!p || checkingPending) return;
          checkingPending = true;
          oldShiftNotFoundId = '';
          showPending('Consultando pedido…', 'Esperá un momento.');
          el('retryPending').hidden = true;
          el('closeOldPending').hidden = true;
          render();
          if (reveal) revealOrderStatus();
          try {
            const d = await rpc('waiter.getBatch', { requestId: p.requestId });
            updateBatch(d);
          } catch (err) {
            if (String(err.message).toLowerCase().includes('not_found')) {
              // An RPC/relay error is not authoritative proof the durable POS
              // lacks this request; only a successful getBatch result unlocks closure.
              showPending('No pudimos comprobarlo', 'El pedido sigue guardado. Volvé a consultar; no lo envíes de nuevo.');
              return;
            }
            el('closeOldPending').hidden = true;
            showPending('No pudimos comprobarlo', 'El pedido sigue guardado. Volvé a consultar; no lo envíes de nuevo.');
          } finally {
            checkingPending = false;
            render();
            if (reveal) revealOrderStatus();
          }
        }
        el('checkPending').onclick = () => checkPending(true);
        el('closeOldPending').onclick = closeOldPending;
        el('retryPending').onclick = async () => {
          const p = pending();
          if (!p) return;
          el('retryPending').disabled = true;
          try {
            // The relay queue is short-lived. Always ask the durable POS first;
            // an expired transport request does not mean the batch was lost.
            const current = await rpc('waiter.getBatch', { requestId: p.requestId });
            if (String(current.status || '').toLowerCase() !== 'not_found') {
              updateBatch(current);
              return;
            }
            if (
              String(p.expectedCashSessionId || '') !== String(state?.cashSessionId || '')
            ) {
              updateBatch(current);
              return;
            }
            await submit(p);
          } catch (err) {
            if (err.definitive) updateBatch({ requestId: p.requestId, status: 'rejected', error: err.message });
            else
              showPending('Comprobá si llegó', 'No pudimos confirmar el envío. Tocá «Ver estado» antes de volver a pedirlo.');
          } finally {
            el('retryPending').disabled = false;
            revealOrderStatus();
          }
        };
        el('logout').onclick = async () => {
          try {
            await rpc('waiter.revoke');
          } catch {}
          token = '';
          safeRemove(sessionStorage, TOKEN_KEY);
          state = null;
          el('app').hidden = true;
          el('sendBar').hidden = true;
          el('pairing').hidden = false;
          el('connection').textContent = 'Sin vincular';
          if (watchTimer) clearTimeout(watchTimer);
        };
        token = safeGet(sessionStorage, TOKEN_KEY) || '';
        if (token) refresh();
        else loadChallenge();
      })();
    </script>
  </body>
</html>`;
