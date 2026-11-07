import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatMoney } from "../../packages/domain/src/money";

let app: ElectronApplication;
let page: Page;
let profile = "";

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "gastronomy-pos-assistant-"));
  app = await electron.launch({
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  expect(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
  ).toBe(resolve(profile));
});

test.afterEach(async () => {
  await app?.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
  );
  await app?.close();
  if (profile) {
    if (
      dirname(resolve(profile)) !== resolve(tmpdir()) ||
      !basename(profile).startsWith("gastronomy-pos-assistant-")
    )
      throw new Error("Unsafe disposable profile cleanup");
    await rm(profile, { recursive: true, force: true });
    profile = "";
  }
});

test("el asistente offline se abre desde la topbar, resuelve una pregunta y permite buscar", async () => {
  const fixture = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    const session = await api.openCashSession({ openingAmountMinor: 100_000 });
    const draft = await api.createOrder({
      type: "TAKEAWAY",
      customerName: "Venta asistente offline",
      customerPhone: "1155550199",
    });
    await api.addOrderItem({
      orderId: draft.id,
      productId: data.products[0]!.id,
    });
    const withItem = (await api.bootstrap()).orders.find(
      (item) => item.id === draft.id,
    )!;
    const confirmed = await api.confirmOrder({ orderId: draft.id });
    await api.payOrder({
      orderId: draft.id,
      payments: [{ methodCode: "CASH", amountMinor: withItem.totalMinor }],
    });
    await api.updateOrderStatus({ orderId: confirmed.id, status: "DELIVERED" });
    return { date: session.businessDate, orderTotalMinor: withItem.totalMinor };
  });

  const internetRequests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) internetRequests.push(request.url());
  });
  await page.context().setOffline(true);
  await page.reload();
  const report = await page.evaluate(
    async (date) =>
      window.gastronomy.getDetailedReport({ dateFrom: date, dateTo: date }),
    fixture.date,
  );
  expect(report.salesTotalMinor).toBeGreaterThanOrEqual(
    fixture.orderTotalMinor,
  );
  expect(report.orderCount).toBeGreaterThanOrEqual(1);

  const trigger = page.getByRole("button", {
    name: "Preguntale al POS",
    exact: true,
  });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();

  const assistant = page.getByRole("dialog", {
    name: "Asistente del POS",
    exact: true,
  });
  await expect(assistant).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const search = assistant.getByRole("searchbox", {
    name: "Buscar una pregunta",
  });
  await expect(search).toBeFocused();
  await expect(assistant.getByRole("listitem")).toHaveCount(10);

  const question = assistant.getByRole("button", {
    name: "¿Cuánto vendimos hoy?",
    exact: true,
  });
  const expectedAnswer = `Día comercial ${fixture.date.split("-").reverse().join("/")}: ${formatMoney(report.salesTotalMinor)} en ${report.orderCount} ${report.orderCount === 1 ? "pedido" : "pedidos"}.`;
  await expect(question).toBeVisible();
  await question.click();
  const answer = assistant.getByRole("status");
  await expect(answer).toContainText("Informe");
  await expect(answer).toContainText(expectedAnswer);

  // Keep a visual reference of the trigger and its open panel on the desktop.
  const panelBox = await assistant.boundingBox();
  const triggerBox = await trigger.boundingBox();
  if (panelBox && triggerBox) {
    await page.screenshot({
      path: test.info().outputPath("preguntale-al-pos.png"),
      clip: {
        x: Math.max(0, panelBox.x - 5),
        y: triggerBox.y - 3,
        width: panelBox.width + 10,
        height: panelBox.y + panelBox.height - triggerBox.y + 8,
      },
    });
  }

  await search.fill("caja");
  const matchingLocalQuestions = await assistant.getByRole("listitem").count();
  expect(matchingLocalQuestions).toBeGreaterThan(0);
  await expect(
    assistant.getByRole("button").filter({ hasText: /caja/i }).first(),
  ).toBeVisible();
  await expect(
    assistant.getByRole("button", { name: "Consultar con IA", exact: true }),
  ).toBeVisible();
  // Opening the credentials step is not a request; only submitting it can call the bridge.
  await assistant
    .getByRole("button", { name: "Consultar con IA", exact: true })
    .click();
  await expect(
    assistant.getByLabel("Número de personal", { exact: false }),
  ).toBeVisible();
  await expect(assistant.getByLabel("PIN", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("listitem")).toHaveCount(matchingLocalQuestions);
  // This test installation is not enrolled; these synthetic values never leave the device.
  await page.context().setOffline(false);
  await assistant.getByLabel("Número de personal").fill("99999999");
  await assistant.getByLabel("PIN", { exact: true }).fill("0000");
  await assistant
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .click();
  await expect(assistant.getByRole("status")).toContainText(
    "no está disponible",
  );
  await expect(assistant.getByRole("listitem")).toHaveCount(matchingLocalQuestions);
  await assistant
    .getByRole("button", { name: "¿Cómo está la caja actual?", exact: true })
    .click();
  await expect(assistant.getByRole("status")).toContainText("caja");
  expect(internetRequests).toEqual([]);
});

test("el panel entra en un viewport angosto y se cierra al hacer clic afuera", async () => {
  await page.setViewportSize({ width: 500, height: 850 });
  expect(await page.evaluate(() => window.innerWidth)).toBe(500);
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
  const bounds = await assistant.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  await page.mouse.click(8, viewport!.height - 8);
  await expect(assistant).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("Escape cierra el asistente y devuelve el foco a la topbar", async () => {
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
  await page.keyboard.press("Escape");
  await expect(assistant).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});
