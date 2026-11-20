import { test, expect, _electron } from "@playwright/test";
import type { DesktopApi } from "@gastronomy/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { formatMoney } from "../../packages/domain/src/money";

test("400 envíos: reasignar la rendición, entregar y reintentar un cobro sin duplicarlo", async () => {
  test.setTimeout(240_000);
  const profile = await mkdtemp(join(tmpdir(), "gastronomy-peak-delivery-"));
  const electron = createRequire(
    join(process.cwd(), "apps/desktop-shell/package.json"),
  )("electron") as string;
  const app = await (async () => {
    try {
      execFileSync(
        electron,
        [resolve("tests/fixtures/seed-peak-delivery.cjs"), profile],
        {
          cwd: process.cwd(),
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        },
      );
      return await _electron.launch({
        executablePath: electron,
        args: ["apps/desktop-shell", `--user-data-dir=${profile}`],
        cwd: process.cwd(),
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
    // Independent read through the full SQLite bootstrap, never the renderer cache.
    const snapshot = () =>
      page.evaluate(async () => {
        const b = await window.gastronomy.bootstrap();
        const orders = b.orders.filter((o) => o.type === "DELIVERY");
        const find = (n: number) =>
          orders.find(
            (o) =>
              o.customerNameSnapshot ===
              "Peak delivery QA " + String(n).padStart(3, "0"),
          )!;
        return {
          counts: [
            orders.length,
            orders.reduce((n, o) => n + o.items.length, 0),
            b.products.length,
          ],
          drivers: b.users
            .filter((u) => u.roleCode === "DELIVERY_DRIVER" && u.active)
            .sort((a, b) => a.fullName.localeCompare(b.fullName)),
          target: find(15),
          prepaid: find(0),
          cod: find(1),
          business: find(2),
          cash: b.cashSession!,
          dashboard: b.dashboard,
          ledger: b.deliveryLedger,
          activity: b.driverDeliveryActivity,
        };
      });
    const start = await snapshot();
    expect(start.counts).toEqual([400, 1200, 3000]);
    expect(start.drivers).toHaveLength(8);
    expect(start.prepaid).toMatchObject({
      paymentStatus: "PAID",
      operationalStatus: "OUT_FOR_DELIVERY",
    });
    await app.evaluate(({ app, ipcMain }) => {
      const trace = ((app as any).peakTrace = [] as string[]);
      const watched = new Set([
        "bootstrap",
        "assignDeliveryDriver",
        "updateOrderStatus",
        "completeOrder",
        "getDeliveryProjection",
        "getDeliveryHistory",
      ]);
      for (const [key, fn] of (ipcMain as any)._invokeHandlers) {
        const method = key.split(":")[1];
        if (!key.startsWith("gastronomy:") || !watched.has(method)) continue;
        (ipcMain as any)._invokeHandlers.set(key, (...args: any[]) => {
          trace.push(method);
          if (method === "completeOrder")
            (app as any).peakLastCompletion = structuredClone(args[1]);
          return fn(...args);
        });
      }
    });
    const trace = () =>
      app.evaluate(({ app }) => (app as any).peakTrace.splice(0) as string[]);
    const editor = page.getByRole("dialog", { name: /Pedido #/ });
    const open = async (n: number) => {
      const label = "Peak delivery QA " + String(n).padStart(3, "0");
      await page
        .getByPlaceholder("Pedido, cliente, teléfono o dirección")
        .fill(label);
      await page.getByRole("row").filter({ hasText: label }).click();
      await expect(editor).toBeVisible();
      await trace();
    };
    const old = start.ledger.find((r) => r.orderId === start.target.id)!;
    expect(old).toMatchObject({
      status: "PENDING",
      driverUserId: start.target.driverUserId,
    });
    const newDriver = start.drivers.find((d) => d.id !== old.driverUserId)!;
    await open(15);
    await editor
      .getByRole("button", { name: old.driverName, exact: true })
      .click();
    const assign = page.getByRole("dialog", {
      name: "Asignar repartidor",
      exact: true,
    });
    await assign.getByRole("combobox").selectOption(newDriver.id);
    await assign.getByRole("button", { name: "Guardar repartidor" }).click();
    await expect(assign).toBeHidden();
    await expect(
      editor.getByRole("button", { name: newDriver.fullName, exact: true }),
    ).toBeVisible();
    expect(await trace()).toEqual([
      "assignDeliveryDriver",
      "getDeliveryProjection",
    ]);
    const assigned = await snapshot();
    expect(assigned.ledger.filter((r) => r.orderId === old.orderId)).toEqual([
      { ...old, driverUserId: newDriver.id, driverName: newDriver.fullName },
    ]);
    expect(assigned.dashboard).toEqual(start.dashboard);
    expect(assigned.cash).toEqual(start.cash);
    await page.keyboard.press("Escape");

    await open(0);
    await editor.getByRole("button", { name: "Entregar", exact: true }).click();
    await expect(editor).toBeHidden();
    expect(await trace()).toEqual([
      "updateOrderStatus",
      "getDeliveryProjection",
    ]);
    const prepaid = await snapshot();
    expect(prepaid.prepaid.operationalStatus).toBe("DELIVERED");
    expect(prepaid.prepaid.payments).toEqual(start.prepaid.payments);
    expect(prepaid.cash.expectedAmountMinor).toBe(
      start.cash.expectedAmountMinor,
    );
    expect(prepaid.dashboard.salesTotalMinor).toBe(
      start.dashboard.salesTotalMinor,
    );

    for (const [n, driverCollects] of [
      [1, true],
      [2, false],
    ] as const) {
      await open(n);
      await editor
        .getByRole("button", { name: "Entregar", exact: true })
        .click();
      const pay = page.getByRole("dialog", {
        name: "Cobrar y entregar",
        exact: true,
      });
      await pay
        .getByRole("combobox", { name: /^Repartidor/ })
        .selectOption(newDriver.id);
      await pay
        .getByRole("checkbox", { name: "Cobró el repartidor", exact: true })
        .setChecked(driverCollects);
      await pay
        .getByRole("button", { name: "Cobrar y entregar", exact: true })
        .click();
      await expect(editor).toBeHidden();
      expect(await trace()).toEqual(["completeOrder", "getDeliveryProjection"]);
      const after = await snapshot();
      const order = driverCollects ? after.cod : after.business;
      expect(order).toMatchObject({
        operationalStatus: "DELIVERED",
        paymentStatus: "PAID",
        collectedByDriver: driverCollects,
      });
      expect(order.payments).toHaveLength(1);
      expect(
        after.ledger.filter((row) => row.orderId === order.id),
      ).toHaveLength(1);
      expect(
        after.ledger.find((row) => row.orderId === order.id)?.direction,
      ).toBe(driverCollects ? "DRIVER_OWES_BUSINESS" : "BUSINESS_OWES_DRIVER");
      expect(after.cash.expectedAmountMinor).toBe(
        start.cash.expectedAmountMinor +
          (driverCollects ? 0 : order.totalMinor),
      );
      expect(after.dashboard.salesTotalMinor).toBe(
        start.dashboard.salesTotalMinor +
          after.cod.totalMinor +
          (driverCollects ? 0 : order.totalMinor),
      );
      // Simulate losing the acknowledgement: replay the exact UI command, including its durable key.
      const payload = await app.evaluate(
        ({ app }) =>
          (app as any).peakLastCompletion as Parameters<
            DesktopApi["completeOrder"]
          >[0],
      );
      expect(payload.idempotencyKey).toBeTruthy();
      await page.evaluate((p) => window.gastronomy.completeOrder(p), payload);
      expect(await snapshot()).toEqual(after);
    }
    const final = await snapshot();
    const expectedPending = final.ledger.filter(
      (r) => r.status === "PENDING",
    ).length;
    await page.getByRole("link", { name: "Repartidores", exact: true }).click();
    const table = page
      .getByRole("table")
      .filter({ hasText: "Movimiento de caja" });
    const checkPanel = async (driverId?: string) => {
      const activity = final.activity.filter(
        (row) => !driverId || row.driverUserId === driverId,
      );
      const pending = final.ledger.filter(
        (row) =>
          row.status === "PENDING" &&
          (!driverId || row.driverUserId === driverId),
      );
      const metric = (label: string) =>
        page
          .getByText(label, { exact: true })
          .locator("xpath=following-sibling::p[1]");
      await expect(metric("Envíos registrados")).toHaveText(
        String(activity.reduce((sum, row) => sum + row.deliveryCount, 0)),
      );
      await expect(metric("Ganancia de repartidores")).toHaveText(
        formatMoney(activity.reduce((sum, row) => sum + row.earningsMinor, 0)),
      );
      for (const [direction, label] of [
        ["DRIVER_OWES_BUSINESS", "Pendiente: repartidor rinde al negocio"],
        ["BUSINESS_OWES_DRIVER", "Pendiente: negocio paga al repartidor"],
      ] as const)
        await expect(metric(label)).toHaveText(
          formatMoney(
            pending
              .filter((row) => row.direction === direction)
              .reduce((sum, row) => sum + row.amountDueMinor, 0),
          ),
        );
    };
    await checkPanel();
    await expect(table).toHaveAttribute(
      "aria-rowcount",
      String(final.ledger.length + 1),
    );
    expect(await table.locator("[data-ledger-id]").count()).toBeLessThanOrEqual(
      20,
    );
    await page
      .getByRole("button", {
        name: `Seleccionar ${expectedPending} pendiente(s)`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: `Liquidar movimientos seleccionados (${expectedPending})`,
        exact: true,
      }),
    ).toBeEnabled();
    const filter = page.getByRole("combobox", { name: /^Repartidor/ });
    for (const id of [old.driverUserId, newDriver.id]) {
      await filter.selectOption(id);
      await checkPanel(id);
      const rows = final.ledger.filter((r) => r.driverUserId === id);
      if (!rows.length) {
        await expect(
          page.getByText("No hay envíos para esta selección"),
        ).toBeVisible();
        continue;
      }
      await expect(table).toHaveAttribute(
        "aria-rowcount",
        String(rows.length + 1),
      );
      if (id === newDriver.id) {
        const index = rows.findIndex((row) => row.id === old.id);
        expect(index).toBeGreaterThanOrEqual(0);
        await table.evaluate((el, i) => {
          el.parentElement!.scrollTop = i * 56;
        }, index);
      }
      await expect(table.locator(`[data-ledger-id="${old.id}"]`)).toHaveCount(
        id === newDriver.id ? 1 : 0,
      );
    }
    await trace();
    await page.getByRole("combobox", { name: /Período/ }).selectOption("ALL");
    await expect.poll(trace).toContain("getDeliveryHistory");
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
