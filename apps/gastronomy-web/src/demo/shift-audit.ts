import type {
  AuditEntryDto,
  BootstrapDto,
  CashMovementDto,
  CashSessionDto,
  OrderDto,
  ShiftAuditDto,
  ShiftAuditEvent,
  ShiftAuditInput,
  ShiftAuditOrder,
  ShiftOrderAuditDto,
  ShiftOrderAuditInput,
} from "@gastronomy/contracts";

export type DemoOrderEvent = Pick<
  AuditEntryDto,
  | "id"
  | "entityId"
  | "action"
  | "timestamp"
  | "operatorName"
  | "authorizerName"
  | "reason"
> & { cashSessionId: string | null };
type State = {
  data: BootstrapDto;
  historicalSessions: CashSessionDto[];
  audit: AuditEntryDto[];
  orderEvents?: DemoOrderEvent[];
  movements: Array<
    CashMovementDto & {
      sessionId: string;
      receivedMinor?: number | null;
      reference?: string | null;
      authorizerName?: string | null;
    }
  >;
  orderCloseSnapshots?: Record<string, Record<string, OrderDto>>;
  settlementAtClose?: Record<string, Record<string, string>>;
  accountReceipts?: Array<{
    movementId: string;
    reference: string | null;
    allocations: { orderId: string; amountMinor: number }[];
  }>;
};
const names: Record<string, string> = {
  OPENING: "Apertura",
  CLOSING: "Cierre",
  INCOME: "Ingreso",
  EXPENSE: "Egreso",
  SALE: "Cobro",
  REFUND: "Devolución",
  ADJUSTMENT: "Ajuste",
  WITHDRAWAL: "Retiro",
};
function sessions(s: State) {
  return s.data.cashSession
    ? [s.data.cashSession, ...s.historicalSessions]
    : s.historicalSessions;
}
function sessionOf(s: State, id: string) {
  const x = sessions(s).find((t) => t.id === id);
  if (!x) throw new Error("No se encontró el turno.");
  return x;
}
function linked(s: State, id: string) {
  const ids = new Set(Object.keys(s.orderCloseSnapshots?.[id] ?? {})),
    moves = new Set<string>();
  for (const o of s.data.orders)
    if (o.cashSessionCreatedId === id || o.cashSessionPaidId === id)
      ids.add(o.id);
  for (const e of s.orderEvents ?? [])
    if (e.cashSessionId === id) ids.add(e.entityId);
  for (const m of s.movements)
    if (m.sessionId === id) {
      moves.add(m.id);
      if (m.orderId) ids.add(m.orderId);
    }
  for (const r of s.accountReceipts ?? [])
    if (moves.has(r.movementId))
      for (const a of r.allocations) ids.add(a.orderId);
  return ids;
}
function moneyRows(s: State, scope: { session: string } | { order: string }) {
  const boxes = new Map(sessions(s).map((x) => [x.id, x.number])),
    orders = new Map(s.data.orders.map((o) => [o.id, o.number]));
  const receipts = new Map(
    (s.accountReceipts ?? []).map((r) => [r.movementId, r]),
  );
  const users = new Map(s.data.users.map((u) => [u.id, u.fullName])),
    methods = new Map(s.data.paymentMethods.map((m) => [m.code, m.name]));
  const rows: Array<ShiftAuditEvent & { collected: number }> = [];
  for (const m of s.movements) {
    if ("session" in scope && m.sessionId !== scope.session) continue;
    const receipt = receipts.get(m.id),
      a =
        "order" in scope
          ? receipt?.allocations.find((x) => x.orderId === scope.order)
          : undefined;
    if ("order" in scope && m.orderId !== scope.order && !a) continue;
    const id = a?.orderId ?? m.orderId;
    const val =
      (a?.amountMinor ?? m.amountMinor) *
      (["EXPENSE", "WITHDRAWAL", "REFUND"].includes(m.type) ? -1 : 1);
    const label = receipt
      ? "Cobro de cuenta corriente"
      : m.reason?.startsWith("Vuelto cobro pedido #")
        ? "Vuelto"
        : m.type === "SALE" && m.paymentMethodCode === "ACCOUNT"
          ? "Venta a cuenta corriente"
          : (names[m.type] ?? m.type);
    rows.push({
      id: m.id,
      cashSessionId: m.sessionId,
      sessionNumber: boxes.get(m.sessionId) ?? null,
      occurredAt: m.createdAt,
      orderId: id,
      orderNumber: id ? (orders.get(id) ?? null) : null,
      label,
      amountMinor: val,
      cashEffectMinor:
        m.affectsCash && !["OPENING", "CLOSING"].includes(m.type) ? val : 0,
      reason: m.reason,
      method: m.paymentMethodCode
        ? (methods.get(m.paymentMethodCode) ?? m.paymentMethodCode)
        : null,
      operator: users.get(m.userId) ?? null,
      authorizer: m.authorizerName ?? null,
      receivedMinor: m.receivedMinor,
      reference: m.reference ?? receipt?.reference,
      collected:
        m.paymentMethodCode !== "ACCOUNT" &&
        (m.type === "SALE" || m.type === "REFUND" || receipt)
          ? val
          : 0,
    });
  }
  return rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
export function snapshotOrdersAtClose(s: State, id: string) {
  const ids = linked(s, id);
  (s.orderCloseSnapshots ??= {})[id] = Object.fromEntries(
    s.data.orders
      .filter((o) => ids.has(o.id))
      .map((o) => [o.id, structuredClone(o)]),
  );
  (s.settlementAtClose ??= {})[id] = Object.fromEntries(
    s.data.deliveryLedger
      .filter((l) => ids.has(l.orderId))
      .map((l) => [l.orderId, l.status]),
  );
}
export function getShiftAudit(s: State, input: ShiftAuditInput): ShiftAuditDto {
  const session = sessionOf(s, input.cashSessionId),
    q = input.search?.trim().replace(/^#/, "").toLocaleLowerCase("es") ?? "";
  const match = (...vals: unknown[]) =>
    !q ||
    vals.some(
      (v) => v != null && String(v).toLocaleLowerCase("es").includes(q),
    );
  const money = moneyRows(s, { session: session.id }),
    events =
      input.section === "movements"
        ? money
            .filter((m) =>
              match(
                m.label,
                m.method,
                m.operator,
                m.reason,
                m.authorizer,
                m.orderNumber,
                m.reference,
                m.amountMinor,
              ),
            )
            .reverse()
        : [];
  const rows: ShiftAuditOrder[] = [];
  if (input.section !== "movements") {
    const ids = linked(s, session.id),
      totals = new Map<string, number>(),
      labels = new Map<string, Set<string>>();
    function add(id: string, val: number, name: string) {
      totals.set(id, (totals.get(id) ?? 0) + val);
      const set = labels.get(id) ?? new Set();
      set.add(name);
      labels.set(id, set);
    }
    for (const m of money) if (m.orderId) add(m.orderId, m.collected, m.label);
    const mids = new Set(money.map((m) => m.id));
    for (const r of s.accountReceipts ?? [])
      if (mids.has(r.movementId))
        for (const a of r.allocations)
          add(a.orderId, a.amountMinor, "Cobro de cuenta corriente");
    for (const e of s.orderEvents ?? [])
      if (e.cashSessionId === session.id)
        add(e.entityId, 0, e.action.replaceAll("_", " ").toLowerCase());
    const candidates = new Map(s.data.orders.map(o => [o.id,o]));
    for (const snap of Object.values(s.orderCloseSnapshots?.[session.id] ?? {})) candidates.set(snap.id,snap);
    for (const live of candidates.values()) {
      if (!ids.has(live.id)) continue;
      const snap = s.orderCloseSnapshots?.[session.id]?.[live.id],
        o = snap ?? live;
      if (input.section === "deliveries" && o.type !== "DELIVERY") continue;
      if (o.cashSessionCreatedId === session.id) add(o.id, 0, "Creado");
      if (
        !match(
          o.number,
          o.customerNameSnapshot,
          o.driverName,
          o.operationalStatus,
          ...(labels.get(o.id) ?? []),
        )
      )
        continue;
      const status = snap
        ? s.settlementAtClose?.[session.id]?.[o.id]
        : s.data.deliveryLedger.find((l) => l.orderId === o.id)?.status;
      rows.push({
        orderId: o.id,
        number: o.number,
        type: o.type,
        status: o.operationalStatus,
        customerName: o.customerNameSnapshot,
        driverName: o.driverName,
        totalMinor: o.totalMinor,
        collectedMinor: totals.get(o.id) ?? 0,
        reasons: [...(labels.get(o.id) ?? [])],
        deliveryFeeMinor: o.deliveryFeeMinor,
        driverPayMinor:
          o.driverRemunerationMinor ??
          ((o.deliveryFeeBelongsToDriver ??
          s.data.settings.deliveryFeeBelongsToDriver)
            ? o.deliveryFeeMinor
            : 0),
        settlementLabel:
          status === "SETTLED"
            ? "Rendido"
            : status === "PENDING"
              ? "Pendiente"
              : "Sin rendición",
        hasClosingSnapshot: Boolean(snap),
      });
    }
  }
  const totalCount = rows.length + events.length,
    pageSize = Math.min(
      100,
      Math.max(1, Math.floor(input.pageSize ?? 25) || 25),
    ),
    page = Math.min(
      Math.max(1, Math.ceil(totalCount / pageSize)),
      Math.max(1, Math.floor(input.page ?? 1) || 1),
    ),
    start = (page - 1) * pageSize;
  const { movements: _, ...summary } = session;
  const sales = money.filter(
    (m) =>
      m.orderId &&
      ["Cobro", "Venta a cuenta corriente", "Devolución", "Vuelto"].includes(
        m.label,
      ),
  );
  if (sales.length)
    summary.salesTotalMinor = sales.reduce(
      (sum, m) => sum + (m.amountMinor ?? 0),
      0,
    );
  return {
    session: summary,
    orders: rows.slice(start, start + pageSize),
    movements: events.slice(start, start + pageSize),
    totalCount,
    page,
    pageSize,
  };
}
export function getShiftOrderAudit(
  s: State,
  input: ShiftOrderAuditInput,
): ShiftOrderAuditDto {
  const session = sessionOf(s, input.cashSessionId);
  if (!linked(s, session.id).has(input.orderId))
    throw new Error("El pedido no tuvo actividad en este turno.");
  const order = s.data.orders.find((o) => o.id === input.orderId) ?? s.orderCloseSnapshots?.[session.id]?.[input.orderId];
  if (!order) throw new Error("No se encontró el pedido.");
  const all = sessions(s),
    saved = (s.orderEvents ?? []).filter((e) => e.entityId === order.id),
    ids = new Set(saved.map((e) => e.id));
  const legacy = s.audit
    .filter(
      (e) =>
        e.entityType === "ORDER" && e.entityId === order.id && !ids.has(e.id),
    )
    .map((e) => {
      const boxes = all.filter(
        (b) =>
          b.openedAt <= e.timestamp &&
          (!b.closedAt || e.timestamp <= b.closedAt),
      );
      return { ...e, cashSessionId: boxes.length === 1 ? boxes[0]!.id : null };
    });
  const operations: ShiftAuditEvent[] = [...saved, ...legacy].map((e) => ({
    id: e.id,
    cashSessionId: e.cashSessionId,
    sessionNumber: all.find((x) => x.id === e.cashSessionId)?.number ?? null,
    occurredAt: e.timestamp,
    orderId: order.id,
    orderNumber: order.number,
    label: e.action.replaceAll("_", " ").toLowerCase(),
    reason: e.reason,
    operator: e.operatorName,
    authorizer: e.authorizerName,
    method: null,
    amountMinor: null,
    cashEffectMinor: null,
  }));
  return {
    session,
    order,
    orderAtClose: s.orderCloseSnapshots?.[session.id]?.[order.id] ?? null,
    events: [...operations, ...moneyRows(s, { order: order.id })].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    ),
  };
}
