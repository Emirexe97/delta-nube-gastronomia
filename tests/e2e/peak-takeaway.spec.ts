import { test, expect, _electron } from "@playwright/test";
import type { ConfirmOrderInput, PayOrderInput } from "@gastronomy/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { formatMoney } from "../../packages/domain/src/money";

test("mostrador en hora pico: prepago, stock, cobro mixto con vuelto y retiro", async () => {
  test.setTimeout(240_000);
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-peak-takeaway-"));
  const electron = createRequire(
    join(process.cwd(), "apps/desktop-shell/package.json"),
  )("electron") as string;
  const app = await (async () => {
    try {
      execFileSync(
        electron,
        [resolve("tests/fixtures/seed-peak-takeaway.cjs"), profile],
        {
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      return await _electron.launch({
        executablePath: electron,
        args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
        env: {
          ...process.env,
          GASTRONOMY_WEB_PROVISION_URL: "http://127.0.0.1:1",
          GASTRONOMY_WAITER_PROVISION_URL: "http://127.0.0.1:1",
        },
      });
    } catch (e) {
      await rm(profile, { recursive: true, force: true });
      throw e;
    }
  })();
  try {
    expect(
      resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    ).toBe(resolve(profile));
    const page = await app.firstWindow();
    await page.getByRole("link", { name: "Pedidos", exact: true }).click();
    const editor = page.getByRole("dialog", { name: /Pedido #/ });
    const lookup = page.getByPlaceholder(
      "Pedido, cliente, teléfono o dirección",
    );
    const open = async (name: string) => {
      await lookup.fill(name);
      await page.getByRole("row").filter({ hasText: name }).click();
      await expect(editor).toBeVisible();
    };
    // Real repository reads, independent of the renderer cache. Drain the IPC
    // counter immediately before each UI gesture so controls aren't counted.
    const snapshot = (name: string) =>
      page.evaluate(async (name) => {
        const b = await window.gastronomy.bootstrap();
        return {
          counts: [
            b.orders.length,
            b.products.length,
            b.orders.reduce((n, o) => n + o.items.length, 0),
          ],
          enabled: b.settings.stockEnabled,
          stock: b.products.find((p) => p.id === "starter-gaseosa")!
            .stockMinor!,
          order: b.orders.find((o) => o.customerNameSnapshot === name)!,
          cash: b.cashSession!,
          dashboard: b.dashboard,
          ledger: b.deliveryLedger,
          jobs: b.printJobs,
        };
      }, name);
    const initial = await snapshot("Retiro QA 000");
    expect(initial.counts).toEqual([400, 3000, 1200]);
    expect(initial.enabled).toBe(true);
    expect(initial.stock).toBeGreaterThan(1000);
    expect(initial.order.paymentStatus).toBe("PAID");
    await app.evaluate(({ app, ipcMain }) => {
      const tracker = ((app as any).takeawayQA = {
        calls: [] as string[],
        commands: {} as Record<string, unknown>,
        failRead: "",
      });
      const handlers = (ipcMain as any)._invokeHandlers as Map<
        string,
        (...args: any[]) => unknown
      >;
      for (const [channel, handler] of handlers) {
        if (!channel.startsWith("gastronomy:")) continue;
        const name = channel.split(":")[1]!;
        handlers.set(channel, (...args: any[]) => {
          tracker.calls.push(name);
          if (["confirmOrder", "completeOrder", "payOrder"].includes(name))
            tracker.commands[name] = structuredClone(args[1]);
          if (tracker.failRead === name) {
            tracker.failRead = "";
            throw new Error("Simulación: no se pudo consultar el resultado");
          }
          return handler(...args);
        });
      }
    });
    const drain = () =>
      app.evaluate(
        ({ app }) => (app as any).takeawayQA.calls.splice(0) as string[],
      );
    const assertNarrow = async (command: string) => {
      const calls = await drain();
      expect(calls).not.toContain("bootstrap");
      expect(calls.filter((m) => m === command)).toHaveLength(1);
      return calls;
    };
    await open("Retiro QA 000");
    await drain();
    await editor.getByRole("button", { name: "Entregar", exact: true }).click();
    await expect(editor).toBeHidden();
    const prepCalls = await assertNarrow("updateOrderStatus");
    expect(prepCalls).not.toContain("payOrder");
    const picked = await snapshot("Retiro QA 000");
    expect(picked.order.operationalStatus).toBe("DELIVERED");
    expect(picked.order.payments).toEqual(initial.order.payments);
    expect(picked.cash).toEqual(initial.cash);
    expect(picked.dashboard.salesTotalMinor).toBe(
      initial.dashboard.salesTotalMinor,
    );
    expect(picked.stock).toBe(initial.stock);

    // High-volume new order: draft does not affect stock; confirm once
    // without a printer, then deliberately replay the acknowledged command.
    await page
      .getByRole("button", { name: "F3 Para retirar", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "Nuevo Para retirar",
      exact: true,
    });
    const customer = "Retiro nuevo pico";
    await create
      .getByLabel("Nombre del cliente *", { exact: true })
      .fill(customer);
    await create.getByLabel("Teléfono *", { exact: true }).fill("1155550011");
    await drain();
    await create
      .getByRole("button", { name: "Crear pedido", exact: true })
      .click();
    const search = editor.getByPlaceholder(/Código, nombre, categoría/);
    await expect(search).toBeFocused();
    expect(await assertNarrow("createOrder")).not.toContain("getOrder");
    await search.fill("GAS15");
    await editor
      .locator('[id^="order-editor-product-"]')
      .filter({ hasText: "Gaseosa 1,5 L" })
      .click();
    await expect(editor.getByLabel("Cantidad de Gaseosa 1,5 L")).toHaveValue(
      "1",
    );
    const draft = await snapshot(customer);
    expect(draft.counts[0]).toBe(401);
    expect(draft.stock).toBe(initial.stock);
    await drain();
    await editor
      .getByRole("button", { name: "Confirmar pedido", exact: true })
      .click();
    await expect(
      editor.getByRole("button", { name: "Cobrar F8", exact: true }),
    ).toBeEnabled();
    const confirmCalls = await assertNarrow("confirmOrder");
    expect(confirmCalls).toContain("getOrderPrintState");
    const confirmInput = await app.evaluate(
      ({ app }) =>
        (app as any).takeawayQA.commands.confirmOrder as ConfirmOrderInput,
    );
    expect(confirmInput.idempotencyKey).toBeTruthy();
    const confirmed = await snapshot(customer);
    expect(confirmed.stock).toBe(initial.stock - 1000);
    expect(confirmed.jobs).toEqual(initial.jobs);
    await page.evaluate(
      (input) => window.gastronomy.confirmOrder(input),
      confirmInput,
    );
    expect(await snapshot(customer)).toEqual(confirmed);

    await editor
      .getByRole("button", { name: "Cobrar F8", exact: true })
      .click();
    const pay = page.getByRole("dialog", {
      name: "Cobrar pedido",
      exact: true,
    });
    await pay.getByRole("button", { name: "Pago mixto", exact: true }).click();
    const total = draft.order.totalMinor,
      cash = Math.floor(total / 200) * 100,
      transfer = total - cash,
      change = 500;
    await pay
      .getByLabel("Efectivo", { exact: true })
      .fill(String((cash + change) / 100));
    await pay
      .getByLabel("Transferencia", { exact: true })
      .fill(String(transfer / 100));
    await expect(
      pay.getByText("Vuelto a entregar", { exact: true }),
    ).toBeVisible();
    await drain();
    await pay
      .getByRole("button", { name: "Confirmar cobro", exact: true })
      .dblclick();
    await expect(pay).toBeHidden();
    const paymentCalls = await assertNarrow("payOrder");
    const paid = await snapshot(customer);
    expect(paid.order).toMatchObject({
      paymentStatus: "PAID",
      paidMinor: total,
      changeAmountMinor: change,
      changeMethodCode: "CASH",
    });
    expect(
      paid.order.payments.map((p) => [p.methodCode, p.amountMinor]).sort(),
    ).toEqual([
      ["CASH", cash + change],
      ["TRANSFER", transfer],
    ]);
    expect(paid.cash.expectedAmountMinor).toBe(
      initial.cash.expectedAmountMinor + cash,
    );
    expect(paid.cash.salesTotalMinor).toBe(
      initial.cash.salesTotalMinor! + total,
    );
    expect(paid.dashboard.salesTotalMinor).toBe(
      initial.dashboard.salesTotalMinor + total,
    );
    expect(paid.stock).toBe(confirmed.stock);
    await drain();
    await editor.getByRole("button", { name: "Entregar", exact: true }).click();
    await expect(editor).toBeHidden();
    await assertNarrow("updateOrderStatus");
    const handoff = await snapshot(customer);
    expect(handoff.order.payments).toEqual(paid.order.payments);
    expect(handoff.cash).toEqual(paid.cash);
    expect(handoff.stock).toBe(confirmed.stock);
    expect(handoff.order.changeAmountMinor).toBe(change);

    await open("Retiro QA 001");
    await editor.getByRole("button", { name: "Entregar", exact: true }).click();
    const complete = page.getByRole("dialog", {
      name: "Cobrar y entregar",
      exact: true,
    });
    await drain();
    await complete
      .getByRole("button", { name: "Cobrar y entregar", exact: true })
      .click();
    await expect(editor).toBeHidden();
    const completeCalls = await assertNarrow("completeOrder");
    const completed = await snapshot("Retiro QA 001");
    expect(completed.order.operationalStatus).toBe("DELIVERED");
    expect(completed.order.payments).toHaveLength(1);
    expect(completed.cash.expectedAmountMinor).toBe(
      handoff.cash.expectedAmountMinor + completed.order.totalMinor,
    );
    expect(completed.stock).toBe(handoff.stock);
    const request = await app.evaluate(
      ({ app }) =>
        (app as any).takeawayQA.commands.completeOrder as PayOrderInput & {
          finalStatus: "DELIVERED";
        },
    );
    expect(request.idempotencyKey).toBeTruthy();
    await page.evaluate(
      (input) => window.gastronomy.completeOrder(input),
      request,
    );
    expect(await snapshot("Retiro QA 001")).toEqual(completed);
    await drain();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await expect(
      page
        .getByText("Efectivo esperado en caja", { exact: true })
        .locator("xpath=following-sibling::p[1]"),
    ).toHaveText(formatMoney(completed.cash.expectedAmountMinor));
    expect(await drain()).not.toContain("bootstrap");
    await page.getByRole("link", { name: "Pedidos", exact: true }).click();

    // Only fail the narrow *read*, after the real write has committed.
    const read = completeCalls.find(
      (m) =>
        m.startsWith("get") &&
        paymentCalls.includes(m) &&
        prepCalls.includes(m),
    );
    expect(read).toBeTruthy();
    await open("Retiro QA 003");
    await editor.getByRole("button", { name: "Entregar", exact: true }).click();
    await app.evaluate(({ app }, r) => {
      (app as any).takeawayQA.failRead = r;
    }, read!);
    await drain();
    await complete
      .getByRole("button", { name: "Cobrar y entregar", exact: true })
      .click();
    await expect(editor).toBeHidden();
    const recovery = await drain();
    expect(recovery.filter((m) => m === "completeOrder")).toHaveLength(1);
    expect(recovery).toContain("bootstrap");
    const final = await snapshot("Retiro QA 003");
    expect(final.order.payments).toHaveLength(1);
    expect(final.cash.expectedAmountMinor).toBe(
      completed.cash.expectedAmountMinor + final.order.totalMinor,
    );
    expect(final.dashboard.salesTotalMinor).toBe(
      completed.dashboard.salesTotalMinor + final.order.totalMinor,
    );
    expect(final.stock).toBe(confirmed.stock);
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await expect(
      page
        .getByText("Efectivo esperado en caja", { exact: true })
        .locator("xpath=following-sibling::p[1]"),
    ).toHaveText(formatMoney(final.cash.expectedAmountMinor));
  } finally {
    await app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
      )
      .catch(() => {});
    await app.close().catch(() => {});
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});
