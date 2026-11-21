import type { FinanceBooksDto, FinanceExpenseDto } from "@gastronomy/contracts";
import { formatMoney, localDateValue } from "../lib";

export function FinanceForecast({
  books,
  expenses,
}: {
  books: FinanceBooksDto;
  expenses: FinanceExpenseDto[];
}) {
  const today = localDateValue(),
    last = new Date();
  last.setDate(last.getDate() + 30);
  const horizon = localDateValue(last);
  const days = new Map<
    string,
    { incoming: number; outgoing: number; detail: string[] }
  >();
  function add(
    date: string,
    incoming: number,
    outgoing: number,
    description: string,
  ) {
    const day = date.slice(0, 10);
    if (day > horizon) return;
    const key = day < today ? "Vencido" : day;
    const slot = days.get(key) ?? { incoming: 0, outgoing: 0, detail: [] };
    slot.incoming += incoming;
    slot.outgoing += outgoing;
    slot.detail.push(description);
    days.set(key, slot);
  }
  for (const s of books.settlements)
    if (s.status === "expected")
      add(
        s.occurredAt,
        s.expectedNetMinor,
        0,
        "Lote · " + formatMoney(s.expectedNetMinor),
      );
  for (const o of books.obligations)
    if (o.outstandingMinor > 0 && o.dueAt)
      add(
        o.dueAt,
        0,
        o.outstandingMinor,
        o.supplierName + " · " + formatMoney(o.outstandingMinor),
      );
  for (const e of expenses)
    if (!e.paidAt && !e.cancelledAt)
      add(
        e.dueOn,
        0,
        e.amountMinor,
        e.title + " · " + formatMoney(e.amountMinor),
      );
  let projected = books.accounts.reduce((sum, a) => sum + a.balanceMinor, 0);
  const rows = [...days]
    .sort(([a], [b]) =>
      a === b
        ? 0
        : a === "Vencido"
          ? -1
          : b === "Vencido"
            ? 1
            : a.localeCompare(b),
    )
    .map(([date, slot]) => {
      projected += slot.incoming - slot.outgoing;
      return { date, ...slot, projected };
    });
  return (
    <div>
      <p className="mb-2 text-xs text-slate-600">
        Saldo de partida de las cuentas de fondos, acreditaciones previstas y
        vencimientos de los próximos 30 días. Los vencidos se muestran al
        inicio.
      </p>
      {rows.length ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                {[
                  "Fecha",
                  "Por acreditar",
                  "Por pagar",
                  "Saldo proyectado",
                ].map((h) => (
                  <th key={h} scope="col" className="p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t">
                  <td className="p-2">
                    <details>
                      <summary>{r.date}</summary>
                      {r.detail.map((item, i) => (
                        <p key={i}>{item}</p>
                      ))}
                    </details>
                  </td>
                  <td className="p-2">{formatMoney(r.incoming)}</td>
                  <td className="p-2">{formatMoney(r.outgoing)}</td>
                  <td className="p-2 font-semibold">
                    {books.accounts.length
                      ? formatMoney(r.projected)
                      : "Sin saldo inicial"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-600">
          Sin acreditaciones ni vencimientos registrados para los próximos 30
          días.
        </p>
      )}
    </div>
  );
}
