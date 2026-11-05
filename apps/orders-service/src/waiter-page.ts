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
      :root {
        font:
          16px system-ui,
          -apple-system,
          'Segoe UI',
          sans-serif;
        color: #20251f;
        background: #f4f5f0;
        --green: #176b4a;
        --line: #dfe4dc;
        --muted: #68736a;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        padding: 0 0 env(safe-area-inset-bottom);
      }
      button,
      input,
      select {
        font: inherit;
      }
      button {
        border: 0;
        border-radius: 14px;
        padding: 13px 16px;
        background: var(--green);
        color: white;
        font-weight: 700;
        min-height: 46px;
      }
      button:disabled {
        opacity: 0.45;
      }
      header {
        position: sticky;
        top: 0;
        background: #f4f5f0ee;
        backdrop-filter: blur(12px);
        padding: 12px 16px;
        border-bottom: 1px solid var(--line);
        z-index: 2;
      }
      header h1 {
        font-size: 20px;
        margin: 0;
      }
      header small {
        color: var(--muted);
      }
      main {
        max-width: 600px;
        margin: auto;
        padding: 16px 16px 100px;
      }
      .card {
        background: white;
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 16px;
        margin: 0 0 14px;
        box-shadow: 0 4px 16px #18261908;
      }
      h2 {
        font-size: 17px;
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
      .split {
        justify-content: space-between;
      }
      .muted {
        color: var(--muted);
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
      select {
        border: 1px solid #cbd3ca;
        background: white;
        border-radius: 12px;
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
        background: #e5ebe4;
        color: #315440;
        padding: 9px 13px;
        min-height: 40px;
      }
      .categories button.active {
        background: var(--green);
        color: white;
      }
      .product {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
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
        min-height: 38px;
        width: 38px;
        padding: 0;
        font-size: 20px;
      }
      .stepper output {
        min-width: 20px;
        text-align: center;
      }
      .line {
        padding: 12px 0;
        border-bottom: 1px solid #eef0ec;
      }
      .line:last-child {
        border: 0;
      }
      .line small {
        display: block;
        color: var(--muted);
      }
      .sticky {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        background: #fff;
        border-top: 1px solid var(--line);
        display: flex;
        justify-content: center;
        z-index: 3;
      }
      .sticky button {
        width: min(568px, 100%);
      }
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
        <h1>Comandas</h1>
        <small id="connection">Sin vincular</small>
      </div>
      <small id="sessionExpiry" class="muted"></small>
    </header>
    <main>
      <section id="pairing" class="card">
        <h2>Vincular dispositivo</h2>
        <p class="muted">Escaneá el QR de invitación que muestra la caja y escribí tu PIN personal.</p>
        <div id="qrbox" hidden><div class="muted" id="qrtext"></div></div>
        <form id="pairForm">
          <label class="muted" for="pin">PIN</label>
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
        <div id="pairMessage" class="status" hidden></div>
      </section>
      <section id="app" hidden>
        <div class="card">
          <div class="row split">
            <div>
              <h2 id="welcome">Hola</h2>
              <div class="muted">Estado de conexión</div>
            </div>
            <button id="reconnect" type="button">Actualizar</button>
          </div>
          <div id="appMessage" class="status">Conectado</div>
          <label class="muted" for="table">Mesa</label
          ><select id="table"></select>
        </div>
        <div class="card">
          <h2>Menú</h2>
          <div id="categories" class="categories"></div>
          <div id="products"></div>
        </div>
        <div class="card">
          <div class="row split">
            <h2>Borrador</h2>
            <button id="clearDraft" type="button" style="background: #e8ece7; color: #304438">
              Vaciar
            </button>
          </div>
          <div id="draft"><p class="muted">Agregá productos al borrador.</p></div>
        </div>
        <div id="pendingCard" class="card" hidden>
          <h2>Tanda pendiente</h2>
          <p id="pendingText" class="muted"></p>
          <div class="row">
            <button id="checkPending" type="button">Consultar estado</button
            ><button id="retryPending" type="button" hidden>Reintentar misma tanda</button>
            <button id="closeOldPending" type="button" hidden style="background: #e8ece7; color: #304438">Cerrar pendiente del turno anterior</button>
          </div>
        </div>
        <div class="card">
          <h2>Impresión</h2>
          <div id="printStatus" class="status">Sin tandas enviadas</div>
        </div>
        <button id="logout" type="button" style="background: #e8ece7; color: #304438; width: 100%">
          Desvincular este dispositivo
        </button>
      </section>
    </main>
    <div id="sendBar" class="sticky" hidden>
      <button id="send" type="button">Enviar a cocina</button>
    </div>
    <script>
      (() => {
        'use strict';
        const API = '/v1/waiter',
          TOKEN_KEY = 'waiter:session:v1';
        let DRAFT_KEY = '',
          PENDING_KEY = '',
          WATCH_KEY = '',
          watchTimer = null;
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
          busy = false;
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
          rpc = async (method, params = {}, stableId = crypto.randomUUID()) => {
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
        }
        function allProducts() {
          return state?.menu?.products || [];
        }
        function render() {
          if (!state) return;
          el('pairing').hidden = true;
          el('app').hidden = false;
          el('sendBar').hidden = false;
          el('connection').textContent = 'En línea';
          el('sessionExpiry').textContent = state.expiresAt
            ? 'Sesión hasta ' +
              new Date(state.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
          el('welcome').textContent = 'Hola, ' + (state.waiter?.name || 'mozo/a');
          const locked = busy || !!pending(),
            ts = state.tables || [];
          const sel = el('table');
          sel.replaceChildren();
          for (const t of ts) {
            const o = document.createElement('option');
            o.value = String(t.id);
            o.textContent = t.name || t.label || 'Mesa ' + (t.number ?? t.id);
            sel.append(o);
          }
          if (draft.tableId && ts.some((t) => String(t.id) === String(draft.tableId)))
            sel.value = draft.tableId;
          else if (draft.lines.length) {
            const missing = document.createElement('option');
            missing.value = String(draft.tableId);
            missing.textContent = 'Mesa original no disponible';
            missing.selected = true;
            sel.prepend(missing);
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
            draft.expectedOrderId =
              ts.find((t) => String(t.id) === String(draft.tableId))?.openOrderId ?? null;
            saveDraft();
          }
          sel.disabled =
            locked ||
            Boolean(draft.lines.length && !ts.some((t) => String(t.id) === String(draft.tableId)));
          const cats = state.menu?.categories || [];
          if (!selectedCategory || !cats.some((c) => String(c.id ?? c) === selectedCategory))
            selectedCategory = String(cats[0]?.id ?? cats[0] ?? '');
          const cs = el('categories');
          cs.replaceChildren();
          for (const c of cats) {
            const id = String(c.id ?? c),
              b = document.createElement('button');
            b.textContent = c.name || String(c);
            b.className = id === selectedCategory ? 'active' : '';
            b.onclick = () => {
              selectedCategory = id;
              render();
            };
            cs.append(b);
          }
          const ps = el('products');
          ps.replaceChildren();
          for (const p of allProducts().filter(
            (p) => !p.categoryId || String(p.categoryId) === selectedCategory,
          )) {
            const row = document.createElement('div');
            row.className = 'product';
            const info = document.createElement('span');
            info.textContent = p.name || p.label || String(p.id);
            const control = document.createElement('div');
            control.className = 'stepper';
            const add = document.createElement('button');
            add.textContent = '+';
            add.disabled = locked;
            add.setAttribute('aria-label', 'Agregar ' + info.textContent);
            add.onclick = () => change(p, 1);
            control.append(add);
            row.append(info, control);
            ps.append(row);
          }
          const box = el('draft');
          box.replaceChildren();
          if (!draft.lines.length) {
            const p = document.createElement('p');
            p.className = 'muted';
            p.textContent = 'Agregá productos al borrador.';
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
          el('send').disabled = !draft.lines.length || busy || locked;
          el('send').textContent = locked ? 'Tanda pendiente: consultar' : 'Enviar a cocina';
          el('send').onclick = locked ? checkPending : sendBatch;
        }
        function change(product, delta) {
          if (pending()) return;
          const id = String(product.id ?? product.productId);
          let line = draft.lines.find((x) => x.productId === id);
          if (!line && delta > 0) {
            if (draft.lines.length >= 80) {
              setMsg('appMessage', 'Máximo 80 productos diferentes por tanda.', 'warn');
              return;
            }
            line = {
              lineId: crypto.randomUUID(),
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
            setMsg('appMessage', 'Conectado');
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
                : 'Sin conexión. El borrador se conserva; al reconectar consultaremos la tanda pendiente antes de intentar enviar.',
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
          el('qrbox').hidden = false;
          el('qrtext').textContent = challengeId
            ? 'Invitación del local reconocida. Ingresá tu PIN personal.'
            : 'La invitación no está disponible. Escaneá un QR vigente desde la caja.';
          if (!challengeId)
            setMsg('pairMessage', 'El QR es temporal; volvé a escanearlo desde la caja.', 'error');
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
          if (!draft.lines.length || confirm('¿Vaciar el borrador?')) {
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
            requestId: crypto.randomUUID(),
            // Immutable across retries; the DB uses this to quarantine delayed sends.
            submittedAt: new Date().toISOString(),
            tableId: draft.tableId,
            expectedOrderId: draft.expectedOrderId ?? null,
            expectedCashSessionId: state.cashSessionId ?? null,
            lines: draft.lines.map((x) => ({ ...x })),
          };
          try {
            localStorage.setItem(PENDING_KEY, JSON.stringify(record));
          } catch {
            busy = false;
            setMsg('appMessage', 'No se pudo guardar la tanda con seguridad; no se envió.', 'error');
            render();
            return;
          }
          try {
            await submit(record);
          } catch (err) {
            if (err.definitive)
              updateBatch({ requestId: record.requestId, status: 'rejected', error: err.message });
            else {
              el('pendingCard').hidden = false;
              el('pendingText').textContent =
                'No se confirmó. Consultá estado o reintentá con el mismo ID y las mismas líneas.';
              setMsg(
                'appMessage',
                'Envío incierto. Conservamos el identificador y las líneas; no reenviamos automáticamente.',
                'warn',
              );
            }
          } finally {
            busy = false;
            render();
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
              ? 'Tanda impresa'
              : 'Tanda confirmada para un turno anterior. Se limpiaron las líneas aceptadas sin modificar la mesa de esta sesión.', 'warn');
          } else if (s === 'failed') {
            saveWatch(null);
            setMsg('printStatus', sameCashSession
              ? 'Tanda aceptada; falló la impresión. Revisá la impresora.'
              : 'Tanda confirmada para un turno anterior; falló la impresión. Se limpiaron las líneas aceptadas sin modificar la mesa de esta sesión.', 'warn');
          } else {
            saveWatch({
              requestId: record.requestId,
              tableId: record.tableId,
              orderId: d.orderId,
              printJobId: d.printJobId,
            });
            setMsg('printStatus', sameCashSession
              ? 'Tanda aceptada. Impresión: ' + (d.status || 'pendiente')
              : 'Tanda confirmada para un turno anterior. Se limpiaron las líneas aceptadas sin modificar la mesa de esta sesión. Impresión: ' + (d.status || 'pendiente'), 'warn');
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
            el('pendingCard').hidden = false;
            el('pendingText').textContent =
              'Tanda demorada o con hora no verificable. Esperando confirmación de caja; todavía no se envió a cocina.';
            el('retryPending').hidden = true;
            setMsg('printStatus', 'Pendiente de revisión en caja; aún no enviada a cocina.', 'warn');
            render();
            return;
          }
          if (status === 'not_found') {
            el('pendingCard').hidden = false;
            const sameCashSession =
              String(record.expectedCashSessionId || '') === String(state?.cashSessionId || '');
            el('pendingText').textContent = sameCashSession
              ? 'El servidor no encontró la tanda. Podés reintentarla con el mismo ID y las mismas líneas.'
              : 'No se encontró en esta sesión de caja. No la reenvíes: consultá en caja usando la mesa y el identificador original.';
            el('retryPending').hidden = !sameCashSession;
            el('closeOldPending').hidden = sameCashSession || !record.expectedCashSessionId;
            if (!sameCashSession && record.expectedCashSessionId) {
              oldShiftNotFoundId = record.requestId;
              oldShiftNotFoundSessionId = String(state?.cashSessionId || '');
            }
            setMsg('printStatus', sameCashSession
              ? 'Tanda sin confirmar; requiere reintento manual.'
              : 'Tanda pendiente de verificación con caja; no se reenviará desde otro turno.', 'warn');
            render();
            return;
          }
          const hasAcceptance = Array.isArray(d.acceptedLineIds) && d.acceptedLineIds.length > 0;
          if (
            hasAcceptance ||
            ['accepted', 'printed', 'printing', 'queued', 'recovering', 'receiving', 'failed'].includes(
              status,
            )
          ) {
            applyAccepted(record, d);
          } else if (status === 'rejected' || d.rejected === true) {
            el('pendingCard').hidden = true;
            el('retryPending').hidden = true;
            setMsg(
              'printStatus',
              'Tanda rechazada: ' + (d.error?.message || d.error || 'revisá el borrador'),
              'error',
            );
            safeRemove(localStorage, PENDING_KEY);
            render();
          } else {
            el('pendingCard').hidden = false;
            el('pendingText').textContent =
              'Envío ' +
              record.requestId +
              ' — ' +
              (status || 'sin confirmar') +
              '. No se volverá a enviar automáticamente.';
            el('retryPending').hidden = true;
            setMsg('printStatus', 'Estado de impresión: ' + (status || 'pendiente'), 'warn');
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
            '¿Consultaste con caja y verificaste que esta tanda no fue recibida? Cerrar el seguimiento en este dispositivo no cancela un pedido que ya haya sido recibido.'
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
            'Seguimiento anterior cerrado en este dispositivo. Esto no cancela un pedido que caja ya haya recibido.',
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
                ? 'Tanda impresa'
                : status === 'failed'
                  ? 'Caja recibió la tanda; revisá la impresora.'
                  : 'Estado de impresión: ' + (d.status || 'pendiente'),
              status === 'failed' ? 'warn' : '',
            );
            if (status === 'printed' || status === 'failed') {
              saveWatch(null);
              if (watchTimer) {
                clearTimeout(watchTimer);
                watchTimer = null;
              }
            } else schedulePrintCheck();
          } catch {
            setMsg(
              'printStatus',
              'No se pudo actualizar el estado de impresión. Se conserva el seguimiento.',
              'warn',
            );
            schedulePrintCheck();
          }
        }
        function schedulePrintCheck() {
          if (watchTimer) clearTimeout(watchTimer);
          if (token && state && readWatch()) watchTimer = setTimeout(checkPrint, 5000);
        }
        async function checkPending() {
          const p = pending();
          if (!p) return;
          oldShiftNotFoundId = '';
          el('pendingCard').hidden = false;
          el('pendingText').textContent = 'Consultando tanda ' + p.requestId + '…';
          el('retryPending').hidden = true;
          el('closeOldPending').hidden = true;
          try {
            const d = await rpc('waiter.getBatch', { requestId: p.requestId });
            updateBatch(d);
          } catch (err) {
            if (String(err.message).toLowerCase().includes('not_found')) {
              // An RPC/relay error is not authoritative proof the durable POS
              // lacks this request; only a successful getBatch result unlocks closure.
              el('pendingText').textContent =
                'No se pudo confirmar el estado. La tanda se conserva; volvé a consultar.';
              return;
            }
            el('closeOldPending').hidden = true;
            el('pendingText').textContent =
              'No se pudo confirmar. Se conserva la misma tanda y el mismo identificador; volvé a consultar.';
          }
        }
        el('checkPending').onclick = checkPending;
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
              el('pendingText').textContent =
                'No se confirmó el reintento. La misma tanda sigue pendiente.';
          } finally {
            el('retryPending').disabled = false;
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
