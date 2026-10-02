const test = require("node:test");
const assert = require("node:assert/strict");
const { formatPromisedAt, scheduledOrderBadge } = require("./scheduled-order-ticket.cjs");

test("scheduled promise prints exact date and time in Buenos Aires", () => {
  assert.deepEqual(formatPromisedAt("2026-10-02T15:30:00.000Z"), {
    date: "02/10/2026", time: "12:30",
  });
  const html = scheduledOrderBadge({ scheduled: true, promisedAt: "2026-10-02T15:30:00.000Z" });
  assert.match(html, /class="scheduled-badge"/);
  assert.match(html, /PEDIDO PROGRAMADO/);
  assert.match(html, /ENTREGA PROGRAMADA/);
  assert.match(html, /02\/10\/2026/);
  assert.match(html, /12:30/);
});

test("quick delay keeps the normal delivery heading", () => {
  assert.equal(
    scheduledOrderBadge({ scheduled: false, promisedAt: "2026-10-02T15:30:00.000Z" }),
    '<p class="promised">ENTREGA 12:30</p>',
  );
});

test("missing or invalid promised time does not produce a misleading badge", () => {
  assert.equal(scheduledOrderBadge({ scheduled: true, promisedAt: null }), "");
  assert.equal(scheduledOrderBadge({ scheduled: true, promisedAt: "invalid" }), "");
});
