import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AUDIT_FILTER_ACTIONS } from "@gastronomy/contracts";
import {
  ArrowLeft,
  ArrowRight,
  ClockCounterClockwise,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { Badge, Button, Card, Field, Input, Select } from "@gastronomy/ui";
import {
  auditActionLabel,
  auditEntityLabel,
  humanError,
  localDateValue,
  permissionLabel,
} from "../lib";

const PAGE_SIZE = 100;
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateValue(date);
};

export function AuditPage() {
  const [dateFrom, setDateFrom] = useState(() => daysAgo(30));
  const [dateTo, setDateTo] = useState(() => localDateValue());
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["audit", dateFrom, dateTo, action, search, page],
    queryFn: () =>
      window.gastronomy.getAuditLog({
        dateFrom,
        dateTo,
        action: action || undefined,
        search: search.trim() || undefined,
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE + 1,
      }),
  });
  const rows = (query.data ?? []).slice(0, PAGE_SIZE);
  const hasNext = (query.data?.length ?? 0) > PAGE_SIZE;
  const actions = [
    ...new Set([
      ...AUDIT_FILTER_ACTIONS,
      ...(query.data ?? []).map((row) => row.action),
      ...(action ? [action] : []),
    ]),
  ].sort();
  return (
    <div className="panel-enter mx-auto max-w-[1450px] space-y-4">
      <div>
        <h2 className="text-lg font-extrabold">Auditoría operativa</h2>
        <p className="text-xs text-slate-600">
          Registro de eliminaciones y acciones sensibles con impacto económico o
          de seguridad
        </p>
      </div>
      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(170px,180px)_minmax(170px,180px)_minmax(200px,220px)_minmax(240px,1fr)]">
          <Field label="Desde">
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(0);
              }}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(0);
              }}
            />
          </Field>
          <Field label="Acción">
            <Select
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              {actions.map((value) => (
                <option key={value} value={value}>
                  {auditActionLabel(value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Buscar">
            <div className="relative">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
                className="pl-9"
                placeholder="Entidad, usuario o motivo"
              />
            </div>
          </Field>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <div className="grid h-56 place-items-center text-xs font-semibold text-slate-600">
            Cargando auditoría…
          </div>
        ) : query.isError ? (
          <div
            role="alert"
            className="grid min-h-56 place-items-center p-5 text-center"
          >
            <div>
              <p className="text-sm font-semibold text-rose-700">
                No se pudo cargar la auditoría
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {humanError(query.error)}
              </p>
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => void query.refetch()}
              >
                Reintentar
              </Button>
            </div>
          </div>
        ) : rows.length ? (
          <div className="max-h-[calc(100vh-310px)] overflow-auto">
            <table className="dn-table min-w-[700px]">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Entidad</th>
                  <th>Operador / autorizante</th>
                  <th>Permiso</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">
                      <p className="font-semibold">
                        {new Date(row.timestamp).toLocaleDateString("es-AR")}
                      </p>
                      <p className="text-xs text-slate-600">
                        {new Date(row.timestamp).toLocaleTimeString("es-AR")}
                      </p>
                    </td>
                    <td>
                      <Badge
                        tone={
                          row.action.includes("CANCEL")
                            ? "rose"
                            : row.action.includes("CLOSED")
                              ? "amber"
                              : "orange"
                        }
                      >
                        {auditActionLabel(row.action)}
                      </Badge>
                    </td>
                    <td>
                      <p className="font-semibold">
                        {auditEntityLabel(row.entityType)}
                      </p>
                      <p className="max-w-[160px] truncate font-mono text-xs text-slate-600">
                        {row.entityId}
                      </p>
                    </td>
                    <td>
                      <p className="font-semibold">
                        {row.operatorName ?? "Sistema"}
                      </p>
                      {row.authorizerName ? (
                        <p className="text-xs text-brand-700">
                          Autorizó: {row.authorizerName}
                        </p>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs">
                      {permissionLabel(row.permissionUsed)}
                    </td>
                    <td>
                      <p className="max-w-[260px] text-xs">
                        {row.reason ?? "—"}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid h-56 place-items-center text-center">
            <div>
              <ClockCounterClockwise
                className="mx-auto text-slate-300"
                size={36}
              />
              <p className="mt-2 text-sm font-semibold text-slate-500">
                No hay eventos para este filtro
              </p>
            </div>
          </div>
        )}
        {!query.isLoading && !query.isError ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-2">
            <span className="mr-2 text-xs text-slate-500">
              Página {page + 1}
            </span>
            <Button
              variant="secondary"
              disabled={page === 0 || query.isFetching}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ArrowLeft />
              Anterior
            </Button>
            <Button
              variant="secondary"
              disabled={!hasNext || query.isFetching}
              onClick={() => setPage((value) => value + 1)}
            >
              Siguiente
              <ArrowRight />
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
