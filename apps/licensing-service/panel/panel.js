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
      const error = new Error(
        typeof message === "string"
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
    dashboardView.hidden = true;
    loginView.hidden = false;
    $("#logoutButton").hidden = true;
    $("#loginError").textContent = message;
    $("#loginError").hidden = !message;
    $("#password").value = "";
  }
  function showDashboard(session) {
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
        "Cambios guardados. Se aplicarán al equipo en su próxima verificación de licencia.",
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
    }
  });
  actionDialog.addEventListener("close", () => {
    state.dialogAction = null;
    state.busy = false;
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
