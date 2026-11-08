import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Field, HelpTip, Select } from "@gastronomy/ui";
import type { BootstrapDto } from "@gastronomy/contracts";
import { humanError } from "../lib";

export function WaiterDeskPanel({ data }: { data: BootstrapDto }) {
  const allowed = data.currentUser.permissions.includes("settings.manage");
  const status = useQuery({
    queryKey: ["waiter-desk", data.currentUser.id],
    queryFn: () => window.gastronomy.getWaiterDeskStatus(),
    enabled: allowed,
    refetchInterval: 5000,
    retry: false,
  });
  const waiters = data.users.filter((u) => u.active && u.roleCode === "WAITER");
  const [selected, select] = useState("");
  const waiterId = waiters.some((w) => w.id === selected)
    ? selected
    : waiters[0]?.id;
  const [qr, setQr] = useState<{ image: string; expiresAt: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const cashOpen = data.cashSession?.status === "OPEN";
  useEffect(() => {
    if (!qr) return;
    const timer = window.setTimeout(
      () => setQr(null),
      Math.max(0, Date.parse(qr.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [qr]);
  useEffect(() => {
    setQr(null);
  }, [waiterId, data.cashSession?.id, allowed]);
  if (!allowed) return null;
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await operation();
      await status.refetch();
    } catch (error) {
      setMessage(humanError(error));
    } finally {
      setBusy(false);
    }
  }
  const ready =
    cashOpen &&
    data.settings.modules.diningRoom &&
    status.data?.configured &&
    !!waiterId;
  return (
    <Card id="settings-waiter" className="scroll-mt-20 space-y-3 p-4">
      <div>
        <h3 className="text-sm font-extrabold">Vincular teléfonos de mozos <HelpTip label="Código QR">Vence en 2 minutos y se usa una sola vez.</HelpTip></h3>
        <p className="text-xs text-slate-600">
          Elegí al mozo y generá un QR para vincular su teléfono desde esta caja.
        </p>
      </div>
      {!cashOpen && (
        <p className="text-xs">
          Abrí un turno de caja para vincular teléfonos.
        </p>
      )}
      {!data.settings.modules.diningRoom && (
        <p className="text-xs">
          Activá el módulo Salón y guardá la configuración.
        </p>
      )}
      {status.data && !status.data.configured && (
        <p className="text-xs">
          {status.data.automaticEnrollment
            ? "La caja todavía no recibió el acceso de mozos. Se solicita automáticamente al validar la licencia por Internet. Si el aviso persiste, consultá con soporte."
            : "El servicio para recibir pedidos desde el teléfono no está listo. Consultá con soporte."}
        </p>
      )}
      {status.data?.configured && !status.data.printerReady && (
        <p className="text-xs">
          La impresora de cocina es opcional. Sin ella, los pedidos quedan en su mesa de Salón y no se imprimen.
        </p>
      )}
      {!waiters.length && (
        <p className="text-xs">
          Creá un usuario activo con rol Mozo y PIN propio.
        </p>
      )}
      {status.data?.connectionError && (
        <p role="status">No hay conexión con los teléfonos de los mozos. Podés seguir trabajando desde esta PC. Los pedidos pendientes se revisan en Salón → Mozos.</p>
      )}
      {status.error && <p role="alert">{humanError(status.error)}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Mozo que va a escanear">
          <Select
            value={waiterId ?? ""}
            disabled={busy || !waiters.length}
            onChange={(e) => select(e.target.value)}
          >
            {!waiters.length && <option value="">Sin mozos activos</option>}
            {waiters.map((w) => (
              <option key={w.id} value={w.id}>
                {w.fullName} · #{w.staffNumber}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          disabled={!ready || busy}
          onClick={() =>
            void run(async () => {
              setQr(null);
              const issued = await window.gastronomy.issueWaiterQr({
                waiterId: waiterId!,
              });
              setQr(issued);
            })
          }
        >
          Vincular teléfono
        </Button>
      </div>
      {qr && cashOpen && (
        <div className="w-fit rounded-xl border p-3 text-center">
          <img
            src={qr.image}
            width="224"
            height="224"
            alt="QR de vinculación del teléfono del mozo seleccionado"
          />
          <p className="text-xs">
            Escaneá el código e ingresá tu PIN. Vence a las {clock(qr.expiresAt)} y se usa una sola vez.
          </p>
          <Button variant="secondary" onClick={() => setQr(null)}>
            Ocultar QR
          </Button>
        </div>
      )}
      <div className="flex items-center gap-1 text-xs font-bold">
        Accesos activos
        <HelpTip label="Accesos de los teléfonos">Podés revocar el acceso si el mozo se retira. El sistema no comprueba si el teléfono sigue dentro del local.</HelpTip>
      </div>
      <p className="text-xs text-slate-600">Los accesos duran hasta el cierre de caja.</p>
      {status.data && !status.data.sessions.length && (
        <p className="text-xs">Ningún teléfono vinculado.</p>
      )}
      {status.data?.sessions.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span>
            {s.name} · {s.expiresAt === null ? "hasta el cierre de caja" : `hasta ${clock(s.expiresAt)}`}
          </span>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await window.gastronomy.revokeWaiterDevice({ sessionId: s.id });
                setMessage("Acceso revocado.");
              })
            }
          >
            Revocar
          </Button>
        </div>
      ))}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </Card>
  );
}
function clock(value: string) {
  return new Date(value).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
