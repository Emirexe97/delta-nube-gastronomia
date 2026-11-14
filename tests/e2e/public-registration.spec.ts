import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
const publicDir = resolve(process.cwd(), "apps/licensing-service/public");
async function serve() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/public/api/")) {
      const body = JSON.parse(
        await new Promise((resolve) => {
          let value = "";
          req.on("data", (chunk) => (value += chunk));
          req.on("end", () => resolve(value || "{}"));
        }),
      );
      requests.push({ path: url.pathname, body });
      res.setHeader("Content-Type", "application/json");
      if (url.pathname.endsWith("/config"))
        return res.end(
          JSON.stringify({ registrationEnabled: true, downloads: {} }),
        );
      if (url.pathname.endsWith("/start"))
        return res.end(JSON.stringify({ accepted: true }));
      if (url.pathname.endsWith("/complete"))
        return res.end(JSON.stringify({ ok: true }));
      res.statusCode = 404;
      return res.end("{}");
    }
    const name = url.pathname === "/" ? "/registro/" : url.pathname;
    const path = resolve(
      publicDir,
      `.${name.endsWith("/") ? `${name}index.html` : name}`,
    );
    if (!path.startsWith(publicDir)) {
      res.statusCode = 404;
      return res.end();
    }
    try {
      res.setHeader(
        "Content-Type",
        extname(path) === ".css"
          ? "text/css"
          : extname(path) === ".js"
            ? "text/javascript"
            : "text/html; charset=utf-8",
      );
      res.end(await readFile(path));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("registro conserva formulario, reenvía después de cooldown y completa cuenta con token efímero", async ({
  page,
}) => {
  const fixture = await serve();
  try {
    await page.clock.install();
    await page.goto(`${fixture.origin}/registro/`);
    await expect(
      page.getByRole("heading", { name: "Probá gratis 30 días" }),
    ).toBeVisible();
    await page.getByLabel("Correo electrónico").fill("hola@example.com");
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Si el correo puede continuar",
    );
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();
    const resend = page.getByRole("button", { name: /Reenviar enlace/ });
    await expect(resend).toBeDisabled();
    await page.getByRole("button", { name: "Cambiar correo" }).click();
    await page.getByLabel("Correo electrónico").fill("nuevo@example.com");
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await expect(page.getByLabel("Correo electrónico")).toHaveAttribute(
      "readonly",
      "",
    );
    const availableResend = page.getByRole("button", {
      name: /Reenviar enlace/,
    });
    await expect(availableResend).toBeDisabled();
    await page.clock.runFor(61_000);
    await expect(
      page.getByRole("button", { name: "Reenviar enlace", exact: true }),
    ).toBeEnabled();
    await availableResend.click();
    expect(
      fixture.requests.filter((request) =>
        request.path.endsWith("/registration/start"),
      ),
    ).toHaveLength(3);
    await page.goto(`${fixture.origin}/registro/#token=one-time-token`);
    await expect(page).toHaveURL(`${fixture.origin}/registro/`);
    await page.getByLabel("Nombre del negocio").fill("El Buen Plato");
    await page.getByLabel("Contraseña").fill("una-clave-muy-larga-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(
      page.getByRole("heading", { name: "¡Tu cuenta está lista!" }),
    ).toBeVisible();
    expect(fixture.requests.at(-1)).toEqual({
      path: "/public/api/registration/complete",
      body: {
        token: "one-time-token",
        businessName: "El Buen Plato",
        password: "una-clave-muy-larga-123",
      },
    });
  } finally {
    await fixture.close();
  }
});

test("error de contraseña no invalida token ni borra el formulario", async ({
  page,
}) => {
  const fixture = await serve();
  try {
    await page.route("**/public/api/registration/complete", (route) =>
      route.fulfill({ status: 400, json: { error: "invalid_password" } }),
    );
    await page.goto(`${fixture.origin}/registro/#token=still-valid`);
    await page.getByLabel("Nombre del negocio").fill("Comedor");
    await page.getByLabel("Contraseña").fill("una-clave-muy-larga-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("status")).toContainText(
      "No pudimos completar",
    );
    await expect(page.getByLabel("Nombre del negocio")).toHaveValue("Comedor");
    await expect(page.getByLabel("Contraseña")).toHaveValue(
      "una-clave-muy-larga-123",
    );
    await expect(
      page.getByRole("heading", { name: "Terminá de crear tu cuenta" }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("registro pausado y token expirado ofrecen estado claro y una nueva solicitud", async ({
  page,
}) => {
  const fixture = await serve();
  try {
    await page.route("**/public/api/config", (route) =>
      route.fulfill({ json: { registrationEnabled: false, downloads: {} } }),
    );
    await page.goto(`${fixture.origin}/registro/`);
    await expect(
      page.getByRole("heading", {
        name: "El registro todavía no está disponible",
      }),
    ).toBeVisible();
    await expect(page.locator("#form")).toBeHidden();
    await page.unrouteAll();
    await page.reload();
    await page.route("**/public/api/registration/complete", (route) =>
      route.fulfill({
        status: 400,
        json: { error: "invalid_or_expired_token" },
      }),
    );
    await page.goto(`${fixture.origin}/registro/#token=expired`);
    await page.getByLabel("Nombre del negocio").fill("Comedor");
    await page.getByLabel("Contraseña").fill("una-clave-muy-larga-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(
      page.getByRole("heading", { name: "El enlace ya no es válido" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Solicitar otro enlace" }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test("link de verificación recibido mientras start sigue pendiente no restaura el estado anterior", async ({
  page,
}) => {
  const fixture = await serve();
  let releaseStart!: () => void;
  const startGate = new Promise<void>((resolve) => (releaseStart = resolve));
  try {
    await page.goto(`${fixture.origin}/registro/`);
    await page.route("**/public/api/registration/start", async (route) => {
      await startGate;
      await route.fulfill({ json: { accepted: true } });
    });
    await page.getByLabel("Correo electrónico").fill("hola@example.com");
    const startRequest = page.waitForRequest(
      "**/public/api/registration/start",
    );
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    await startRequest;
    await page.goto(`${fixture.origin}/registro/#token=fast-mail-token`);
    await expect(page).toHaveURL(`${fixture.origin}/registro/`);
    await expect(page.getByLabel("Nombre del negocio")).toBeVisible();
    releaseStart();
    await expect(
      page.getByRole("button", { name: /Reenviar enlace/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Crear cuenta" }),
    ).toBeEnabled();
    await page.getByLabel("Nombre del negocio").fill("Comedor");
    await page.getByLabel("Contraseña").fill("una-clave-muy-larga-123");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(
      page.getByRole("heading", { name: "¡Tu cuenta está lista!" }),
    ).toBeVisible();
  } finally {
    releaseStart();
    await fixture.close();
  }
});
