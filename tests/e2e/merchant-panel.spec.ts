import { test, expect } from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

test("panel de comercios separa alta, pagos manuales, cortesía y acceso", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { createLicenseServer } =
    await import("../../apps/licensing-service/dist/server.js");
  const { hashPanelPassword } =
    await import("../../apps/licensing-service/dist/panel-auth.js");
  const profile = await mkdtemp(join(tmpdir(), "merchant-panel-e2e-"));
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const username = "owner";
  const password = randomBytes(24).toString("base64url");
  const futureDate = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const portServer = createServer();
  await new Promise<void>((resolve) =>
    portServer.listen(0, "127.0.0.1", resolve),
  );
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    portServer.close((error) => (error ? reject(error) : resolve())),
  );
  const origin = `http://127.0.0.1:${port}`;
  const authority = createLicenseServer({
    dbPath: join(profile, "authority.sqlite"),
    adminToken: randomBytes(32).toString("base64url"),
    privateKey: keys.privateKey,
    panelAuth: {
      username,
      passwordHash: await hashPanelPassword(password),
      origin,
    },
  });
  try {
    await new Promise<void>((resolve, reject) =>
      authority.server.listen(port, "127.0.0.1", (error?: Error) =>
        error ? reject(error) : resolve(),
      ),
    );
    await page.goto(origin + "/manage/");
    await page.getByLabel("Usuario", { exact: true }).fill(username);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: /Ingresar/ }).click();
    await expect(
      page.getByRole("heading", { name: "Comercios", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#sandboxNotice")).toBeVisible();
    await expect(page.locator("#sandboxNotice")).toContainText("deshabilitado");
    await expect(page.locator("#sandboxNotice")).toContainText(
      "No se realizarán operaciones de cobro automático",
    );

    await page.getByRole("button", { name: /Alta de comercio/ }).click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Nombre del comercio", { exact: true })
      .fill("Comercio E2E pago");
    await expect(dialog.locator('[name="indefinite"]')).not.toBeChecked();
    await expect(
      dialog.getByLabel("Vigente hasta", { exact: true }),
    ).toHaveValue(/\d{4}-\d{2}-\d{2}/);
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Alta de prueba del panel");
    await dialog
      .getByRole("button", { name: "Crear comercio", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    const row = page
      .locator("#merchantsBody tr")
      .filter({ hasText: "Comercio E2E pago" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Sin pagos registrados");
    await row.getByRole("button", { name: "Ver detalle", exact: true }).click();
    const detail = page.locator("#merchantDetail");
    await expect(detail).toBeVisible();
    await expect(
      detail.getByText("Sin pagos registrados", { exact: true }),
    ).toBeVisible();

    await detail
      .getByRole("button", { name: "Registrar pago ARS", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Importe recibido (ARS)", { exact: true })
      .fill("12500.50");
    await dialog
      .getByLabel("Vigente hasta", { exact: true })
      .fill(futureDate(120));
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Transferencia verificada en fixture");
    await dialog
      .getByRole("button", { name: "Registrar pago manual", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(detail).toContainText("Pago manual registrado");
    await expect(detail).toContainText("12.500,50");
    await expect(row).toContainText("12.500,50");

    await detail
      .getByRole("button", { name: "Suspender acceso", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Verificación administrativa pendiente");
    await dialog
      .getByRole("button", { name: "Suspender acceso", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(detail).toContainText("Suspendido");
    await expect(
      detail.getByRole("button", { name: "Reactivar acceso", exact: true }),
    ).toBeVisible();
    await detail
      .getByRole("button", { name: "Reactivar acceso", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Identidad verificada");
    await dialog
      .getByRole("button", { name: "Reactivar acceso", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(detail).toContainText("Activo");

    // La cortesía no pide ni registra un importe; se valida el tipo de evento y la ausencia de pagos.
    await page.getByRole("button", { name: /Alta de comercio/ }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Nombre del comercio", { exact: true })
      .fill("Comercio E2E cortesía");
    await dialog
      .getByLabel("Vigente hasta", { exact: true })
      .fill(futureDate(30));
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Alta para probar cortesía");
    await dialog
      .getByRole("button", { name: "Crear comercio", exact: true })
      .click();
    const courtesyRow = page
      .locator("#merchantsBody tr")
      .filter({ hasText: "Comercio E2E cortesía" });
    await courtesyRow
      .getByRole("button", { name: "Ver detalle", exact: true })
      .click();
    const courtesyDetail = page.locator("#merchantDetail");
    await courtesyDetail
      .getByRole("button", { name: "Cargar cortesía", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Importe recibido (ARS)")).toHaveCount(0);
    await dialog
      .getByLabel("Vigente hasta", { exact: true })
      .fill(futureDate(180));
    await dialog
      .getByLabel("Motivo", { exact: true })
      .fill("Cortesía aprobada para onboarding");
    await dialog
      .getByRole("button", { name: "Aplicar cortesía", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(courtesyDetail).toContainText("Cortesía aplicada");
    await expect(courtesyDetail).toContainText(
      "Cortesía aprobada para onboarding",
    );
    await expect(courtesyRow).toContainText("Sin pagos registrados");

    const db = new DatabaseSync(join(profile, "authority.sqlite"));
    try {
      const paymentCount = db
        .prepare(
          "SELECT COUNT(*) AS count FROM merchant_payments WHERE kind = 'PAYMENT'",
        )
        .get() as { count: number };
      const courtesyCount = db
        .prepare(
          "SELECT COUNT(*) AS count FROM merchant_payments WHERE kind = 'COURTESY'",
        )
        .get() as { count: number };
      expect(paymentCount.count).toBe(1);
      expect(courtesyCount.count).toBe(1);
    } finally {
      db.close();
    }
  } finally {
    authority.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});
