import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { launchConfiguredPos } from "./pos-fixture";

test("proveedores, acreditación y comisión concilian desde Finanzas", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gastronomy-finance-books-"));
  const app = await launchConfiguredPos({
    args: ["apps/desktop-shell", "--user-data-dir=" + dir],
    cwd: process.cwd(),
  });
  try {
    const page = await app.firstWindow();
    const source = await page.evaluate(async () => {
      const api = window.gastronomy;
      const shift = await api.openCashSession({ openingAmountMinor: 0 });
      const product = (await api.bootstrap()).products.find(
        (p) => p.code === "MUZG",
      )!;
      await api.createPurchase({
        supplierName: "Molino del Sur",
        invoiceNumber: "A-001",
        items: [
          {
            productId: product.id,
            quantityMinor: 1000,
            unitCostMinor: 10000000,
          },
        ],
        authorizerPin: "748259",
      });
      const o = await api.createOrder({
        type: "TAKEAWAY",
        customerName: "Cliente de prueba",
        customerPhone: "1155550101",
      });
      await api.addOrderItem({ orderId: o.id, productId: product.id });
      const confirmed = await api.confirmOrder({ orderId: o.id });
      await api.payOrder({
        orderId: o.id,
        payments: [
          { methodCode: "TRANSFER", amountMinor: confirmed.totalMinor },
        ],
      });
      return {
        date: shift.businessDate,
        total: confirmed.totalMinor,
        stock: (await api.bootstrap()).products.find(
          (p) => p.id === product.id,
        )!.stockMinor,
        productId: product.id,
        result: (
          await api.getFinanceReport({
            from: shift.businessDate,
            to: shift.businessDate,
          })
        ).estimatedOperatingProfitMinor,
      };
    });
    await page.reload();
    await page.getByRole("link", { name: "Finanzas", exact: true }).click();
    const tab = (name: string) =>
      page.getByRole("button", { name, exact: true }).click();
    const dialog = page.getByRole("dialog");
    async function confirm(reason: string) {
      await dialog.getByLabel("Concepto o motivo").fill(reason);
      await dialog.getByLabel("PIN de autorización financiera").fill("748259");
      await dialog.getByRole("button", { name: "Confirmar registro" }).click();
      await expect(dialog).toHaveCount(0);
    }
    await tab("Tesorería y cobros");
    await tab("Crear cuenta de fondos");
    await dialog.getByLabel("Nombre de la cuenta").fill("Banco del local");
    await dialog.getByLabel("Saldo inicial").fill("100000");
    await confirm("Saldo inicial según extracto");
    await tab("Gastos y vencimientos");
    await tab("Vincular compra a proveedor");
    await dialog.getByLabel("Compra recibida").selectOption({ index: 1 });
    await confirm("Factura A-001 a treinta días");
    for (const amount of ["40000", "60000"]) {
      await tab("Pagar");
      await dialog.getByLabel("Cuenta de origen").selectOption({ index: 1 });
      await dialog.getByLabel("Importe a pagar").fill(amount);
      await confirm("Pago parcial al molino");
    }
    await tab("Tesorería y cobros");
    await tab("Crear lote de acreditación");
    await dialog
      .getByLabel("Cuenta de acreditación")
      .selectOption({ index: 1 });
    await dialog.getByRole("checkbox").first().check();
    await dialog.getByLabel("Comisiones del lote").fill("300");
    await confirm("Lote del turno");
    await tab("Acreditar");
    await confirm("Depósito en extracto");
    await tab("Conciliar");
    await confirm("Verificado contra el banco");
    const actual = await page.evaluate(async (s) => {
      const api = window.gastronomy;
      const b = await api.getFinanceBooks({ from: s.date, to: s.date });
      const r = await api.getFinanceReport({ from: s.date, to: s.date });
      return {
        balance: b.accounts[0]?.balanceMinor,
        debt: b.obligations[0]?.outstandingMinor,
        paid: b.obligations[0]?.payments.length,
        status: b.settlements[0]?.status,
        commission: r.commissionCostsMinor,
        gain: r.estimatedOperatingProfitMinor,
        stock: (await api.bootstrap()).products.find(
          (p) => p.id === s.productId,
        )?.stockMinor,
      };
    }, source);
    expect(actual).toEqual({
      balance: source.total - 30000,
      debt: 0,
      paid: 2,
      status: "reconciled",
      commission: 30000,
      gain: source.result - 30000,
      stock: source.stock,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Tesorería y cobros", exact: true })
      .click();
    await expect(
      page.getByRole("cell", { name: /^Conciliado/ }),
    ).toBeVisible();
  } finally {
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
    );
    await app.close();
    if (
      dirname(resolve(dir)) === resolve(tmpdir()) &&
      basename(dir).startsWith("gastronomy-finance-books-")
    )
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
