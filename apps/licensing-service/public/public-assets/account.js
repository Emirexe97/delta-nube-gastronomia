const api = "/public/api/";
const status = document.querySelector("#status");
if (status) status.tabIndex = -1;
const form = document.querySelector("#form");
const route = location.pathname;
function message(text, error = false) {
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("error", error);
}
async function send(path, body) {
  const response = await fetch(api + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(
      response.status === 429
        ? "Hiciste varios intentos. Esperá un momento y probá de nuevo."
        : response.status === 503
          ? "El servicio no está disponible por el momento. Probá más tarde."
          : "No pudimos completar la solicitud. Revisá los datos e intentá de nuevo.",
    );
    error.status = response.status;
    error.code = payload.error || payload.code;
    throw error;
  }
  return response.json().catch(() => ({}));
}

if (form) {
  const isReset = route.includes("recuperar");
  let token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token)
    history.replaceState(null, "", location.pathname + location.search);
  const title = document.querySelector("#title");
  const intro = document.querySelector("#intro");
  const email = form.elements.email;
  let requestBusy = false;
  let waitingForLink = false;
  let resendTimer;
  let resendButton;
  let changeButton;
  let registrationEnabled = true;
  let viewRevision = 0;
  if (email) email.maxLength = 254;
  function renderCompletionForm() {
    form.hidden = false;
    title.textContent = isReset
      ? "Elegí una nueva contraseña"
      : "Terminá de crear tu cuenta";
    intro.textContent = isReset
      ? "Usá una contraseña segura de 15 a 128 caracteres."
      : "Contanos cómo se llama tu negocio y elegí una contraseña de 15 a 128 caracteres.";
    form.replaceChildren();
    if (!isReset) {
      const businessLabel = document.createElement("label");
      businessLabel.htmlFor = "business";
      businessLabel.textContent = "Nombre del negocio";
      const business = document.createElement("input");
      business.id = "business";
      business.name = "businessName";
      business.autocomplete = "organization";
      business.maxLength = 160;
      business.required = true;
      form.append(businessLabel, business);
    }
    const label = document.createElement("label");
    label.htmlFor = "password";
    label.textContent = "Contraseña";
    const password = document.createElement("input");
    password.id = "password";
    password.name = "password";
    password.type = "password";
    password.autocomplete = "new-password";
    password.minLength = 15;
    password.maxLength = 128;
    password.required = true;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "Mostrar contraseña";
    toggle.setAttribute("aria-pressed", "false");
    toggle.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      toggle.textContent = showing
        ? "Mostrar contraseña"
        : "Ocultar contraseña";
      toggle.setAttribute("aria-pressed", String(!showing));
    });
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = isReset ? "Guardar contraseña" : "Crear cuenta";
    form.append(label, password, toggle, submit);
  }
  if (token) renderCompletionForm();
  window.addEventListener("hashchange", () => {
    const newToken = new URLSearchParams(location.hash.slice(1)).get("token");
    if (!newToken) return;
    viewRevision += 1;
    token = registrationEnabled ? newToken : null;
    clearInterval(resendTimer);
    resendButton?.remove();
    changeButton?.remove();
    resendButton = undefined;
    changeButton = undefined;
    waitingForLink = false;
    requestBusy = false;
    history.replaceState(null, "", location.pathname + location.search);
    if (registrationEnabled) renderCompletionForm();
    else {
      form.hidden = true;
      title.textContent = "El registro todavía no está disponible";
      intro.textContent =
        "Volvé a consultar más adelante o descargá el programa.";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (requestBusy || waitingForLink) return;
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    const requestView = viewRevision;
    requestBusy = true;
    button.disabled = true;
    message("");
    try {
      if (token) {
        const password = form.elements.password;
        await send(
          isReset ? "password-reset/complete" : "registration/complete",
          {
            token,
            ...(isReset
              ? {}
              : { businessName: form.elements.businessName.value }),
            password: password.value,
          },
        );
        if (requestView !== viewRevision) return;
        password.value = "";
        token = null;
        title.textContent = isReset
          ? "Contraseña actualizada"
          : "¡Tu cuenta está lista!";
        intro.textContent = isReset
          ? "Ya podés iniciar sesión en el programa de escritorio."
          : "Descargá el programa e iniciá sesión para empezar tu prueba. Los 30 días corridos comienzan con tu primer ingreso exitoso.";
        form.hidden = true;
        message("Listo.");
        status.focus();
      } else {
        const emailInput = form.elements.email;
        const submittedEmail = emailInput.value;
        await send(isReset ? "password-reset/start" : "registration/start", {
          email: submittedEmail,
        });
        if (requestView !== viewRevision) return;
        message(
          "Si el correo puede continuar el proceso, vas a recibir un mensaje. Revisá también correo no deseado.",
        );
        waitingForLink = true;
        emailInput.readOnly = true;
        button.hidden = true;
        let countdown = 60;
        resendButton = document.createElement("button");
        resendButton.type = "button";
        changeButton = document.createElement("button");
        changeButton.type = "button";
        changeButton.textContent = "Cambiar correo";
        changeButton.addEventListener("click", () => {
          clearInterval(resendTimer);
          waitingForLink = false;
          email.readOnly = false;
          button.hidden = false;
          resendButton.remove();
          changeButton.remove();
          emailInput.focus();
        });
        const tick = () => {
          resendButton.disabled = countdown > 0;
          resendButton.textContent =
            countdown > 0
              ? `Reenviar enlace (${countdown})`
              : "Reenviar enlace";
          if (countdown > 0) countdown -= 1;
          else clearInterval(resendTimer);
        };
        tick();
        resendTimer = setInterval(tick, 1000);
        resendButton.addEventListener("click", async () => {
          if (requestBusy) return;
          const resendView = viewRevision;
          requestBusy = true;
          resendButton.disabled = true;
          try {
            await send(
              isReset ? "password-reset/start" : "registration/start",
              { email: submittedEmail },
            );
            if (resendView !== viewRevision) return;
            countdown = 60;
            message(
              "Si el correo puede continuar el proceso, vas a recibir un mensaje. Revisá también correo no deseado.",
            );
            tick();
            resendTimer = setInterval(tick, 1000);
          } catch (error) {
            if (resendView !== viewRevision) return;
            message(error.message, true);
            resendButton.disabled = false;
          } finally {
            if (resendView === viewRevision) requestBusy = false;
          }
        });
        form.after(resendButton, changeButton);
      }
    } catch (error) {
      if (requestView !== viewRevision) return;
      if (
        token &&
        (error.status === 410 ||
          ["invalid_or_expired_token", "invalid_token"].includes(error.code))
      ) {
        token = null;
        title.textContent = "El enlace ya no es válido";
        intro.textContent = "Podés solicitar un enlace nuevo para continuar.";
        form.replaceChildren();
        const label = document.createElement("label");
        label.htmlFor = "email";
        label.textContent = "Correo electrónico";
        const input = document.createElement("input");
        input.id = "email";
        input.name = "email";
        input.type = "email";
        input.autocomplete = "email";
        input.maxLength = 254;
        input.required = true;
        const submit = document.createElement("button");
        submit.type = "submit";
        submit.textContent = "Solicitar otro enlace";
        form.append(label, input, submit);
      }
      message(error.message, true);
      status.focus();
    } finally {
      if (requestView === viewRevision) {
        requestBusy = false;
        if (button?.isConnected) button.disabled = false;
      }
    }
  });

  (async () => {
    try {
      const response = await fetch("/public/api/config", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const config = await response.json();
      if (config.registrationEnabled === false) {
        registrationEnabled = false;
        form.hidden = true;
        title.textContent = "El registro todavía no está disponible";
        intro.textContent =
          "Volvé a consultar más adelante o descargá el programa.";
      }
    } catch {
      // Do not block form use if only the optional public configuration is unavailable.
    }
  })();
}

const list = document.querySelector("#downloads");
if (list) {
  const note = document.querySelector("#downloads-status");
  (async () => {
    try {
      const response = await fetch("/public/api/config", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error();
      const config = await response.json();
      const entries = [
        ["windows", "Windows"],
        ["macArm64", "macOS (Apple Silicon)"],
        ["macX64", "macOS (Intel)"],
      ];
      let any = false;
      for (const [key, label] of entries) {
        const item = config.downloads?.[key];
        if (
          !item ||
          typeof item.url !== "string" ||
          typeof item.label !== "string"
        )
          continue;
        let url;
        try {
          url = new URL(item.url, location.origin);
          if (url.origin !== location.origin && url.protocol !== "https:")
            continue;
        } catch {
          continue;
        }
        if (url.protocol !== "https:" && url.origin !== location.origin)
          continue;
        const li = document.createElement("li");
        const anchor = document.createElement("a");
        anchor.href = url.href;
        anchor.textContent = item.label;
        anchor.rel = "noopener";
        li.append(document.createTextNode(`${label}: `), anchor);
        list.append(li);
        any = true;
      }
      note.textContent = any
        ? "Elegí tu versión para descargar."
        : "Todavía no hay instaladores disponibles. Volvé a consultar más adelante.";
    } catch {
      note.textContent =
        "No pudimos consultar las descargas. Probá de nuevo más tarde.";
      note.classList.add("error");
    }
  })();
}
