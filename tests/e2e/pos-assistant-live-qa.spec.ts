import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { randomInt } from "node:crypto";
import { formatMoney } from "../../packages/domain/src/money";

// Deliberately excluded from ordinary CI. It uses a temporary packaged runtime
// and a real, isolated QA licensing/AI authority; never point it at production.
const enabled = process.env.POS_QA_E2E === "1";
test.skip(!enabled, "Opt-in live QA only; requires an isolated QA authority.");

let app: ElectronApplication | undefined;
let page: Page | undefined;
let profile = "";

test.setTimeout(180_000);

test.afterEach(async () => {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
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

test("compara venta real con respuesta IA visible en Electron empaquetado QA", async ({}, testInfo) => {
  const appDir = process.env.POS_QA_APP_DIR;
  const qaUrl = process.env.POS_QA_URL;
  const publicKeyFile = process.env.POS_QA_PUBLIC_KEY_FILE;
  const businessName = process.env.POS_QA_BUSINESS_NAME;
  if (!appDir || !qaUrl || !publicKeyFile || !businessName)
    throw new Error(
      "Faltan POS_QA_APP_DIR, POS_QA_URL, POS_QA_PUBLIC_KEY_FILE o POS_QA_BUSINESS_NAME.",
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
      "POS_QA_APP_DIR debe ser un win-unpacked bajo un tmp/gastronomy-pos-ui-qa-* efímero, nunca un runtime instalado.",
    );
  const executable = join(resolvedAppDir, "Delta Nube Gastronomía.exe");
  const licensingConfig = join(
    resolvedAppDir,
    "resources",
    "app",
    "licensing-config.json",
  );
  const publicKey = await readFile(resolve(publicKeyFile), "utf8");
  const parsedQaUrl = new URL(qaUrl);
  if (
    parsedQaUrl.protocol !== "https:" ||
    parsedQaUrl.hostname !== "127.0.0.1" ||
    /production|prod\.deltanube/i.test(qaUrl)
  )
    throw new Error(
      "POS_QA_URL debe ser HTTPS en 127.0.0.1 hacia autoridad QA aislada, no producción.",
    );
  await writeFile(
    licensingConfig,
    JSON.stringify({ serverUrl: qaUrl, publicKey }),
  );
  // Disable updates only in this temporary packaged copy, never the source or
  // installed application.
  await writeFile(
    join(resolvedAppDir, "resources", "app", "updates-config.json"),
    JSON.stringify({ enabled: false }),
  );

  profile = await mkdtemp(join(tmpdir(), "gastronomy-pos-ui-qa-profile-"));
  app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${profile}`],
    cwd: resolvedAppDir,
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
  // The isolated authority approves only this QA fixture; refresh is the real
  // licensing path that receives the signed lease.
  await expect
    .poll(
      async () =>
        (await page!.evaluate(() => window.gastronomy.refreshLicense())).state,
      {
        timeout: 60_000,
        message: "Esperando aprobación/lease activa del authority QA aislado",
      },
    )
    .toBe("ACTIVE");

  // Disposable operator identity; random staff number and PIN are created only
  // in the fresh SQLite profile and submitted through the actual assistant UI.
  const staffNumber = randomInt(700_000, 900_000);
  const pin = String(randomInt(100_000, 999_999));
  const fixture = await page.evaluate(
    async ({ staffNumber, pin, businessName }) => {
      const api = window.gastronomy;
      const operator = await api.createUser({
        staffNumber,
        fullName: `QA IA ${businessName}`,
        roleCode: "MANAGER",
        pin,
        authorizerPin: "1234",
      });
      const category = await api.createCategory({
        name: `QA ${businessName} ${staffNumber}`,
        stockControlEnabled: false,
      });
      const product = await api.createProduct({
        categoryId: category.id,
        name: `Producto QA ${staffNumber}`,
        code: `QA-${staffNumber}`,
        prices: [
          { priceListCode: "SALON", amountMinor: 1_234_500 },
          { priceListCode: "TAKEAWAY", amountMinor: 1_234_500 },
          { priceListCode: "DELIVERY", amountMinor: 1_234_500 },
        ],
      });
      const session = await api.openCashSession({
        openingAmountMinor: 0,
        note: "Venta descartable QA IA",
      });
      const draft = await api.createOrder({
        type: "TAKEAWAY",
        customerName: `QA ${businessName}`,
        customerPhone: "1100000000",
      });
      await api.addOrderItem({ orderId: draft.id, productId: product.id });
      const withItem = (await api.bootstrap()).orders.find(
        (item) => item.id === draft.id,
      );
      if (!withItem || withItem.totalMinor <= 0)
        throw new Error("La venta de prueba debe tener importe no cero.");
      const confirmed = await api.confirmOrder({ orderId: draft.id });
      await api.payOrder({
        orderId: draft.id,
        payments: [{ methodCode: "CASH", amountMinor: withItem.totalMinor }],
      });
      await api.updateOrderStatus({
        orderId: confirmed.id,
        status: "DELIVERED",
      });
      return {
        date: session.businessDate,
        totalMinor: withItem.totalMinor,
        staffNumber: operator.staffNumber,
        productName: product.name,
      };
    },
    { staffNumber, pin, businessName },
  );
  expect(fixture.totalMinor).toBeGreaterThan(0);

  // Compare the amount rendered by the actual Reports page, not a report stub.
  await page.getByRole("link", { name: "Informes", exact: true }).click();
  const from = page.getByLabel("Día comercial desde", { exact: true });
  await from.fill(fixture.date);
  await page.getByLabel("Hasta", { exact: true }).fill(fixture.date);
  const visibleReportAmount = formatMoney(fixture.totalMinor);
  await expect(
    page.getByText("Informes operativos", { exact: true }),
  ).toBeVisible();
  const salesKpi = page
    .getByText("Venta total", { exact: true })
    .locator("xpath=..")
    .locator("p")
    .nth(1);
  await expect(salesKpi).toHaveText(visibleReportAmount);
  const moneyText = (value: string) => value.replace(/\s+/g, " ").trim();
  const reportReadout = moneyText(await salesKpi.innerText());
  await page.screenshot({
    path: testInfo.outputPath("pos-live-qa-report-kpi.png"),
    fullPage: false,
  });

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
  const exactQuestion = "¿Cuánto vendimos hoy?";
  await assistant
    .getByRole("searchbox", { name: "Buscar una pregunta" })
    .fill(exactQuestion);
  await assistant
    .getByRole("button", { name: "Consultar con IA", exact: true })
    .click();
  await assistant
    .getByLabel("Número de personal")
    .fill(String(fixture.staffNumber));
  await assistant.getByLabel("PIN", { exact: true }).fill(pin);
  await assistant
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .click();

  // This is the real preload -> IPC -> HTTPS licensing/AI authority path.
  // No bridge replacement, HTTP interception, harness, or deterministic answer.
  const answer = assistant.locator(".pos-assistant__answer");
  await expect(answer).toContainText("Informe", { timeout: 60_000 });
  await expect(answer).toContainText(visibleReportAmount);
  await expect(answer).toContainText(
    fixture.date.split("-").reverse().join("/"),
  );
  await expect(assistant.locator(".pos-assistant__ai-status")).toContainText(
    "La respuesta se obtuvo del catálogo local del POS",
  );
  const visibleAnswer = moneyText(await answer.innerText());
  const answerReadout = visibleAnswer.match(
    /:\s*(\$\s*[\d.,]+)\s+en 1 pedido\./,
  )?.[1];
  expect(answerReadout).toBe(reportReadout);
  console.log(
    `[POS QA PASS] fecha=${fixture.date} informe=${reportReadout} IA=${answerReadout}, 1 pedido`,
  );
  await testInfo.attach("pos-live-qa-result", {
    body: JSON.stringify(
      {
        businessName,
        date: fixture.date,
        productName: fixture.productName,
        visibleReportAmount,
        visibleAnswer: await answer.innerText(),
        packaged: true,
        isolatedProfile: true,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("pos-live-qa-report-and-ai.png"),
    fullPage: false,
  });
});
