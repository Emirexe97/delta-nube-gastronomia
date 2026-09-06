import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { SqliteGastronomyRepository } from "./sqlite-repository";

const orderCount = Math.max(100, Number(process.env.BENCHMARK_ORDERS ?? 2_500));
const path = join(tmpdir(), `gastronomy-benchmark-${randomUUID()}.sqlite`);
const repository = new SqliteGastronomyRepository(path, {
  adminPin: "2468",
  seedStarterCatalog: true,
});

try {
  const cash = repository.openCashSession({ openingAmountMinor: 10_000_000 });
  const seedStarted = performance.now();
  for (let index = 0; index < orderCount; index += 1) {
    const type =
      index % 5 === 0 ? "DELIVERY" : index % 2 === 0 ? "TAKEAWAY" : "DINE_IN";
    const offPremise = type !== "DINE_IN";
    const order = repository.createOrder({
      type,
      tableId: type === "DINE_IN" ? `table-${(index % 10) + 1}` : null,
      customerName: offPremise ? `Cliente ${index}` : null,
      customerPhone: offPremise ? `11 5555 ${String(index).padStart(4, "0")}` : null,
      deliveryAddress: offPremise ? `Calle ${index}` : null,
      deliveryFeeMinor: type === "DELIVERY" ? 250_000 : 0,
      promisedAt: new Date(
        Date.now() + (20 + (index % 80)) * 60_000,
      ).toISOString(),
      scheduled: index % 10 === 0,
    });
    const populated = repository.addOrderItem({
      orderId: order.id,
      productId:
        index % 3 === 0 ? "starter-napo-grande" : "starter-muzza-grande",
    });
    repository.confirmOrder({ orderId: populated.id });
    if (index % 4 !== 0) {
      repository.payOrder({
        orderId: order.id,
        payments: [
          {
            methodCode: "TRANSFER",
            amountMinor: populated.totalMinor,
            reference: `BENCH-${index}`,
          },
        ],
      });
      repository.updateOrderStatus(order.id, "DELIVERED");
    }
  }
  const seedMs = performance.now() - seedStarted;

  const bootstrapStarted = performance.now();
  const bootstrap = repository.bootstrap();
  const bootstrapMs = performance.now() - bootstrapStarted;

  const reportStarted = performance.now();
  const report = repository.getDetailedReport({
    dateFrom: cash.businessDate,
    dateTo: cash.businessDate,
  });
  const reportMs = performance.now() - reportStarted;

  const persistedOrders = (
    repository.db.prepare("SELECT count(*) AS count FROM orders").get() as {
      count: number;
    }
  ).count;
  const actionableOrders = Math.ceil(orderCount / 4);
  const completedOrders = orderCount - actionableOrders;
  assert.equal(persistedOrders, orderCount);
  assert.equal(
    bootstrap.orders.length,
    actionableOrders + Math.min(200, completedOrders),
  );
  assert.equal(report.orderCount, completedOrders);
  assert.ok(
    bootstrapMs < 5_000,
    `Bootstrap excedió 5 s: ${bootstrapMs.toFixed(1)} ms`,
  );
  assert.ok(reportMs < 5_000, `Informe excedió 5 s: ${reportMs.toFixed(1)} ms`);

  console.log(
    JSON.stringify(
      {
        orders: orderCount,
        bootstrapWindow: bootstrap.orders.length,
        paidOrders: report.orderCount,
        databaseMiB: Number(
          (
            repository.db
              .prepare(
                "SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()",
              )
              .get() as { bytes: number }
          ).bytes /
            1024 /
            1024,
        ).toFixed(2),
        seedMs: Number(seedMs.toFixed(1)),
        bootstrapMs: Number(bootstrapMs.toFixed(1)),
        reportMs: Number(reportMs.toFixed(1)),
        rssMiB: Number((process.memoryUsage().rss / 1024 / 1024).toFixed(1)),
      },
      null,
      2,
    ),
  );
} finally {
  repository.close();
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(`${path}${suffix}`, { force: true });
}
