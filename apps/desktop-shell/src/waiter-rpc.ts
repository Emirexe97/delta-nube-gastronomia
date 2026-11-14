import type { SqliteGastronomyRepository } from "@gastronomy/database";
// @ts-ignore Node's native test runner needs the explicit TypeScript extension.
import { WaiterRequestError, type RelayRequest } from "./waiter-relay.ts";

const id = (v: unknown, min = 1): v is string =>
  typeof v === "string" &&
  v.length >= min &&
  v.length <= 128 &&
  /^[\w-]+$/.test(v);
const fail = (code: string, message: string): never => {
  throw new WaiterRequestError(code, message);
};

function readBatch(p: Record<string, unknown>) {
  if (
    !id(p.requestId, 16) ||
    !id(p.tableId) ||
    !(p.expectedOrderId === null || id(p.expectedOrderId)) ||
    (p.printMode != null && p.printMode !== "FULL" && p.printMode !== "ADDED" && p.printMode !== "NONE") ||
    !Array.isArray(p.lines) ||
    !p.lines.length ||
    p.lines.length > 80
  )
    throw new WaiterRequestError(
      "invalid_batch",
      "Revisá la mesa y los productos de la tanda.",
    );
  const lines = p.lines.map((raw: unknown) => {
    const row = raw as Record<string, unknown>;
    if (
      !row ||
      !id(row.lineId, 8) ||
      !id(row.productId) ||
      (row.secondProductId != null && !id(row.secondProductId)) ||
      !Number.isSafeInteger(row.quantity) ||
      Number(row.quantity) < 1 ||
      Number(row.quantity) > 99 ||
      (row.note != null &&
        (typeof row.note !== "string" || row.note.length > 300))
    ) {
      throw new WaiterRequestError(
        "invalid_batch",
        "Cantidad, producto u observación inválida.",
      );
    }
    return {
      lineId: row.lineId,
      productId: row.productId,
      ...(id(row.secondProductId) ? { secondProductId: row.secondProductId } : {}),
      quantity: Number(row.quantity),
      ...(typeof row.note === "string" ? { note: row.note } : {}),
    };
  });
  return {
    requestId: p.requestId,
    tableId: p.tableId,
    ...(id(p.expectedCashSessionId)
      ? { expectedCashSessionId: p.expectedCashSessionId }
      : {}),
    expectedOrderId: p.expectedOrderId,
    ...(p.printMode === "FULL" || p.printMode === "ADDED" || p.printMode === "NONE"
      ? { printMode: p.printMode as "FULL" | "ADDED" | "NONE" }
      : {}),
    // Preserve the phone's original timestamp verbatim across relay retries.
    // Missing/non-string values deliberately remain absent so the repository
    // applies its conservative pending-review fallback.
    ...(typeof p.submittedAt === "string"
      ? { submittedAt: p.submittedAt }
      : {}),
    lines,
  };
}

/** Narrow allowlist: the bridge never forwards arbitrary repository or cash-register methods. */
export function handleWaiterRequest(
  repo: SqliteGastronomyRepository,
  request: RelayRequest,
  dispatch: (jobId: string) => void,
) {
  const p = request.params;
  if (!p || typeof p !== "object" || Array.isArray(p))
    return fail("invalid_request", "Solicitud inválida.");
  try {
    if (request.kind === "pair" && request.method === "waiter.pair") {
      if (
        !id(p.challengeId, 32) ||
        typeof p.pin !== "string" ||
        !/^\d{4,8}$/.test(p.pin)
      )
        return fail("pair_failed", "El PIN o el código no son válidos.");
      return repo.pairWaiterSession({ challengeId: p.challengeId, pin: p.pin });
    }
    if (request.kind !== "rpc" || !id(request.sessionId, 32))
      return fail("unauthorized", "Volvé a vincularte en caja.");
    const token = request.sessionId;
    switch (request.method) {
      case "waiter.getState":
        return repo.getWaiterSessionState(token);
      case "waiter.getTable": {
        if (!id(p.tableId)) return fail("invalid_request", "Mesa inválida.");
        return repo.getWaiterTable(token, { tableId: p.tableId });
      }
      case "waiter.reprintTable": {
        if (!id(p.tableId) || !id(p.orderId) || !id(p.requestId, 16) ||
            (p.scope !== "FULL" && p.scope !== "ADDED"))
          return fail("invalid_request", "Solicitud de reimpresión inválida.");
        const result = repo.reprintWaiterTable(token, {
          tableId: p.tableId,
          orderId: p.orderId,
          requestId: p.requestId,
          scope: p.scope,
        });
        if (result.created && result.printJobId) dispatch(result.printJobId);
        return result;
      }
      case "waiter.getBatch": {
        if (!id(p.requestId, 16))
          return fail("invalid_request", "Identificador de tanda inválido.");
        return (
          repo.getWaiterBatch(token, p.requestId) ?? {
            requestId: p.requestId,
            status: "NOT_FOUND",
          }
        );
      }
      case "waiter.revoke":
        repo.revokeWaiterSession(token);
        return { revoked: true };
      case "waiter.submitBatch": {
        const result = repo.submitWaiterBatch(token, readBatch(p));
        if (result.created && result.printJobId) dispatch(result.printJobId);
        return result;
      }
      default:
        return fail("invalid_request", "Operación no disponible.");
    }
  } catch (e) {
    if (e instanceof WaiterRequestError) throw e;
    const msg = e instanceof Error ? e.message : "";
    if (request.kind === "pair" && msg === "PIN de mozo incorrecto.")
      return fail("invalid_pin", "El PIN del mozo es incorrecto.");
    if (
      request.kind === "pair" &&
      (msg.startsWith("El QR venció o fue bloqueado.") ||
        msg === "El QR pertenece a otro turno.")
    )
      return fail(
        "pairing_expired",
        "El QR venció o pertenece a otro turno. Solicitá uno nuevo en caja.",
      );
    if (request.kind === "pair")
      return fail(
        "pair_failed",
        "No se pudo vincular. Revisá tu PIN y solicitá otro QR en la caja.",
      );
    if (/sesi[oó]n|turno|caja abierta|sal[oó]n deshabilitado/i.test(msg))
      return fail(
        "unauthorized",
        "La sesión venció, fue revocada o cambió el turno. Volvé a escanear en caja.",
      );
    if (
      /mesa|producto|stock|pedido|tanda|impresora|cantidad|comanda|línea|combo|pizza|mitad|elegible/i.test(
        msg,
      ) &&
      !/SQLITE|constraint|SELECT |INSERT |UPDATE |DELETE |file:|[A-Z]:\\/i.test(
        msg,
      )
    )
      return fail("rejected", msg.slice(0, 200));
    throw e;
  }
}
