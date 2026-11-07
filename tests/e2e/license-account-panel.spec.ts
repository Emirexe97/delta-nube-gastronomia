import { test, expect } from "@playwright/test";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

test("panel crea cuenta y restablece contraseña sin guardar credenciales en texto plano", async ({ page }) => {
  test.setTimeout(45_000);
  const { createLicenseServer } = await import("../../apps/licensing-service/dist/server.js");
  const { hashPanelPassword } = await import("../../apps/licensing-service/dist/panel-auth.js");
  const profile = await mkdtemp(join(tmpdir(), "license-account-panel-e2e-"));
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const admin = randomBytes(32).toString("base64url");
  const panelPassword = randomBytes(24).toString("base64url");
  const owner = "owner@example.test";
  const firstPassword = randomBytes(20).toString("base64url");
  const replacementPassword = randomBytes(20).toString("base64url");
  const portServer = createServer();
  await new Promise<void>((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = (portServer.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const authority = createLicenseServer({
    dbPath: join(profile, "authority.sqlite"),
    adminToken: admin,
    privateKey: keys.privateKey,
    panelAuth: { username: "owner", passwordHash: await hashPanelPassword(panelPassword), origin },
  });
  try {
    await new Promise<void>((resolve, reject) => authority.server.listen(port, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve()));
    const created = await fetch(origin + "/admin/licenses", {
      method: "POST",
      headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
      body: JSON.stringify({ businessName: "Panel account fixture", paidThrough: new Date(Date.now() + 30 * 86_400_000).toISOString() }),
    });
    expect(created.status).toBe(201);
    const { license } = await created.json();

    await page.goto(origin + "/manage/");
    await page.getByLabel("Usuario", { exact: true }).fill("owner");
    await page.getByLabel("Contraseña", { exact: true }).fill(panelPassword);
    await page.getByRole("button", { name: /Ingresar/ }).click();
    await expect(page.getByRole("heading", { name: "Licencias", exact: true })).toBeVisible();
    await page.locator("details.legacy-licenses > summary").click();
    const row = page.locator("#licensesBody tr").filter({ hasText: "Panel account fixture" });

    await row.getByRole("button", { name: "Crear cuenta", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Correo de la cuenta", { exact: true }).fill(owner);
    await dialog.getByLabel("Nueva contraseña", { exact: true }).fill(firstPassword);
    await dialog.getByLabel("Repetir contraseña", { exact: true }).fill("different-password-value");
    await dialog.locator('[name="reason"]').fill("Alta autorizada en fixture local");
    await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Las contraseñas no coinciden");
    await dialog.getByLabel("Nueva contraseña", { exact: true }).fill(firstPassword);
    await dialog.getByLabel("Repetir contraseña", { exact: true }).fill(firstPassword);
    await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(row).toContainText(`Cuenta · ${owner}`);

    const db = new DatabaseSync(join(profile, "authority.sqlite"));
    try {
      const account = db.prepare("SELECT email, password_hash FROM accounts WHERE license_id = ?").get(license.id) as { email: string; password_hash: string };
      expect(account.email).toBe(owner);
      expect(account.password_hash).not.toContain(firstPassword);
      const initialHash = account.password_hash;

      await row.getByRole("button", { name: "Restablecer contraseña", exact: true }).click();
      dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Correo de la cuenta", { exact: true })).toHaveValue(owner);
      await dialog.getByLabel("Nueva contraseña", { exact: true }).fill(replacementPassword);
      await dialog.getByLabel("Repetir contraseña", { exact: true }).fill(replacementPassword);
      await dialog.locator('[name="reason"]').fill("Restablecimiento verificado en fixture local");
      await dialog.getByRole("button", { name: "Guardar cuenta", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const updated = db.prepare("SELECT email, password_hash FROM accounts WHERE license_id = ?").get(license.id) as { email: string; password_hash: string };
      expect(updated.email).toBe(owner);
      expect(updated.password_hash).not.toBe(initialHash);
      expect(updated.password_hash).not.toContain(replacementPassword);
    } finally { db.close(); }
  } finally {
    authority.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});
