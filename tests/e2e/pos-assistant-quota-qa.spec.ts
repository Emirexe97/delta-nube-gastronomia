import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomInt } from "node:crypto";

// Opt-in only: packaged Electron + isolated QA authority/control tunnel.
test.skip(process.env.POS_QA_E2E !== "1", "Opt-in isolated packaged QA only.");

let app: ElectronApplication | undefined;
let page: Page | undefined;
let profile = "";
test.setTimeout(240_000);

test.afterEach(async () => {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
    )
    .catch(() => undefined);
  await app?.close().catch(() => undefined);
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-pos-ui-qa-profile-")
    )
      throw new Error("Unsafe disposable QA profile cleanup");
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
    profile = "";
  }
});

test("respeta cooldown y cupos IA sin bloquear FAQs en perfil empaquetado QA", async ({}, testInfo) => {
  const appDir = process.env.POS_QA_APP_DIR;
  const qaUrl = process.env.POS_QA_URL;
  const controlUrl = process.env.POS_QA_CONTROL_URL;
  const publicKeyFile = process.env.POS_QA_PUBLIC_KEY_FILE;
  const businessName = process.env.POS_QA_BUSINESS_NAME;
  if (!appDir || !qaUrl || !controlUrl || !publicKeyFile || !businessName)
    throw new Error(
      "Faltan POS_QA_APP_DIR, POS_QA_URL, POS_QA_CONTROL_URL, POS_QA_PUBLIC_KEY_FILE o POS_QA_BUSINESS_NAME.",
    );
  const resolvedAppDir = resolve(appDir);
  const fromTemp = relative(resolve(tmpdir()), resolvedAppDir);
  const tempRootName = fromTemp.split(/[\\/]/)[0] ?? "";
  if (
    !resolvedAppDir.toLowerCase().includes("win-unpacked") ||
    fromTemp.startsWith("..") ||
    !tempRootName.startsWith("gastronomy-pos-ui-qa-")
  )
    throw new Error(
      "POS_QA_APP_DIR debe ser un win-unpacked temporal gastronomy-pos-ui-qa-*, nunca una instalación.",
    );
  const parsedQaUrl = new URL(qaUrl);
  const parsedControlUrl = new URL(controlUrl);
  if (
    parsedQaUrl.protocol !== "https:" ||
    parsedQaUrl.hostname !== "127.0.0.1" ||
    parsedControlUrl.protocol !== "http:" ||
    parsedControlUrl.hostname !== "127.0.0.1" ||
    /production|prod\.deltanube/i.test(qaUrl)
  )
    throw new Error(
      "POS_QA_URL/control deben apuntar a túneles loopback QA aislados; el authority de licencias debe usar HTTPS.",
    );
  const resolvedApp = resolve(resolvedAppDir);
  const appResources = join(resolvedApp, "resources", "app");
  await writeFile(
    join(appResources, "licensing-config.json"),
    JSON.stringify({
      serverUrl: qaUrl,
      publicKey: await readFile(resolve(publicKeyFile), "utf8"),
    }),
  );
  await writeFile(
    join(appResources, "updates-config.json"),
    JSON.stringify({ enabled: false }),
  );
  profile = await mkdtemp(join(tmpdir(), "gastronomy-pos-ui-qa-profile-"));
  app = await electron.launch({
    executablePath: join(resolvedApp, "Delta Nube Gastronomía.exe"),
    args: [`--user-data-dir=${profile}`],
    cwd: resolvedApp,
    env: { ...process.env },
  });
  expect(
    await app.evaluate(({ app: electronApp }) => electronApp.isPackaged),
  ).toBe(true);
  expect(
    resolve(
      await app.evaluate(({ app: electronApp }) =>
        electronApp.getPath("userData"),
      ),
    ),
  ).toBe(resolve(profile));
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.evaluate(
    (name) => window.gastronomy.requestLicenseAccess({ businessName: name }),
    businessName,
  );
  await expect
    .poll(
      async () =>
        (await page!.evaluate(() => window.gastronomy.refreshLicense())).state,
      { timeout: 60_000 },
    )
    .toBe("ACTIVE");

  const pin = String(randomInt(100_000, 999_999));
  const staffNumbers = [
    randomInt(700_000, 900_000),
    randomInt(700_000, 900_000),
    randomInt(700_000, 900_000),
    randomInt(700_000, 900_000),
  ];
  const actors = await page.evaluate(
    async ({ staffNumbers, pin, businessName }) => {
      const api = window.gastronomy;
      const users = [];
      for (const [index, staffNumber] of staffNumbers.entries())
        users.push(
          await api.createUser({
            staffNumber,
            fullName: `QA Cuota ${index + 1} ${businessName}`,
            roleCode: "MANAGER",
            pin,
            authorizerPin: "1234",
          }),
        );
      const category = await api.createCategory({
        name: `QA cuota ${staffNumbers[0]}`,
        stockControlEnabled: false,
      });
      const product = await api.createProduct({
        categoryId: category.id,
        name: `Producto QA ${staffNumbers[0]}`,
        code: `QA-${staffNumbers[0]}`,
        prices: ["SALON", "TAKEAWAY", "DELIVERY"].map((priceListCode) => ({
          priceListCode,
          amountMinor: 1_234_500,
        })),
      });
      const session = await api.openCashSession({
        openingAmountMinor: 0,
        note: "Venta descartable QA cuotas",
      });
      const order = await api.createOrder({
        type: "TAKEAWAY",
        customerName: `QA ${businessName}`,
        customerPhone: "1100000000",
      });
      await api.addOrderItem({ orderId: order.id, productId: product.id });
      const withItem = (await api.bootstrap()).orders.find(
        (item) => item.id === order.id,
      );
      if (!withItem || withItem.totalMinor !== 1_234_500)
        throw new Error("La venta QA debe ser exactamente $12.345.");
      const confirmed = await api.confirmOrder({ orderId: order.id });
      await api.payOrder({
        orderId: order.id,
        payments: [{ methodCode: "CASH", amountMinor: withItem.totalMinor }],
      });
      await api.updateOrderStatus({
        orderId: confirmed.id,
        status: "DELIVERED",
      });
      return {
        users: users.map((user) => ({
          id: user.id,
          staffNumber: user.staffNumber,
        })),
        date: session.businessDate,
      };
    },
    { staffNumbers, pin, businessName },
  );

  const control = async (path: string, init?: RequestInit) => {
    const response = await fetch(new URL(path, controlUrl), init);
    if (!response.ok)
      throw new Error(
        `QA control ${path}: HTTP ${response.status} ${await response.text()}`,
      );
    return response.json() as Promise<{
      providerCalls: number;
      quotaDenials?: {
        cooldown: number;
        user: number;
        merchant: number;
        total: number;
      };
      upstreamStatuses?: number[];
    }>;
  };
  const seed = async (
    scenario: "cooldown" | "user" | "merchant" | "reset",
    actorId: string,
  ) =>
    control("/qa/scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario, actorId }),
    });
  const status = () => control("/qa/status");
  const trigger = page.getByRole("button", {
    name: "Preguntale al POS",
    exact: true,
  });
  await trigger.click();
  const assistant = page.getByRole("dialog", {
    name: "Asistente del POS",
    exact: true,
  });
  await expect(assistant).toBeVisible();

  const askAi = async (actorIndex: number) => {
    const search = assistant.getByRole("searchbox", {
      name: "Buscar una pregunta",
    });
    await search.fill("¿Cuánto vendimos hoy?");
    if (!(await assistant.getByLabel("Número de personal").isVisible())) {
      await assistant
        .getByRole("button", { name: "Consultar con IA", exact: true })
        .click();
    }
    await assistant
      .getByLabel("Número de personal")
      .fill(String(actors.users[actorIndex].staffNumber));
    await assistant.getByLabel("PIN", { exact: true }).fill(pin);
    await assistant
      .getByRole("button", { name: "Enviar consulta", exact: true })
      .click();
  };
  const expectFaqWithoutProvider = async (
    expectedCalls: number,
    screenshotName: string,
  ) => {
    for (let i = 0; i < 3; i++) {
      await assistant
        .getByRole("searchbox", { name: "Buscar una pregunta" })
        .fill("¿Cuánto vendimos hoy?");
      await assistant
        .getByRole("button", { name: "¿Cuánto vendimos hoy?", exact: true })
        .click();
      await expect(assistant.locator(".pos-assistant__answer")).toContainText(
        "12.345",
      );
    }
    await expect
      .poll(async () => (await status()).providerCalls)
      .toBe(expectedCalls);
    await page!
      .screenshot({
        path: testInfo.outputPath(screenshotName),
        fullPage: false,
        timeout: 8000,
      })
      .catch(() => console.log("QA: captura opcional no disponible"));
  };
  const denyAndFaq = async (
    actorIndex: number,
    message: string,
    remaining: RegExp,
    calls: number,
    name: string,
  ) => {
    const before = await status();
    await askAi(actorIndex);
    const aiStatus = assistant.locator(".pos-assistant__ai-status");
    await expect(aiStatus).toContainText(message);
    await expect(assistant.locator(".pos-assistant__quota")).toHaveText(
      remaining,
    );
    expect((await status()).providerCalls).toBe(before.providerCalls);
    await page!
      .screenshot({
        path: testInfo.outputPath(`${name}-denial.png`),
        fullPage: false,
        timeout: 8000,
      })
      .catch(() => console.log("QA: captura opcional no disponible"));
    await expectFaqWithoutProvider(calls, `${name}-faq.png`);
  };

  // Actor #1: rolling cooldown denial, then three local FAQ answers.
  await seed("cooldown", actors.users[0].id);
  await denyAndFaq(0, "Esperá", /usuario: 19 · comercio: 99/, 0, "cooldown");
  // Verify cooldown is temporary via elapsed wall time, not clock manipulation.
  await page.waitForTimeout(61_000);
  const beforeCooldownRecovery = await status();
  await askAi(0);
  await expect(assistant.locator(".pos-assistant__ai-status")).toContainText(
    "La respuesta se obtuvo del catálogo local del POS",
  );
  await expect(assistant.locator(".pos-assistant__quota")).toHaveText(
    "Cupo restante · usuario: 18 · comercio: 98",
  );
  await expect
    .poll(async () => (await status()).providerCalls)
    .toBe(beforeCooldownRecovery.providerCalls + 1);
  // Actor #2: old 19 requests -> 20th allowed; immediate 21st request is a daily-limit denial.
  await seed("user", actors.users[1].id);
  const beforeAllowed = await status();
  await askAi(1);
  await expect(assistant.locator(".pos-assistant__ai-status")).toContainText(
    "La respuesta se obtuvo del catálogo local del POS",
  );
  await expect(assistant.locator(".pos-assistant__quota")).toHaveText(
    "Cupo restante · usuario: 0 · comercio: 80",
  );
  await expect
    .poll(async () => (await status()).providerCalls)
    .toBe(beforeAllowed.providerCalls + 1);
  await denyAndFaq(
    1,
    "Alcanzaste tu cupo diario",
    /usuario: 0 · comercio: 80/,
    2,
    "user-daily-limit",
  );
  // Actor #3 is the 100th request; actor #4 is a fresh identity for request 101.
  // Authority seeds 99 aged merchant rows under distinct QA actor IDs.
  await seed("merchant", actors.users[2].id);
  const beforeMerchantAllowed = await status();
  await askAi(2);
  await expect(assistant.locator(".pos-assistant__ai-status")).toContainText(
    "La respuesta se obtuvo del catálogo local del POS",
  );
  await expect(assistant.locator(".pos-assistant__quota")).toHaveText(
    "Cupo restante · usuario: 19 · comercio: 0",
  );
  await expect
    .poll(async () => (await status()).providerCalls)
    .toBe(beforeMerchantAllowed.providerCalls + 1);
  await denyAndFaq(
    3,
    "Se alcanzó el cupo diario de IA del comercio",
    /usuario: 20 · comercio: 0/,
    3,
    "merchant-daily-limit",
  );
  const final = await status();
  expect(final.providerCalls).toBe(3);
  await testInfo.attach("pos-quota-qa-receipt", {
    body: JSON.stringify(
      {
        businessName,
        actors: actors.users.map((u) => u.id),
        providerCalls: final.providerCalls,
        quotaDenials: final.quotaDenials,
        upstreamStatuses: final.upstreamStatuses,
        allowedRequests: 3,
        denials: ["cooldown", "user_daily_limit", "merchant_daily_limit"],
        cooldownRecovered: true,
        faqRepetitionsPerDenial: 3,
        isolatedProfile: true,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
