import { test, expect } from "@playwright/test";
import { launchConfiguredPos } from "./pos-fixture";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("400 pedidos: el foco sigue al pedido y la comanda fallida se reintenta sin volver a confirmar", async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-peak-orders-"));
  const app = await launchConfiguredPos({
    args: ["apps/desktop-shell", "--user-data-dir=" + profile],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    const fixture = await page.evaluate(async () => {
      const a = window.gastronomy,
        b = await a.bootstrap(),
        products = b.products
          .filter((p) => p.active && !p.comboDefinition)
          .slice(0, 3);
      await a.openCashSession({ openingAmountMinor: 10000 });
      const settings = b.settings,
        stamp = Date.now();
      // Set up the earlier sales without consuming the final draft's controlled stock.
      await a.saveSettings({ ...settings, stockEnabled: false });
      let last = "";
      for (let i = 0; i < 400; i++) {
        const order = await a.createOrder({
          type: i % 2 ? "TAKEAWAY" : "DELIVERY",
          customerName: "Pico " + i,
          customerPhone: "1100000000",
          deliveryAddress: "Calle 123",
          promisedAt: new Date(stamp + (i + 1) * 60000).toISOString(),
        });
        for (const product of products)
          await a.addOrderItem({
            orderId: order.id,
            productId: product.id,
            quantity: 1,
          });
        if (i < 399) await a.confirmOrder({ orderId: order.id });
        last = order.id;
      }
      await a.saveSettings({
        ...settings,
        stockEnabled: true,
        printing: {
          ...settings.printing,
          kitchen: {
            ...settings.printing.kitchen,
            mode: "SYSTEM_DIRECT",
            deviceName: "QA mock",
            copies: 1,
          },
        },
      });
      await a.adjustStock({
        productId: products[0]!.id,
        newStockMinor: 3000,
        reason: "QA",
        authorizerPin: "748259",
      });
      return { last, product: products[0]!.id };
    });
    await page.reload();
    await page.getByRole("link", { name: "Pedidos", exact: true }).click();
    const region = page.getByRole("region", { name: "Lista de pedidos" }),
      table = region.getByRole("table");
    const rows = table.locator("tr[data-order-id]");
    await expect(table).toHaveAttribute("aria-rowcount", "401"); // includes the column headers
    expect(await rows.count()).toBeLessThan(60);
    await rows.first().focus();
    await page.keyboard.press("End");
    await expect(table.locator("tr[aria-rowindex='401']")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(table.locator("tr[aria-rowindex='2']")).toBeFocused();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowDown");
    const active = table.locator("tr:focus");
    await expect(active).toHaveAttribute("aria-rowindex", "32");
    const id = await active.getAttribute("data-order-id");
    const number = (
      await active.locator("td").first().locator("span").innerText()
    ).trim();
    // Promote a different order, exactly as a concurrent terminal refresh would.
    const promoted = await page.evaluate(async () => {
      const a = window.gastronomy,
        b = await a.bootstrap(),
        o = b.orders.find((o) => o.customerNameSnapshot === "Pico 200")!;
      await a.updateOrderStatus({ orderId: o.id, status: "READY" });
      return o.id;
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send(
        "gastronomy:waiterOrderChanged",
      ),
    );
    await expect(active).toHaveAttribute("aria-rowindex", "33"); // reordering actually reached the UI
    await expect(active).toHaveAttribute("data-order-id", id!);
    // This time move the focused order past the viewport and its overscan.
    await page.evaluate(
      (orderId) =>
        window.gastronomy.updateOrderStatus({ orderId, status: "READY" }),
      id!,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send(
        "gastronomy:waiterOrderChanged",
      ),
    );
    await expect(active).toHaveAttribute("aria-rowindex", "2");
    await expect(active).toHaveAttribute("data-order-id", id!);
    await expect
      .poll(() =>
        region.evaluate((node) => {
          const row = node.querySelector("tr:focus")?.getBoundingClientRect();
          const header = node.querySelector("th")!.getBoundingClientRect();
          return (
            !!row &&
            row.top >= header.bottom - 1 &&
            row.bottom <= node.getBoundingClientRect().bottom + 1
          );
        }),
      )
      .toBe(true);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Pedido " + number,
      exact: false,
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(table.locator("tr:focus")).toHaveAttribute(
      "data-order-id",
      id!,
    );
    await page.keyboard.press("Tab");
    await expect(active).toHaveAttribute("data-order-id", promoted);
    const search = page.getByPlaceholder(
      "Pedido, cliente, teléfono o dirección",
    );
    await search.fill("Pico 399");
    await expect(rows).toHaveCount(1);
    await expect(search).toBeFocused();
    await search.fill("");
    await expect(table).toHaveAttribute("aria-rowcount", "401");
    expect(await rows.count()).toBeLessThan(60);
    await search.fill("Pico 399");
    await rows.first().click();
    const editor = page.getByRole("dialog", { name: /Pedido #/ });
    const print = editor.getByRole("button", { name: /Confirmar e imprimir/ });
    await expect(print).toBeVisible();
    // Only the final native driver call is mocked. Confirm, queue, snapshot, retry and database are real.
    await app.evaluate(({ app, BrowserWindow, ipcMain }) => {
      const s = ((app as any).__peak = {
        attempts: 0,
        success: 0,
        confirmOrder: 0,
        printOrder: 0,
        retryPrint: 0,
        bootstrap: 0,
      });
      const install = (w: any) => {
        w.webContents.getPrintersAsync = async () => [
          { name: "QA mock", isDefault: true },
        ];
        w.webContents.print = (
          _: unknown,
          cb: (ok: boolean, reason?: string) => void,
        ) => {
          s.attempts++;
          if (s.attempts === 1) cb(false, "QA driver failure");
          else {
            s.success++;
            cb(true);
          }
        };
      };
      app.on("browser-window-created", (_, w) => install(w));
      BrowserWindow.getAllWindows().forEach(install);
      const handlers = (ipcMain as any)._invokeHandlers as Map<
        string,
        (...args: unknown[]) => unknown
      >;
      for (const k of [
        "confirmOrder",
        "printOrder",
        "retryPrint",
        "bootstrap",
      ] as const) {
        const key = "gastronomy:" + k,
          fn = handlers.get(key)!;
        handlers.set(key, (...args) => {
          s[k]++;
          return fn(...args);
        });
      }
    });
    await print.click();
    const retry = editor.getByRole("button", {
      name: "Reintentar",
      exact: true,
    });
    await expect(retry).toBeVisible();
    const read = () =>
      page.evaluate(
        ({ last }) =>
          window.gastronomy.getOrderPrintState({
            orderId: last,
            includeConfirmation: true,
          }),
        fixture,
      );
    const failed = await read();
    expect(failed.printJobs).toHaveLength(1);
    expect(failed.printJobs[0]).toMatchObject({
      status: "FAILED",
      attempts: 1,
    });
    expect(failed.order.lifecycleStatus).toBe("CONFIRMED");
    expect(
      failed.confirmation!.stocks.find((p) => p.productId === fixture.product)
        ?.stockMinor,
    ).toBe(2000);
    // The operator can leave and reopen the order without losing the failed job.
    await page.keyboard.press("Escape");
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(
      editor.getByRole("button", { name: /Reimprimir comanda/ }),
    ).toBeVisible();
    const done = await read();
    expect(done.printJobs).toHaveLength(1);
    expect(done.printJobs[0]).toMatchObject({
      id: failed.printJobs[0]!.id,
      status: "PRINTED",
      attempts: 2,
    });
    expect(done.order.items).toEqual(failed.order.items);
    expect(done.order.printCount).toBe(1);
    expect(done.order.kitchenPrintedQuantities).toEqual(
      Object.fromEntries(done.order.items.map((i) => [i.id, i.quantity])),
    );
    expect(done.confirmation!.stocks).toEqual(failed.confirmation!.stocks);
    expect(await app.evaluate(({ app }) => (app as any).__peak)).toEqual({
      attempts: 2,
      success: 1,
      confirmOrder: 1,
      printOrder: 1,
      retryPrint: 1,
      bootstrap: 0,
    });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});
