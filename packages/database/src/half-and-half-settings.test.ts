import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SqliteGastronomyRepository } from "./sqlite-repository";

test("half-and-half setting defaults and legacy-absent true, persists toggles, and blocks only new combinations", () => {
  const path = join(tmpdir(), `half-and-half-settings-${randomUUID()}.sqlite`);
  let repo = new SqliteGastronomyRepository(path, {
    adminPin: "2468",
    seedStarterCatalog: true,
  });
  try {
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, true);
    const legacy = { ...repo.bootstrap().settings } as Record<string, unknown>;
    delete legacy.halfAndHalfEnabled;
    repo.db
      .prepare("UPDATE settings SET value_json = ? WHERE key = 'app'")
      .run(JSON.stringify(legacy));
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, true);

    repo.openCashSession({ openingAmountMinor: 0 });
    const order = repo.createOrder({
      type: "TAKEAWAY",
      customerName: "Prueba",
      customerPhone: "1112345678",
    });
    const retainedHalf = repo.addHalfAndHalfItem({
      orderId: order.id,
      firstProductId: "starter-muzza-grande",
      secondProductId: "starter-napo-grande",
    });
    const retained = retainedHalf.items[0]!;
    const settings = repo.bootstrap().settings;
    repo.saveSettings({ ...settings, halfAndHalfEnabled: false });
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, false);

    const plainOrder = repo.addOrderItem({
      orderId: order.id,
      productId: "starter-gaseosa",
    });
    assert.equal(plainOrder.items.length, 2);
    const before = repo.getOrder(order.id);
    const auditBefore = (
      repo.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
        .get(order.id) as { n: number }
    ).n;
    assert.throws(
      () =>
        repo.addHalfAndHalfItem({
          orderId: order.id,
          firstProductId: "starter-muzza-grande",
          secondProductId: "starter-napo-grande",
        }),
      /mitad y mitad.*deshabilitada/i,
    );
    assert.deepEqual(repo.getOrder(order.id), before);
    assert.equal(
      (
        repo.db
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
          .get(order.id) as { n: number }
      ).n,
      auditBefore,
    );
    assert.equal(
      repo.getOrder(order.id).items.find((item) => item.id === retained.id)
        ?.halves.length,
      2,
    );

    repo.saveSettings({
      ...repo.bootstrap().settings,
      halfAndHalfEnabled: true,
    });
    assert.equal(
      repo.addHalfAndHalfItem({
        orderId: order.id,
        firstProductId: "starter-muzza-grande",
        secondProductId: "starter-napo-grande",
      }).items.length,
      3,
    );
    repo.close();
    repo = new SqliteGastronomyRepository(path, { adminPin: "2468" });
    assert.equal(repo.bootstrap().settings.halfAndHalfEnabled, true);
  } finally {
    repo.close();
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(`${path}${suffix}`, { force: true });
  }
});
