import { test, expect, _electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** High-density salon regression: real SQLite/repository and IPC; only the
 * final Electron printer driver is replaced with a deterministic capture. */
test("salón cargado: acceso, concurrencia y agregado confirmado no duplican impresión ni stock", async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-peak-salon-"));
  const electron = createRequire(
    join(process.cwd(), "apps/desktop-shell/package.json"),
  )("electron") as string;
  execFileSync(
    electron,
    [resolve("tests/fixtures/seed-peak-salon.cjs"), profile],
    {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  const app = await _electron.launch({
    executablePath: electron,
    args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
    cwd: process.cwd(),
  });
  try {
    expect(
      resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    ).toBe(resolve(profile));
    const page = await app.firstWindow();
    await page.getByRole("link", { name: "Salón", exact: true }).waitFor();
    // Read the seeded 120-table/3k-product SQLite fixture through the real API.
    const setup = await page.evaluate(async () => {
      const api = window.gastronomy;
      const boot = await api.bootstrap();
      const order = boot.orders.find((o: any) => o.tableNumber === 120);
      const product = boot.products.find((p: any) => p.id === "qa2100");
      if (
        !order ||
        !product ||
        boot.products.length !== 3000 ||
        boot.orders.filter((o: any) => o.type === "DINE_IN").length !== 120
      )
        throw new Error("Fixture de salón pico incompleto");
      return {
        products: boot.products
          .filter((p: any) =>
            [
              "starter-gaseosa",
              "starter-muzza-grande",
              "starter-napo-grande",
              "qa2100",
            ].includes(p.id),
          )
          .map((p: any) => ({
            id: p.id,
            name: p.name,
            stockMinor: p.stockMinor,
          })),
        orderId: order.id,
      };
    });
    await page.reload();
    await page.getByRole("link", { name: "Salón", exact: true }).click();

    // Count bootstrap and relevant IPC calls; this instruments the real handlers.
    await app.evaluate(({ app, ipcMain, BrowserWindow }) => {
      (app as any).__peak = {
        calls: [] as string[],
        printed: [] as unknown[],
        content: [] as string[],
      };
      const handlers = (ipcMain as any)._invokeHandlers as Map<
        string,
        (...args: any[]) => any
      >;
      for (const [key, fn] of handlers)
        if (key.startsWith("gastronomy:"))
          handlers.set(key, (...args: any[]) => {
            (app as any).__peak.calls.push(key.slice("gastronomy:".length));
            return fn(...args);
          });
      const install = (w: any) => {
        w.webContents.getPrintersAsync = async () => [
          { name: "QA salon", isDefault: true },
        ];
        w.webContents.print = (options: unknown, cb: (ok: boolean) => void) => {
          (app as any).__peak.printed.push(options);
          void w.webContents
            .executeJavaScript("document.body.innerText")
            .then((text: string) => {
              (app as any).__peak.content.push(text);
              cb(true);
            })
            .catch(() => cb(false));
        };
      };
      app.on("browser-window-created", (_: unknown, w: any) => install(w));
      BrowserWindow.getAllWindows().forEach(install);
    });
    const tableButton = page.getByRole("button", {
      name: "Abrir pedido de mesa 120",
      exact: true,
    });
    // The initial kitchen ticket is actually dispatched through Electron's
    // mocked native driver before the next round is edited.
    await page.evaluate(
      async (id) =>
        window.gastronomy.printOrder({ orderId: id, kind: "KITCHEN_ORDER" }),
      setup.orderId,
    );
    await expect
      .poll(() => app.evaluate(({ app }) => (app as any).__peak.printed.length))
      .toBe(1);
    await expect
      .poll(() => app.evaluate(({ app }) => (app as any).__peak.content.length))
      .toBe(1);
    const initialTicket = await app.evaluate(
      ({ app }) => (app as any).__peak.content[0],
    );
    for (const item of setup.products.filter((p) => p.id !== "qa2100"))
      expect(initialTicket.toUpperCase()).toContain(item.name.toUpperCase());
    await page.evaluate(async (id) => {
      const order = await window.gastronomy.getOrder({ orderId: id });
      await window.gastronomy.markOrderServed({
        orderId: id,
        expectedServiceRevision: order.serviceRevision!,
      });
    }, setup.orderId);
    await page.reload();
    await page.getByRole("link", { name: "Salón", exact: true }).click();
    await tableButton.click();
    const editor = page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ });
    await expect(editor).toBeVisible();
    await expect(
      editor.getByPlaceholder(/Código, nombre, categoría/),
    ).toBeFocused();
    const original = await page.evaluate(
      async (id) => window.gastronomy.getOrder({ orderId: id }),
      setup.orderId,
    );
    expect(original.items).toHaveLength(3);
    expect(original.servedAt).toBeTruthy();
    const qaProduct = setup.products.find((p: any) => p.id === "qa2100")!;
    const stockBefore = qaProduct.stockMinor;
    await app.evaluate(({ app }) => {
      (app as any).__peak.calls = [];
    });

    const addedName = "QA producto 2100";
    const search = editor.getByPlaceholder(/Código, nombre, categoría/);
    await search.fill("qa2100");
    await editor
      .locator('[id^="order-editor-product-"]')
      .filter({ hasText: addedName })
      .click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              async (id) => window.gastronomy.getOrder({ orderId: id }),
              setup.orderId,
            )
          ).items.length,
      )
      .toBe(4);
    const afterAddition = await page.evaluate(
      async (id) => window.gastronomy.getOrder({ orderId: id }),
      setup.orderId,
    );
    expect(afterAddition.items.length).toBe(4);
    expect(afterAddition.servedAt).toBeNull();
    expect(afterAddition.serviceRevision).toBe(original.serviceRevision! + 1);
    const newItem = afterAddition.items.find(
      (i: any) => i.productId === qaProduct.id,
    );
    expect(newItem?.quantity).toBe(1);
    expect(
      afterAddition.items.filter((i: any) => i.id === original.items[0].id)[0]
        ?.quantity,
    ).toBe(1);
    const printButton = editor.getByRole("button", {
      name: /Reimprimir comanda/,
    });
    await printButton.click();
    const confirmation = page.getByRole("dialog", {
      name: /Confirmar reimpresión/,
    });
    {
      await expect(
        confirmation.getByRole("radio", { name: "Sólo lo agregado" }),
      ).toBeChecked();
      await confirmation
        .getByRole("button", { name: "Reimprimir", exact: true })
        .click();
    }
    await expect
      .poll(() => app.evaluate(({ app }) => (app as any).__peak.printed.length))
      .toBe(2);
    await expect
      .poll(() => app.evaluate(({ app }) => (app as any).__peak.content.length))
      .toBeGreaterThanOrEqual(2);
    const sent = await app.evaluate(
      ({ app }) => (app as any).__peak.content[1],
    );
    expect(sent.toUpperCase()).toContain(addedName.toUpperCase());
    expect(sent).toContain("AGREGADO");
    for (const item of setup.products.filter((p: any) => p.id !== "qa2100"))
      expect(sent.toUpperCase()).not.toContain(item.name.toUpperCase());
    const printState = await page.evaluate(
      async (id) =>
        window.gastronomy.getOrderPrintState({
          orderId: id,
          includeConfirmation: true,
        }),
      setup.orderId,
    );
    const stockAfter = printState.confirmation?.stocks.find(
      (stock: any) => stock.productId === qaProduct.id,
    )?.stockMinor;
    expect(stockBefore).toBe(8000);
    expect(stockAfter).toBe(7000);
    expect(
      printState.order.items.find(
        (item: any) => item.productId === qaProduct.id,
      )?.quantity,
    ).toBe(1);
    expect(printState.order.printCount).toBe(2);
    expect(printState.printJobs).toHaveLength(2);
    expect(printState.printJobs.map((job: any) => job.status)).toEqual([
      "PRINTED",
      "PRINTED",
    ]);
    expect(printState.order.kitchenPrintedQuantities).toEqual(
      Object.fromEntries(
        printState.order.items.map((item: any) => [item.id, item.quantity]),
      ),
    );
    const trace = await app.evaluate(
      ({ app }) => (app as any).__peak.calls as string[],
    );
    expect(trace.filter((c: string) => c === "confirmOrder")).toHaveLength(0);
    expect(trace.filter((c: string) => c === "bootstrap")).toHaveLength(0);

    // Keyboard route for occupied and free table numbers keeps focus in the
    // quick-entry field and opens the corresponding editor without bootstraps.
    await page.keyboard.press("Escape");
    const number = page.getByLabel("Número de mesa", { exact: true });
    await expect(number).toBeFocused();
    await number.fill("120");
    await number.press("Enter");
    await expect(
      page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ }),
    ).toBeVisible();
    const keyboardTrace = await app.evaluate(
      ({ app }) => (app as any).__peak.calls as string[],
    );
    expect(
      keyboardTrace.filter((call: string) => call === "bootstrap"),
    ).toHaveLength(0);
    await app.evaluate(({ app }) => {
      (app as any).__peak.calls = [];
    });
    await page.keyboard.press("Escape");
    await expect(number).toBeFocused();
    await number.fill("121");
    await number.press("Enter");
    await expect(
      page.getByText("Mesa 121 lista", { exact: true }),
    ).toBeVisible();
    const freeTableTrace = await app.evaluate(
      ({ app }) => (app as any).__peak.calls as string[],
    );
    expect(
      freeTableTrace.filter((call: string) => call === "bootstrap"),
    ).toHaveLength(0);
    await app.evaluate(({ app }) => {
      (app as any).__peak.calls = [];
    });
    const waiterNumber = page.getByLabel(/^Número de mozo/);
    await expect(waiterNumber).toBeFocused();
    await waiterNumber.fill("701");
    await waiterNumber.press("Enter");
    const waiterName = page.getByLabel(/^Nombre de mozo/);
    await expect(waiterName).toBeFocused();
    await waiterName.selectOption({ label: "Mozo QA 701" });
    await waiterName.press("Enter");
    await expect(
      page.getByRole("dialog", { name: /Pedido #\d+ · Salón/ }),
    ).toBeVisible();
    await expect(editor).toContainText("Mesa 121");
    const createTrace = await app.evaluate(
      ({ app }) => (app as any).__peak.calls as string[],
    );
    expect(createTrace.filter((op) => op === "createOrder")).toHaveLength(1);
    expect(createTrace).not.toContain("bootstrap");

    // Concurrent requests by two distinct waiters must converge on one order.
    const race = await page.evaluate(async () => {
      const api = window.gastronomy,
        b = await api.bootstrap(),
        table = await api.ensureTable({ number: 122 });
      const waiters = b.users
        .filter((u: any) => u.active && u.roleCode === "WAITER")
        .slice(0, 2);
      if (waiters.length !== 2)
        throw new Error("Se requieren dos mozos para la carrera");
      const requests = await Promise.allSettled([
        api.createOrder({
          type: "DINE_IN",
          tableId: table.id,
          waiterUserId: waiters[0].id,
        }),
        api.createOrder({
          type: "DINE_IN",
          tableId: table.id,
          waiterUserId: waiters[1].id,
        }),
      ]);
      const persisted = (await api.bootstrap()).orders.filter(
        (o) => o.tableId === table.id,
      );
      const winner = requests.findIndex((r) => r.status === "fulfilled");
      return {
        requests: requests.map((r: any) => r.status),
        errors: requests.flatMap((r) =>
          r.status === "rejected" ? [String(r.reason)] : [],
        ),
        winner: waiters[winner]?.id,
        owners: persisted.map((o) => o.waiterUserId),
      };
    });
    expect(race.owners).toEqual([race.winner]);
    expect(race.errors).toHaveLength(1);
    expect(race.errors[0]).toMatch(/mesa ya tiene un pedido abierto/i);
    expect(race.requests.filter((s) => s === "fulfilled")).toHaveLength(1);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});
