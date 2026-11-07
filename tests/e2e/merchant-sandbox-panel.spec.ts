import { test, expect } from "@playwright/test";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

test("adhesión sandbox es un ensayo separado, cancelable y re-adherible", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { createLicenseServer } =
    await import("../../apps/licensing-service/dist/server.js");
  const { hashPanelPassword } =
    await import("../../apps/licensing-service/dist/panel-auth.js");
  const profile = await mkdtemp(join(tmpdir(), "merchant-sandbox-panel-e2e-"));
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  const username = "owner-sandbox-e2e";
  const password = randomBytes(24).toString("base64url");
  const buyerEmail = "buyer_test@testuser.com";
  const webhookSecret = randomBytes(32).toString("hex");
  const providerSubscriptions = new Map<
    string,
    {
      id: string;
      reference: string;
      payerEmail: string;
      amountCents: number;
      status: "PENDING" | "CANCELLED";
      checkoutUrl: null;
    }
  >();
  let nextSubscription = 0;
  const gateway = {
    buyerEmail,
    async create(input: {
      reference: string;
      payerEmail: string;
      amountCents: number;
    }) {
      const sub = {
        id: `mock-sub-${++nextSubscription}`,
        reference: input.reference,
        payerEmail: input.payerEmail,
        amountCents: input.amountCents,
        status: "PENDING" as const,
        // Never create or visit an external checkout in this browser test.
        checkoutUrl: null,
      };
      providerSubscriptions.set(sub.id, sub);
      return sub;
    },
    async getSubscription(id: string) {
      const sub = providerSubscriptions.get(id);
      if (!sub) throw new Error("unknown mocked subscription");
      return sub;
    },
    async cancel(id: string) {
      const sub = providerSubscriptions.get(id);
      if (!sub) throw new Error("unknown mocked subscription");
      const cancelled = { ...sub, status: "CANCELLED" as const };
      providerSubscriptions.set(id, cancelled);
      return cancelled;
    },
    async getCharge() {
      throw new Error("No charge is created in this rehearsal-only test");
    },
  };

  const portServer = createServer();
  await new Promise<void>((resolve, reject) => {
    portServer.once("error", reject);
    portServer.listen(0, "127.0.0.1", resolve);
  });
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
    sandboxBilling: { gateway, webhookSecret },
  });
  const merchantId = "sandbox-e2e-merchant-01";
  const paidThrough = new Date(Date.now() + 40 * 86_400_000).toISOString();
  try {
    await new Promise<void>((resolve, reject) =>
      authority.server.listen(port, "127.0.0.1", (error?: Error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const seedDb = new DatabaseSync(join(profile, "authority.sqlite"));
    try {
      seedDb
        .prepare(
          "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,1,'ACTIVE',?,NULL,?)",
        )
        .run(
          merchantId,
          "Comercio ensayo aislado",
          paidThrough,
          randomBytes(32).toString("hex"),
          new Date().toISOString(),
        );
    } finally {
      seedDb.close();
    }

    await page.goto(origin + "/manage/");
    await page.getByLabel("Usuario", { exact: true }).fill(username);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: /Ingresar/ }).click();
    await expect(
      page.getByRole("heading", { name: "Comercios", exact: true }),
    ).toBeVisible();
    const row = page
      .locator("#merchantsBody tr")
      .filter({ hasText: "Comercio ensayo aislado" });
    await row.getByRole("button", { name: "Ver detalle", exact: true }).click();
    const detail = page.locator("#merchantDetail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("Vigente hasta");
    await expect(detail.locator(".sandbox-card")).toContainText(/ensayo aislado/i);

    await detail
      .getByRole("button", { name: /Crear enlace de adhesión de prueba/ })
      .click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("No se realizará un cobro real");
    await dialog
      .getByLabel("Email del comprador de pruebas", { exact: true })
      .fill(buyerEmail);
    await dialog
      .getByLabel("Precio mensual simulado (ARS)", { exact: true })
      .fill("14990.00");
    await dialog
      .getByRole("button", { name: "Crear enlace sandbox", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(detail).toContainText("Prueba: Pendiente");
    await expect(detail).toContainText(buyerEmail);
    await expect(detail).toContainText(/no cambia el acceso/i);
    await expect(
      detail.getByRole("link", { name: "Abrir enlace de prueba" }),
    ).toHaveCount(0);
    const firstRef = await detail
      .locator(".field-help")
      .filter({ hasText: "Referencia de proveedor:" })
      .textContent();
    await expect.poll(() => providerSubscriptions.size).toBe(1);

    await detail
      .getByRole("button", { name: "Verificar ensayo", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Consulta el estado con el proveedor sandbox",
    );
    await dialog
      .getByRole("button", { name: "Verificar ensayo", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(detail).toContainText("Prueba: Pendiente");

    page.once("dialog", (browserDialog) => browserDialog.accept());
    await detail
      .getByRole("button", { name: "Cancelar prueba", exact: true })
      .click();
    await expect(detail).toContainText("Prueba: Cancelada");
    await expect(
      detail.getByRole("button", { name: "Cancelar prueba", exact: true }),
    ).toHaveCount(0);

    await detail
      .getByRole("button", { name: /Crear otro enlace de adhesión de prueba/ })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Email del comprador de pruebas", { exact: true })
      .fill(buyerEmail);
    await dialog
      .getByLabel("Precio mensual simulado (ARS)", { exact: true })
      .fill("14990.00");
    await dialog
      .getByRole("button", { name: "Crear enlace sandbox", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(detail).toContainText("Prueba: Pendiente");
    await expect.poll(() => providerSubscriptions.size).toBe(2);
    const secondRef = await detail
      .locator(".field-help")
      .filter({ hasText: "Referencia de proveedor:" })
      .textContent();
    expect(secondRef).not.toEqual(firstRef);

    const verifyDb = new DatabaseSync(join(profile, "authority.sqlite"));
    try {
      const actualExpiry = (
        verifyDb
          .prepare("SELECT paid_through FROM licenses WHERE id=?")
          .get(merchantId) as { paid_through: string }
      ).paid_through;
      expect(actualExpiry).toBe(paidThrough);
      expect(
        (
          verifyDb
            .prepare("SELECT count(*) AS n FROM renewals WHERE license_id=?")
            .get(merchantId) as { n: number }
        ).n,
      ).toBe(0);
      expect(
        (
          verifyDb
            .prepare(
              "SELECT count(*) AS n FROM merchant_payments WHERE license_id=?",
            )
            .get(merchantId) as { n: number }
        ).n,
      ).toBe(0);
      expect(
        (
          verifyDb
            .prepare("SELECT count(*) AS n FROM mp_test_receipts")
            .get() as { n: number }
        ).n,
      ).toBe(0);
    } finally {
      verifyDb.close();
    }
  } finally {
    authority.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});
