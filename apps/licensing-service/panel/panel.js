(() => {
  "use strict";
  const API = "/manage/api";
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = {
    csrfToken: "",
    username: "",
    data: null,
    timer: 0,
    dialogAction: null,
    busy: false,
    merchants: {
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
      sandboxEnabled: false,
    },
    merchantQuery: "",
    selectedMerchantId: "",
    merchantDetail: null,
    merchantSearchTimer: 0,
    merchantListRequest: 0,
    merchantDetailRequest: 0,
    dialogIdempotency: null,
  };
  const loginView = $("#loginView");
  const dashboardView = $("#dashboardView");
  const actionDialog = $("#actionDialog");
  const dialogFields = $("#dialogFields");

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = String(value);
    return node;
  }
  function setMessage(message, isError = false) {
    const box = $("#globalMessage");
    box.textContent = message;
    box.classList.toggle("error", isError);
    box.hidden = !message;
  }
  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined)
      headers.set("Content-Type", "application/json");
    if (options.mutate) headers.set("X-Panel-CSRF", state.csrfToken);
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        ...options,
        headers,
        credentials: "same-origin",
        cache: "no-store",
      });
    } catch (_) {
      throw new Error(
        "No se pudo conectar. Revisá tu conexión e intentá nuevamente.",
      );
    }
    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }
    if (response.status === 401 && path !== "/login") {
      showLogin("Tu sesión terminó. Ingresá nuevamente.");
      throw new Error("La sesión expiró.");
    }
    if (!response.ok) {
      const message = data && (data.message || data.error);
      const friendly = {
        sandbox_buyer_only:
          "Usá el correo del comprador de prueba configurado en este entorno.",
        sandbox_disabled: "El ensayo de Mercado Pago no está habilitado.",
        sandbox_subscription_exists:
          "Este comercio ya tiene una adhesión de prueba. Revisala antes de crear otra.",
        sandbox_creation_unconfirmed:
          "No pudimos confirmar la adhesión. Revisá su estado antes de volver a intentarlo.",
        sandbox_creation_rejected:
          "No se creó la adhesión. Revisá las cuentas de prueba, el importe y la configuración de Mercado Pago antes de reintentar.",
        sandbox_provider_unconfirmed:
          "Mercado Pago no confirmó los datos de prueba. No se acreditó ningún período.",
        sandbox_identity_mismatch:
          "La suscripción no corresponde a este comercio de prueba.",
        sandbox_charge_mismatch:
          "La cuota no coincide con la adhesión de este comercio.",
        sandbox_subscription_id_required:
          "Ingresá el identificador de la suscripción de prueba.",
        sandbox_reconcile_first:
          "Primero verificá la suscripción con su identificador de Mercado Pago.",
        revision_conflict:
          "La licencia cambió. Cerrá el formulario y revisá los datos actualizados antes de reintentar.",
        renewal_cannot_shorten:
          "La fecha elegida no puede acortar la vigencia actual.",
        courtesy_must_extend:
          "Para dar una cortesía, elegí una fecha posterior a la vigencia actual.",
        invalid_amount:
          "Ingresá un importe positivo en pesos con hasta dos decimales.",
      };
      const error = new Error(
        Object.hasOwn(friendly, message)
          ? friendly[message]
          : typeof message === "string"
            ? message
            : response.status === 409
              ? "Los datos cambiaron en otra sesión. Actualizamos la información; revisá antes de volver a intentar."
              : "No se pudo completar la operación. Intentá nuevamente.",
      );
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function showLogin(message = "") {
    clearInterval(state.timer);
    state.csrfToken = "";
    state.username = "";
    state.data = null;
    state.merchants = {
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
      sandboxEnabled: false,
    };
    state.merchantQuery = "";
    state.selectedMerchantId = "";
    state.merchantDetail = null;
    state.merchantListRequest++;
    state.merchantDetailRequest++;
    clearTimeout(state.merchantSearchTimer);
    if ($("#merchantSearch")) $("#merchantSearch").value = "";
    if ($("#merchantDetail")) {
      $("#merchantDetail").replaceChildren();
      $("#merchantDetail").hidden = true;
    }
    dashboardView.hidden = true;
    loginView.hidden = false;
    $("#logoutButton").hidden = true;
    $("#loginError").textContent = message;
    $("#loginError").hidden = !message;
    $("#password").value = "";
  }
  function showDashboard(session) {
    if (state.username && state.username !== session.username) showLogin();
    state.csrfToken = session.csrfToken;
    state.username = session.username;
    loginView.hidden = true;
    dashboardView.hidden = false;
    $("#logoutButton").hidden = false;
    loadOverview();
    clearInterval(state.timer);
    state.timer = window.setInterval(() => loadOverview(true), 30000);
  }
  async function loadOverview(silent = false) {
    if (!state.csrfToken) return;
    const focusId = document.activeElement && document.activeElement.id;
    try {
      const data = await request("/overview");
      state.data = data || { requests: [], licenses: [], audit: [] };
      renderOverview();
      await loadMerchants(true);
      $("#updatedAt").textContent =
        `Actualizado ${new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
      if (!silent) setMessage("");
      if (focusId && focusId !== "refreshButton" && !actionDialog.open) {
        const prior = document.getElementById(focusId);
        if (prior) prior.focus({ preventScroll: true });
      }
    } catch (error) {
      if (error.status === 401) return;
      if (!silent) setMessage(error.message, true);
    }
  }
  function idempotencyKey() {
    return typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  function idempotencyFor(payload) {
    const signature = JSON.stringify(payload);
    if (
      !state.dialogIdempotency ||
      state.dialogIdempotency.signature !== signature
    )
      state.dialogIdempotency = { signature, key: idempotencyKey() };
    return state.dialogIdempotency.key;
  }
  function accessBadge(status) {
    const labels = {
      ACTIVE: "Activo",
      GRACE: "Gracia",
      EXPIRED: "Vencido",
      SUSPENDED: "Suspendido",
      PENDING_ACTIVATION: "Pendiente de activación",
    };
    return el(
      "span",
      `status access-${String(status || "").toLowerCase()}`,
      labels[status] || "Sin estado",
    );
  }
  function chargeSummary(merchant) {
    return el("span", "manual-mode", "Manual");
  }
  async function loadMerchants(silent = false) {
    if (!state.csrfToken || !$("#merchantsBody")) return;
    const requestId = ++state.merchantListRequest;
    const q = encodeURIComponent(state.merchantQuery);
    try {
      const data = await request(
        `/merchants?query=${q}&limit=25&offset=${state.merchants.offset}`,
      );
      if (requestId !== state.merchantListRequest || !state.csrfToken) return;
      state.merchants = { ...state.merchants, ...data };
      renderMerchants();
      if (
        state.selectedMerchantId &&
        data.items.some((item) => item.id === state.selectedMerchantId)
      )
        await loadMerchantDetail(state.selectedMerchantId, true);
      else if (state.selectedMerchantId) {
        state.selectedMerchantId = "";
        state.merchantDetail = null;
        $("#merchantDetail").replaceChildren();
        $("#merchantDetail").hidden = true;
      }
      const notice = $("#sandboxNotice");
      notice.hidden = !!data.sandboxEnabled;
      notice.textContent =
        "Ensayo de adhesión deshabilitado: falta configuración. No se realizarán operaciones de cobro automático.";
    } catch (error) {
      if (!silent && error.status !== 401) setMessage(error.message, true);
    }
  }
  function renderMerchants() {
    const body = $("#merchantsBody");
    body.replaceChildren();
    const items = state.merchants.items || [];
    for (const merchant of items) {
      const row = el("tr", "merchant-row");
      const identity = el("div", "merchant-identity");
      identity.append(
        el("strong", "", merchant.businessName || "Comercio sin nombre"),
      );
      identity.append(
        el(
          "span",
          "secondary-line",
          merchant.accountEmail || "Sin correo de cuenta",
        ),
      );
      if (merchant.installationId)
        identity.append(
          el("span", "secondary-line", `Equipo ${merchant.installationId}`),
        );
      tableCell(row, identity);
      const access = el("div", "merchant-access");
      access.append(
        accessBadge(merchant.accessStatus),
        el(
          "span",
          "secondary-line",
          merchant.trial?.startedAt === null
            ? "Pendiente del primer ingreso"
            : merchant.trial?.endsAt
              ? `Prueba hasta ${formatDate(merchant.trial.endsAt)} · ${Math.max(0,Math.ceil((Date.parse(merchant.trial.endsAt)-Date.now())/86400000))} días`
              : `Vigente hasta ${isIndefinite(merchant.paidThrough) ? "sin vencimiento" : formatDate(merchant.paidThrough)}`,
        ),
      );
      tableCell(row, access);
      tableCell(row, chargeSummary(merchant));
      const payment = merchant.lastPayment;
      const last = payment
        ? `${formatDate(payment.createdAt)} · ${formatArs(payment.amountCents)}`
        : "Sin pagos registrados";
      tableCell(row, el("span", "secondary-line", last));
      const actions = el("div", "merchant-actions");
      actions.append(
        makeButton("Ver detalle", "button-small button-outline", () => {
          state.selectedMerchantId = merchant.id;
          state.merchantDetail = null;
          $("#merchantDetail").replaceChildren();
          $("#merchantDetail").hidden = true;
          loadMerchantDetail(merchant.id);
        }),
      );
      tableCell(row, actions);
      body.append(row);
    }
    $("#merchantsEmpty").hidden = items.length > 0;
    $("#merchantCount").textContent = `${state.merchants.total || 0} comercios`;
    const page = Math.floor((state.merchants.offset || 0) / 25) + 1;
    $("#merchantsPage").textContent = `Página ${page}`;
    $("#merchantsPrev").disabled = state.merchants.offset <= 0;
    $("#merchantsNext").disabled =
      state.merchants.offset + items.length >= state.merchants.total;
  }
  function formatArs(cents) {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format((Number(cents) || 0) / 100);
  }
  function localDateInput(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  function sandboxPaymentLabel(value) {
    const labels = {
      APPROVED: "Aprobado",
      REVERSED: "Revertido",
      REJECTED: "Rechazado",
      PENDING: "Pendiente",
    };
    return labels[value] || "Para revisar";
  }
  async function loadMerchantDetail(id, silent = false) {
    const requestId = ++state.merchantDetailRequest;
    try {
      const result = await request(`/merchants/${encodeURIComponent(id)}`);
      if (
        requestId !== state.merchantDetailRequest ||
        id !== state.selectedMerchantId ||
        !state.csrfToken
      )
        return;
      state.merchantDetail = result;
      renderMerchantDetail();
    } catch (error) {
      if (!silent) setMessage(error.message, true);
    }
  }
  function renderMerchantDetail() {
    const pane = $("#merchantDetail"),
      data = state.merchantDetail;
    if (!data || !data.merchant) {
      pane.hidden = true;
      return;
    }
    pane.hidden = false;
    pane.replaceChildren();
    const merchant = data.merchant;
    const heading = el("div", "merchant-detail-heading");
    const title = el("div"),
      detailTitle = el("h3", "", merchant.businessName || "Comercio");
    detailTitle.id = "merchantDetailTitle";
    title.append(
      el("p", "eyebrow", "FICHA DEL COMERCIO"),
      detailTitle,
      el(
        "span",
        "secondary-line",
        merchant.accountEmail || "Sin correo de cuenta",
      ),
      el(
        "span",
        "secondary-line",
        merchant.installationId
          ? `Equipo vinculado: ${merchant.installationId}`
          : "Sin equipo vinculado",
      ),
    );
    const close = makeButton(
      "Cerrar detalle",
      "button-small button-outline",
      () => {
        state.selectedMerchantId = "";
        state.merchantDetail = null;
        pane.hidden = true;
      },
    );
    heading.append(title, close);
    pane.append(heading);
    const status = el("div", "merchant-status-grid");
    const access = el("article", "merchant-status-card");
    access.append(
      el("span", "stat-label", "ACCESO AL PROGRAMA"),
      accessBadge(merchant.accessStatus),
      el(
        "span",
        "secondary-line",
        merchant.trial?.startedAt === null
          ? "Pendiente del primer ingreso"
          : merchant.trial?.endsAt
            ? `Prueba hasta ${formatDate(merchant.trial.endsAt)} · ${Math.max(0,Math.ceil((Date.parse(merchant.trial.endsAt)-Date.now())/86400000))} días`
            : `Vigente hasta ${isIndefinite(merchant.paidThrough) ? "sin vencimiento" : formatDate(merchant.paidThrough)}`,
      ),
    );
    const charge = el("article", "merchant-status-card");
    charge.append(
      el("span", "stat-label", "COBRO REAL"),
      el("span", "manual-mode", "Modalidad: Manual"),
      el(
        "span",
        "secondary-line",
        merchant.lastPayment
          ? `Último pago registrado ${formatArs(merchant.lastPayment.amountCents)} · ${formatDate(merchant.lastPayment.createdAt)}`
          : "Sin pagos registrados",
      ),
    );
    status.append(access, charge);
    pane.append(status);
    const buttons = el("div", "merchant-detail-actions");
    buttons.append(
      makeButton("Registrar pago ARS", "button-small button-primary", () =>
        openMerchantPayment(merchant),
      ),
    );
    buttons.append(
      makeButton("Cargar cortesía", "button-small button-outline", () =>
        openMerchantCourtesy(merchant),
      ),
    );
    buttons.append(
      makeButton(
        merchant.status === "SUSPENDED"
          ? "Reactivar acceso"
          : "Suspender acceso",
        "button-small button-outline",
        () => openMerchantStatus(merchant),
      ),
    );
    buttons.append(
      makeButton(
        merchant.accountEmail ? "Restablecer contraseña" : "Crear cuenta",
        "button-small button-outline",
        () => openAccountDialog(merchant),
      ),
    );
    pane.append(buttons);
    const history = el("div", "merchant-history");
    history.append(el("h4", "", "Historial"));
    const actionLabels = {
      MERCHANT_CREATED: "Comercio creado",
      MANUAL_PAYMENT_RECORDED: "Pago manual registrado",
      COURTESY_RECORDED: "Cortesía aplicada",
      LICENSE_SUSPENDED: "Acceso suspendido",
      LICENSE_REACTIVATED: "Acceso reactivado",
      LICENSE_RENEWED: "Vigencia renovada",
      ACCOUNT_CREDENTIALS_SET: "Credenciales de cuenta actualizadas",
      ACCOUNT_DEVICE_ACTIVATED: "Equipo activado",
      REQUEST_APPROVED: "Equipo aprobado",
      REQUEST_REJECTED: "Solicitud rechazada",
    };
    for (const entry of data.history || []) {
      const line = el("article", "history-entry");
      line.append(el("span", "history-dot", "•"));
      const copy = el("div");
      copy.append(
        el(
          "strong",
          "",
          actionLabels[entry.action] ||
            (entry.action || "Actividad").replaceAll("_", " "),
        ),
        el(
          "span",
          "secondary-line",
          `${formatDate(entry.createdAt)}${entry.amountCents != null ? ` · ${formatArs(entry.amountCents)}` : ""}${entry.actor ? ` · Operador: ${entry.actor}` : ""}`,
        ),
      );
      if (entry.reason) copy.append(el("p", "", entry.reason));
      line.append(copy);
      history.append(line);
    }
    if (!(data.history || []).length)
      history.append(el("p", "empty-inline", "Todavía no hay actividad."));
    pane.append(history);
    if (data.sandboxEnabled)
      renderSandbox(merchant, data.sandbox || merchant.sandbox, pane);
  }
  function renderSandbox(merchant, sandbox, pane) {
    const section = el("section", "sandbox-card");
    section.append(
      el("p", "eyebrow", "ENSAYO AISLADO · SIN IMPACTO REAL"),
      el("h4", "", "Adhesión de prueba"),
    );
    section.append(
      el(
        "p",
        "muted",
        "Usa el entorno sandbox: no cobra al comprador, no cambia el acceso ni registra pagos reales.",
      ),
    );
    if (sandbox) {
      const labels = {
        PENDING: "Pendiente",
        AUTHORIZED: "Autorizada (prueba)",
        PAUSED: "Pausada",
        CREATING: "Creando enlace",
        REVIEW: "Requiere revisión",
        CANCELLED: "Cancelada",
      };
      section.append(
        el(
          "span",
          "sandbox-status",
          `Prueba: ${labels[sandbox.status] || sandbox.status}`,
        ),
        el(
          "p",
          "secondary-line",
          `${sandbox.payerEmail || "Sin email"} · ${formatArs(sandbox.amountCents)} mensuales · vigencia simulada ${sandbox.paidThrough ? formatDate(sandbox.paidThrough) : "pendiente"}`,
        ),
      );
      if (sandbox.lastPaymentStatus)
        section.append(
          el(
            "p",
            `sandbox-payment-status status-${String(sandbox.lastPaymentStatus).toLowerCase()}`,
            `Último resultado de pago de prueba: ${sandboxPaymentLabel(sandbox.lastPaymentStatus)}`,
          ),
        );
      if (sandbox.checkoutUrl) {
        const a = el("a", "sandbox-link", "Abrir enlace de prueba");
        a.href = sandbox.checkoutUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        section.append(a);
      }
      if (sandbox.reference || sandbox.providerId)
        section.append(
          el(
            "p",
            "field-help",
            `Referencia de proveedor: ${sandbox.reference || "sin referencia"}${sandbox.providerId ? ` · ID ${sandbox.providerId}` : ""}. Si requiere revisión, confirmá los identificadores con el proveedor antes de conciliar.`,
          ),
        );
      section.append(
        makeButton("Verificar ensayo", "button-small button-outline", () =>
          openSandboxReconcile(merchant, sandbox),
        ),
      );
      if (sandbox.status !== "CANCELLED")
        section.append(
          makeButton(
            "Cancelar prueba",
            "button-small button-outline button-danger",
            () => cancelSandbox(merchant),
          ),
        );
      else
        section.append(
          makeButton(
            "Crear otro enlace de adhesión de prueba",
            "button-small button-outline",
            () => openSandboxDialog(merchant),
          ),
        );
    } else
      section.append(
        makeButton(
          "Crear enlace de adhesión de prueba",
          "button-small button-outline",
          () => openSandboxDialog(merchant),
        ),
      );
    pane.append(section);
  }
  function formatDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Sin fecha";
    return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(
      date,
    );
  }
  function isIndefinite(value) {
    return value && String(value).startsWith("9999-01-01");
  }
  function statusBadge(status) {
    const labels = {
      PENDING: "Pendiente",
      APPROVED: "Aprobada",
      REJECTED: "Rechazada",
      ACTIVE: "Activa",
      SUSPENDED: "Suspendida",
    };
    const node = el(
      "span",
      `status status-${String(status || "").toLowerCase()}`,
      labels[status] || "Sin estado",
    );
    return node;
  }
  function tableCell(row, content) {
    const cell = el("td");
    cell.append(content);
    row.append(cell);
    return cell;
  }
  function makeButton(label, className, handler) {
    const button = el("button", `button ${className}`, label);
    button.type = "button";
    button.addEventListener("click", handler);
    return button;
  }
  function renderRequests() {
    const body = $("#requestsBody");
    body.replaceChildren();
    const requests = Array.isArray(state.data.requests)
      ? state.data.requests
      : [];
    const ordered = [...requests].sort(
      (a, b) =>
        (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1) ||
        new Date(b.createdAt) - new Date(a.createdAt),
    );
    for (const item of ordered) {
      const row = el("tr");
      const business = el(
        "span",
        "",
        item.businessName || "Negocio sin nombre",
      );
      if (item.installationId)
        business.append(
          el("span", "secondary-line", `Equipo ${item.installationId}`),
        );
      tableCell(row, business);
      const identity = el("div");
      identity.append(
        el("span", "secondary-line", `Solicitud · ${item.id || "—"}`),
      );
      identity.append(
        el(
          "code",
          "fingerprint",
          item.keyFingerprint || "Huella no disponible",
        ),
      );
      tableCell(row, identity);
      tableCell(row, statusBadge(item.status));
      tableCell(row, el("span", "", formatDate(item.createdAt)));
      const actions = el("td");
      if (item.status === "PENDING" || item.status === "REJECTED") {
        const group = el("div", "row-actions");
        group.append(
          makeButton(
            item.status === "REJECTED" ? "Revisar de nuevo" : "Revisar",
            "button-small button-primary",
            () => openRequestDialog(item),
          ),
        );
        actions.append(group);
      } else if (item.licenseId)
        actions.append(
          el("span", "secondary-line", `Licencia ${item.licenseId}`),
        );
      row.append(actions);
      body.append(row);
    }
    $("#requestsEmpty").hidden = ordered.length > 0;
    $("#pendingCount").textContent = String(
      requests.filter((item) => item.status === "PENDING").length,
    );
    $("#approvedCount").textContent = String(
      requests.filter((item) => item.status === "APPROVED").length,
    );
  }
  function renderLicenses() {
    const body = $("#licensesBody");
    body.replaceChildren();
    const licenses = Array.isArray(state.data.licenses)
      ? state.data.licenses
      : [];
    for (const license of licenses) {
      const row = el("tr");
      const business = el(
        "span",
        "",
        license.businessName || "Negocio sin nombre",
      );
      business.append(
        el("span", "secondary-line", `Licencia · ${license.id || "—"}`),
      );
      if (license.accountEmail)
        business.append(
          el("span", "secondary-line", `Cuenta · ${license.accountEmail}`),
        );
      tableCell(row, business);
      tableCell(
        row,
        el(
          "span",
          "",
          isIndefinite(license.paidThrough)
            ? "Sin vencimiento"
            : formatDate(license.paidThrough),
        ),
      );
      tableCell(row, statusBadge(license.status));
      tableCell(row, el("span", "", String(license.revision ?? "—")));
      const actionCell = el("td");
      const actions = el("div", "row-actions");
      const suspended = license.status === "SUSPENDED";
      actions.append(
        makeButton(
          suspended ? "Reactivar" : "Suspender",
          `button-small button-outline${suspended ? "" : " button-danger"}`,
          () => openStatusDialog(license),
        ),
      );
      actions.append(
        makeButton("Renovar", "button-small button-outline", () =>
          openRenewDialog(license),
        ),
      );
      actions.append(
        makeButton(
          license.accountEmail ? "Restablecer contraseña" : "Crear cuenta",
          "button-small button-outline",
          () => openAccountDialog(license),
        ),
      );
      actionCell.append(actions);
      row.append(actionCell);
      body.append(row);
    }
    $("#licensesEmpty").hidden = licenses.length > 0;
    $("#licenseCount").textContent = String(licenses.length);
  }
  const auditLabels = {
    REQUEST_APPROVED: "Solicitud aprobada",
    REQUEST_REJECTED: "Solicitud rechazada",
    LICENSE_SUSPENDED: "Licencia suspendida",
    LICENSE_REACTIVATED: "Licencia reactivada",
    LICENSE_RENEWED: "Vigencia renovada",
    ACCOUNT_CREDENTIALS_SET: "Credenciales de cuenta actualizadas",
    ACCOUNT_DEVICE_ACTIVATED: "Equipo activado con cuenta",
  };
  function renderAudit() {
    const list = $("#auditList");
    list.replaceChildren();
    const entries = (
      Array.isArray(state.data.audit) ? state.data.audit : []
    ).slice(0, 12);
    for (const item of entries) {
      const row = el("div", "audit-row");
      row.append(
        el(
          "span",
          "audit-mark",
          item.action === "REQUEST_REJECTED" ? "−" : "✓",
        ),
      );
      const detail = el("div");
      const title = auditLabels[item.action] || "Cambio registrado";
      detail.append(el("span", "audit-title", title));
      const context = [
        item.licenseId ? `Licencia ${item.licenseId}` : "",
        item.requestId ? `Solicitud ${item.requestId}` : "",
        item.reason || "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (context) detail.append(el("span", "audit-meta", context));
      row.append(detail, el("time", "audit-time", formatDate(item.createdAt)));
      list.append(row);
    }
    $("#auditEmpty").hidden = entries.length > 0;
  }
  function renderOverview() {
    renderRequests();
    renderLicenses();
    renderAudit();
  }
  function addField(labelText, name, kind, helpText) {
    const wrap = el("div", "field-group");
    const label = el("label", "field-label", labelText);
    label.htmlFor = `field-${name}`;
    let input;
    if (kind === "select") input = document.createElement("select");
    else if (kind === "textarea") input = document.createElement("textarea");
    else input = document.createElement("input");
    input.id = `field-${name}`;
    input.name = name;
    if (kind !== "select" && kind !== "textarea") input.type = kind;
    input.className =
      kind === "select"
        ? "field-select"
        : kind === "textarea"
          ? "field-textarea"
          : "field-input";
    if (helpText) {
      input.setAttribute("aria-describedby", `help-${name}`);
      wrap.append(label, input, el("span", "field-help", helpText));
      wrap.lastElementChild.id = `help-${name}`;
    } else wrap.append(label, input);
    dialogFields.append(wrap);
    return input;
  }
  function addReasonField() {
    const reason = addField(
      "Motivo",
      "reason",
      "textarea",
      "Obligatorio. Queda registrado en la actividad del panel.",
    );
    reason.maxLength = 500;
    reason.required = true;
    return reason;
  }
  function readReason(form) {
    const reason = form.elements.reason.value.trim();
    if (!reason)
      throw new Error("Ingresá el motivo para registrar este cambio.");
    return reason;
  }
  function configureDialog({
    eyebrow = "CONFIRMAR ACCIÓN",
    title,
    description,
    submitLabel = "Confirmar",
    action,
  }) {
    state.dialogAction = action;
    state.dialogIdempotency = null;
    $("#dialogEyebrow").textContent = eyebrow;
    $("#dialogTitle").textContent = title;
    $("#dialogDescription").textContent = description;
    $("#dialogSubmit").textContent = submitLabel;
    $("#dialogError").hidden = true;
    $("#dialogSubmit").disabled = false;
    $("#dialogCancel").disabled = false;
    dialogFields.replaceChildren();
    actionDialog.showModal();
  }
  function requestReviewBox(item) {
    const box = el("div", "review-box");
    box.append(
      el("strong", "", "Huella de instalación para comparar con el cliente"),
    );
    box.append(el("code", "", item.keyFingerprint || "Huella no disponible"));
    if (item.installationId)
      box.append(el("span", "secondary-line", `Equipo ${item.installationId}`));
    dialogFields.append(box);
  }
  function addReviewedCheck() {
    const wrap = el("div", "field-group");
    const label = el("label", "check-row");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "fingerprintChecked";
    input.required = true;
    label.append(
      input,
      el("span", "", "Comparé esta huella con la que me confirmó el cliente."),
    );
    wrap.append(
      label,
      el(
        "span",
        "field-help",
        "La comparación la realiza el titular; no se valida automáticamente.",
      ),
    );
    dialogFields.append(wrap);
  }
  function addLicenseChoice(item) {
    const select = addField(
      "Cómo asignar la licencia",
      "assignment",
      "select",
      "Elegí explícitamente; no se asignará ninguna licencia por defecto.",
    );
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Seleccioná una opción";
    select.append(placeholder);
    const newOption = document.createElement("option");
    newOption.value = "new";
    newOption.textContent = "Crear una licencia nueva";
    select.append(newOption);
    const eligible = (state.data.licenses || []).filter(
      (license) =>
        !license.installationId ||
        license.installationId === item.installationId,
    );
    if (eligible.length) {
      const group = document.createElement("optgroup");
      group.label = "Vincular una licencia existente sin otro equipo";
      for (const license of eligible) {
        const option = document.createElement("option");
        option.value = `existing:${license.id}`;
        option.textContent = `${license.businessName} · ${license.id} · ${license.status === "ACTIVE" ? "Activa" : "Suspendida"}`;
        group.append(option);
      }
      select.append(group);
    }
    const newFields = el("div");
    newFields.hidden = true;
    dialogFields.append(newFields);
    let nameInput;
    let dateInput;
    let indefinite;
    function buildNewFields() {
      newFields.replaceChildren();
      const nameWrap = el("div", "field-group");
      const nameLabel = el("label", "field-label", "Nombre del negocio");
      nameLabel.htmlFor = "field-businessName";
      nameInput = document.createElement("input");
      nameInput.className = "field-input";
      nameInput.type = "text";
      nameInput.id = "field-businessName";
      nameInput.name = "businessName";
      nameInput.maxLength = 160;
      nameInput.value = item.businessName || "";
      nameWrap.append(nameLabel, nameInput);
      newFields.append(nameWrap);
      const dateWrap = el("div", "field-group");
      const dateLabel = el("label", "field-label", "Vigente hasta");
      dateLabel.htmlFor = "field-paidThrough";
      dateInput = document.createElement("input");
      dateInput.className = "field-input";
      dateInput.type = "date";
      dateInput.id = "field-paidThrough";
      dateInput.name = "paidThrough";
      dateInput.disabled = true;
      const help = el(
        "span",
        "field-help",
        "La fecha elegida incluye todo ese día.",
      );
      dateWrap.append(dateLabel, dateInput, help);
      newFields.append(dateWrap);
      const checkWrap = el("div", "field-group");
      const checkLabel = el("label", "check-row");
      indefinite = document.createElement("input");
      indefinite.type = "checkbox";
      indefinite.name = "indefinite";
      indefinite.checked = true;
      checkLabel.append(indefinite, el("span", "", "Sin vencimiento"));
      checkWrap.append(checkLabel);
      newFields.append(checkWrap);
      indefinite.addEventListener("change", () => {
        dateInput.disabled = indefinite.checked;
        dateInput.required = !indefinite.checked;
      });
    }
    select.addEventListener("change", () => {
      newFields.hidden = select.value !== "new";
      if (select.value === "new") {
        buildNewFields();
        $("#field-businessName").focus();
      }
    });
    return () => {
      if (!select.value)
        throw new Error("Elegí una licencia existente o creá una nueva.");
      if (select.value === "new") {
        const businessName = nameInput.value.trim();
        if (!businessName) throw new Error("Ingresá el nombre del negocio.");
        if (!indefinite.checked && !dateInput.value)
          throw new Error("Elegí una fecha de vigencia.");
        return {
          businessName,
          paidThrough: indefinite.checked
            ? "9999-01-01T00:00:00.000Z"
            : dateToEndIso(dateInput.value),
        };
      }
      return { licenseId: select.value.slice("existing:".length) };
    };
  }
  function dateToEndIso(value) {
    const parts = value.split("-").map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2] + 1, 0, 0, 0, 0);
    return new Date(date.getTime() - 1).toISOString();
  }
  function openRequestDialog(item) {
    configureDialog({
      eyebrow: "REVISIÓN DE SOLICITUD",
      title: "Aprobar o rechazar",
      description: `${item.businessName || "Negocio sin nombre"} · solicitud ${item.id || "—"}`,
      submitLabel: "Aprobar solicitud",
      action: null,
    });
    requestReviewBox(item);
    addReviewedCheck();
    const getAssignment = addLicenseChoice(item);
    addReasonField();
    const reject = makeButton(
      "Rechazar",
      "button-small button-outline button-danger",
      () => {
        const reviewed = $("#actionForm").elements.fingerprintChecked;
        if (reviewed) reviewed.disabled = true;
        state.dialogAction = async (form) => {
          const reason = readReason(form);
          return {
            path: `/requests/${encodeURIComponent(item.id)}/reject`,
            payload: { reason },
          };
        };
        $("#dialogSubmit").textContent = "Confirmar rechazo";
        $("#dialogTitle").textContent = "Rechazar solicitud";
        $("#dialogDescription").textContent =
          "La solicitud quedará marcada como rechazada.";
        $("#dialogError").hidden = true;
        $("#dialogSubmit").focus();
      },
    );
    reject.classList.add("reject-choice");
    $("#dialogCancel").before(reject);
    state.dialogAction = async (form) => {
      if (!form.elements.fingerprintChecked.checked)
        throw new Error("Confirmá que comparaste la huella antes de aprobar.");
      return {
        path: `/requests/${encodeURIComponent(item.id)}/approve`,
        payload: { ...getAssignment(), reason: readReason(form) },
      };
    };
    $("#actionDialog").addEventListener("close", removeRejectButton, {
      once: true,
    });
    $("#field-assignment").focus();
  }
  function removeRejectButton() {
    const button = $("#actionDialog .reject-choice");
    if (button) button.remove();
  }
  function openStatusDialog(license) {
    const next = license.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    const label = next === "ACTIVE" ? "Reactivar" : "Suspender";
    configureDialog({
      eyebrow: "ESTADO DE LICENCIA",
      title: `${label} licencia`,
      description: `${license.businessName} · revisión ${license.revision}. El equipo recibirá el cambio en su próxima verificación.`,
      submitLabel: `${label} licencia`,
      action: null,
    });
    addReasonField();
    state.dialogAction = async (form) => ({
      path: `/licenses/${encodeURIComponent(license.id)}/status`,
      payload: {
        status: next,
        expectedRevision: license.revision,
        reason: readReason(form),
      },
    });
  }
  function openAccountDialog(license) {
    configureDialog({
      eyebrow: "CUENTA DEL PROGRAMA",
      title: license.accountEmail
        ? "Restablecer contraseña"
        : "Crear cuenta de licencia",
      description: `${license.businessName} · Una cuenta y una PC por licencia. No cambia el equipo vinculado ni la vigencia. Verificá la identidad del titular antes de restablecer su contraseña.`,
      submitLabel: "Guardar cuenta",
      action: null,
    });
    const email = addField(
      "Correo de la cuenta",
      "email",
      "email",
      "Esta cuenta es independiente del catálogo web y de los PIN del personal.",
    );
    email.required = true;
    email.maxLength = 254;
    email.value = license.accountEmail || "";
    email.readOnly = !!license.accountEmail;
    const password = addField(
      "Nueva contraseña",
      "accountPassword",
      "password",
      "De 15 a 128 caracteres. Compartila con el titular por un canal seguro. No se podrá consultar después.",
    );
    password.required = true;
    password.minLength = 15;
    password.maxLength = 128;
    password.autocomplete = "new-password";
    const repeat = addField(
      "Repetir contraseña",
      "passwordConfirm",
      "password",
    );
    repeat.required = true;
    repeat.autocomplete = "new-password";
    repeat.maxLength = 128;
    addReasonField();
    state.dialogAction = (form) => {
      if (password.value !== repeat.value)
        throw new Error("Las contraseñas no coinciden.");
      return {
        path: "/accounts",
        payload: {
          licenseId: license.id,
          email: email.value.trim().toLowerCase(),
          password: password.value,
          reason: readReason(form),
        },
      };
    };
    email.focus();
  }
  function openRenewDialog(license) {
    configureDialog({
      eyebrow: "VIGENCIA",
      title: "Renovar licencia",
      description: `${license.businessName} · vigente hasta ${isIndefinite(license.paidThrough) ? "sin vencimiento" : formatDate(license.paidThrough)}. No se puede acortar la vigencia actual.`,
      submitLabel: "Guardar vigencia",
      action: null,
    });
    const date = addField(
      "Nueva fecha de vigencia",
      "paidThrough",
      "date",
      "La fecha elegida incluye todo ese día.",
    );
    const indefiniteWrap = el("div", "field-group");
    const indefiniteLabel = el("label", "check-row");
    const indefinite = document.createElement("input");
    indefinite.type = "checkbox";
    indefinite.name = "indefinite";
    indefinite.checked = isIndefinite(license.paidThrough);
    indefinite.disabled = isIndefinite(license.paidThrough);
    indefiniteLabel.append(indefinite, el("span", "", "Sin vencimiento"));
    indefiniteWrap.append(indefiniteLabel);
    date.parentElement.after(indefiniteWrap);
    date.disabled = indefinite.checked;
    date.required = !indefinite.checked;
    indefinite.addEventListener("change", () => {
      date.disabled = indefinite.checked;
      date.required = !indefinite.checked;
    });
    addReasonField();
    state.dialogAction = async (form) => {
      const paidThrough = indefinite.checked
        ? "9999-01-01T00:00:00.000Z"
        : (() => {
            if (!form.elements.paidThrough.value)
              throw new Error("Elegí una fecha de vigencia.");
            return dateToEndIso(form.elements.paidThrough.value);
          })();
      if (
        (isIndefinite(license.paidThrough) && !indefinite.checked) ||
        (!isIndefinite(license.paidThrough) &&
          new Date(paidThrough) < new Date(license.paidThrough))
      )
        throw new Error("La nueva fecha no puede acortar la vigencia actual.");
      return {
        path: `/licenses/${encodeURIComponent(license.id)}/renew`,
        payload: {
          paidThrough,
          expectedRevision: license.revision,
          reason: readReason(form),
        },
      };
    };
  }
  function addPaidThroughField(initial = "") {
    const date = addField(
      "Vigente hasta",
      "paidThroughDate",
      "date",
      "La fecha elegida incluye todo ese día.",
    );
    date.required = true;
    date.value =
      initial && !isIndefinite(initial) ? localDateInput(initial) : "";
    const wrap = el("div", "field-group"),
      label = el("label", "check-row"),
      check = document.createElement("input");
    check.type = "checkbox";
    check.name = "indefinite";
    check.checked = isIndefinite(initial);
    date.disabled = check.checked;
    date.required = !check.checked;
    label.append(check, el("span", "", "Sin vencimiento"));
    wrap.append(label);
    date.parentElement.after(wrap);
    check.addEventListener("change", () => {
      date.disabled = check.checked;
      date.required = !check.checked;
    });
    return () => {
      if (!check.checked && !date.value)
        throw new Error("Elegí la fecha de vigencia.");
      return check.checked
        ? "9999-01-01T00:00:00.000Z"
        : dateToEndIso(date.value);
    };
  }
  function openMerchantCreate() {
    configureDialog({
      eyebrow: "ALTA DE COMERCIO",
      title: "Registrar comercio",
      description:
        "Creá una licencia y definí su vigencia. El alta no registra un pago; los cobros se anotan manualmente.",
      submitLabel: "Crear comercio",
      action: null,
    });
    const name = addField("Nombre del comercio", "businessName", "text");
    name.required = true;
    name.maxLength = 160;
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 30);
    const getPaidThrough = addPaidThroughField(
      dateToEndIso(localDateInput(defaultDate)),
    );
    addReasonField();
    state.dialogAction = (form) => {
      const payload = {
        businessName: name.value.trim(),
        paidThrough: getPaidThrough(),
        reason: readReason(form),
      };
      payload.idempotencyKey = idempotencyFor(payload);
      return { path: "/merchants", payload };
    };
    name.focus();
  }
  function openMerchantPayment(merchant) {
    configureDialog({
      eyebrow: "COBRO MANUAL · ARS",
      title: "Registrar pago",
      description: `${merchant.businessName}. Esto registra un pago recibido manualmente; no inicia un débito ni una adhesión automática.`,
      submitLabel: "Registrar pago manual",
      action: null,
    });
    const amount = addField(
      "Importe recibido (ARS)",
      "amountArs",
      "number",
      "Importe decimal en pesos; ejemplo: 12500,50.",
    );
    amount.required = true;
    amount.min = "0.01";
    amount.step = "0.01";
    const getPaidThrough = addPaidThroughField(merchant.paidThrough);
    addReasonField();
    state.dialogAction = (form) => {
      const payload = {
        expectedRevision: merchant.revision,
        amountArs: amount.value,
        paidThrough: getPaidThrough(),
        reason: readReason(form),
      };
      payload.idempotencyKey = idempotencyFor(payload);
      return {
        path: `/merchants/${encodeURIComponent(merchant.id)}/payment`,
        payload,
      };
    };
  }
  function openMerchantCourtesy(merchant) {
    configureDialog({
      eyebrow: "CORTESÍA · SIN COBRO",
      title: "Cargar cortesía",
      description: `${merchant.businessName}. Se ampliará la vigencia sin crear registro de pago ni informar un importe.`,
      submitLabel: "Aplicar cortesía",
      action: null,
    });
    const getPaidThrough = addPaidThroughField(merchant.paidThrough);
    addReasonField();
    state.dialogAction = (form) => {
      const payload = {
        expectedRevision: merchant.revision,
        paidThrough: getPaidThrough(),
        reason: readReason(form),
      };
      payload.idempotencyKey = idempotencyFor(payload);
      return {
        path: `/merchants/${encodeURIComponent(merchant.id)}/courtesy`,
        payload,
      };
    };
  }
  function openMerchantStatus(merchant) {
    const next = merchant.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED",
      label = next === "ACTIVE" ? "Reactivar" : "Suspender";
    configureDialog({
      eyebrow: "ACCESO AL PROGRAMA",
      title: `${label} comercio`,
      description: `${merchant.businessName}. El estado de cobro permanece independiente.`,
      submitLabel: `${label} acceso`,
      action: null,
    });
    addReasonField();
    state.dialogAction = (form) => ({
      path: `/licenses/${encodeURIComponent(merchant.id)}/status`,
      payload: {
        status: next,
        expectedRevision: merchant.revision,
        reason: readReason(form),
      },
    });
  }
  function openSandboxDialog(merchant) {
    configureDialog({
      eyebrow: "ENSAYO SANDBOX · SIN IMPACTO REAL",
      title: "Crear adhesión de prueba",
      description:
        "Se generará un enlace en entorno de pruebas. No se realizará un cobro real y no cambiará el acceso del comercio.",
      submitLabel: "Crear enlace sandbox",
      action: null,
    });
    const email = addField(
      "Email del comprador de pruebas",
      "payerEmail",
      "email",
      "Usá únicamente el email designado para probar la adhesión.",
    );
    email.required = true;
    email.maxLength = 254;
    const amount = addField(
      "Precio mensual simulado (ARS)",
      "amountArs",
      "number",
      "Importe mensual de prueba; no se cobrará.",
    );
    amount.required = true;
    amount.min = "0.01";
    amount.step = "0.01";
    state.dialogAction = () => ({
      path: `/merchants/${encodeURIComponent(merchant.id)}/sandbox`,
      payload: {
        payerEmail: email.value.trim().toLowerCase(),
        amountArs: amount.value,
      },
    });
  }
  function openSandboxReconcile(merchant, sandbox) {
    configureDialog({
      eyebrow: "VERIFICACIÓN SANDBOX · SIN COBRO",
      title: "Verificar adhesión de prueba",
      description:
        "Consulta el estado con el proveedor sandbox; no crea ni cobra una operación. Para revisión sin identificadores registrados, completá los IDs que te informó el proveedor.",
      submitLabel: "Verificar ensayo",
      action: null,
    });
    const subscription = addField(
      "ID de suscripción (opcional)",
      "subscriptionId",
      "text",
      "Necesario sólo si el proveedor aún no pudo vincular la notificación.",
    );
    subscription.maxLength = 200;
    subscription.value = sandbox.providerId || "";
    const installment = addField(
      "ID de cuota (opcional)",
      "installmentId",
      "text",
    );
    installment.maxLength = 200;
    state.dialogAction = () => {
      const payload = {};
      if (subscription.value.trim())
        payload.subscriptionId = subscription.value.trim();
      if (installment.value.trim())
        payload.installmentId = installment.value.trim();
      return {
        path: `/merchants/${encodeURIComponent(merchant.id)}/sandbox/reconcile`,
        payload,
      };
    };
  }
  async function cancelSandbox(merchant) {
    if (
      !window.confirm(
        `Cancelar la adhesión sandbox de ${merchant.businessName}? No afecta pagos ni acceso reales.`,
      )
    )
      return;
    try {
      await request(
        `/merchants/${encodeURIComponent(merchant.id)}/sandbox/cancel`,
        { method: "POST", mutate: true, body: JSON.stringify({}) },
      );
      await loadMerchants(true);
      setMessage("Prueba sandbox cancelada. No se modificó la cuenta real.");
    } catch (error) {
      setMessage(error.message, true);
    }
  }
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    $("#loginError").hidden = true;
    try {
      const session = await request("/login", {
        method: "POST",
        body: JSON.stringify({
          username: $("#username").value.trim(),
          password: $("#password").value,
        }),
      });
      if (!session || !session.csrfToken)
        throw new Error("La respuesta de inicio de sesión no es válida.");
      showDashboard(session);
    } catch (error) {
      $("#loginError").textContent = error.message;
      $("#loginError").hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  $("#logoutButton").addEventListener("click", async () => {
    try {
      await request("/logout", {
        method: "POST",
        mutate: true,
        body: JSON.stringify({}),
      });
    } catch (error) {
      if (error.status !== 401) setMessage(error.message, true);
    }
    showLogin();
    $("#username").focus();
  });
  $("#refreshButton").addEventListener("click", () => loadOverview());
  $("#dialogCancel").addEventListener("click", () => actionDialog.close());
  $("#dialogClose").addEventListener("click", () => actionDialog.close());
  actionDialog.addEventListener("click", (event) => {
    if (event.target === actionDialog) actionDialog.close();
  });
  $("#actionForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy || !state.dialogAction) return;
    const submit = $("#dialogSubmit");
    const cancel = $("#dialogCancel");
    state.busy = true;
    submit.disabled = true;
    cancel.disabled = true;
    $("#dialogError").hidden = true;
    try {
      const result = await state.dialogAction(event.currentTarget);
      await request(result.path, {
        method: "POST",
        mutate: true,
        body: JSON.stringify(result.payload),
      });
      actionDialog.close();
      setMessage(
        result.path.includes("/sandbox")
          ? "Ensayo actualizado. No cambió el acceso ni se registró un pago real."
          : "Cambios guardados. La PC verá los cambios de acceso en su próxima verificación.",
      );
      await loadOverview(true);
    } catch (error) {
      if (error.status === 409) await loadOverview(true);
      $("#dialogError").textContent = error.message;
      $("#dialogError").hidden = false;
      submit.disabled = false;
      cancel.disabled = false;
    } finally {
      state.busy = false;
      for (const field of dialogFields.querySelectorAll(
        'input[type="password"]',
      ))
        field.value = "";
    }
  });
  actionDialog.addEventListener("close", () => {
    for (const field of dialogFields.querySelectorAll('input[type="password"]'))
      field.value = "";
    state.dialogAction = null;
    state.busy = false;
  });

  $("#merchantCreateButton").addEventListener("click", openMerchantCreate);
  $("#merchantSearch").addEventListener("input", (event) => {
    state.merchantQuery = event.currentTarget.value.trim();
    state.merchants.offset = 0;
    clearTimeout(state.merchantSearchTimer);
    state.merchantSearchTimer = window.setTimeout(() => loadMerchants(), 250);
  });
  $("#merchantsPrev").addEventListener("click", () => {
    state.merchants.offset = Math.max(0, state.merchants.offset - 25);
    loadMerchants();
  });
  $("#merchantsNext").addEventListener("click", () => {
    state.merchants.offset += 25;
    loadMerchants();
  });

  request("/session")
    .then((session) => {
      if (session && session.csrfToken) showDashboard(session);
    })
    .catch((error) => {
      if (
        error.status !== 401 &&
        !String(error.message).includes("La sesión expiró")
      )
        setMessage(error.message, true);
    });
})();
