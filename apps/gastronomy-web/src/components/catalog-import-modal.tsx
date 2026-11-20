import { useMemo, useRef, useState } from "react";
import type { CategoryDto, ProductDto } from "@gastronomy/contracts";
import { Button, Modal } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { humanError } from "../lib";
import { CSV_TEMPLATE, MAX_CSV_BYTES, decodeCatalogCsvBytes, parseCatalogCsv, type ImportRow } from "../catalog-import-csv";

type Batch = { idempotencyKey: string; rows: ImportRow[] };
export function CatalogImportModal({ open, onClose, categories, products }: { open: boolean; onClose(): void; categories: CategoryDto[]; products: ProductDto[] }) {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const [error, setError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [batch, setBatch] = useState<Batch | null>(null);
  const busy = useRef(false);
  const fileSequence = useRef(0);
  const succeeded = useRef(false);
  const preview = useMemo(() => parseCatalogCsv(text, categories, products), [text, categories, products]);
  const usable = preview.rows.filter((r) => r.data).length;
  const mutation = useApiMutation(
    (input: Batch) => window.gastronomy.importProducts(input),
    {
      onSuccess: (created) => { succeeded.current = true; setStatus(`Se crearon ${created.length} productos.`); setText(""); setBatch(null); setError(""); },
      onError: (e) => { succeeded.current = false; setError(humanError(e)); },
      onSettled: () => { busy.current = false; },
    },
  );
  const close = () => {
    if (busy.current || mutation.isPending || fileLoading) return;
    if (succeeded.current) { setStatus(""); succeeded.current = false; }
    onClose();
  };
  const discardBatch = () => {
    if (!window.confirm("¿Descartar este lote? Si se perdió la respuesta, los productos pueden estar cargados. Primero consultá el catálogo. Un nuevo lote con los mismos códigos será rechazado; no cambies los códigos para repetir una importación ya realizada.")) return;
    setBatch(null); setText(""); setError(""); setFileError(""); setStatus("");
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "plantilla-productos.csv"; a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <Modal open={open} onClose={close} title="Importar productos desde CSV" description="Importa productos nuevos; no modifica productos existentes ni su stock.">
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Excel: guardá/exportá como CSV UTF-8. Separador coma o punto y coma. Los productos importados comienzan con stock 0 en categorías con control de stock.</p>
        <Button type="button" variant="secondary" onClick={download}>Descargar plantilla CSV</Button>
      </div>
      <label className="grid gap-1 text-sm font-semibold">Archivo CSV
        <input type="file" accept=".csv,text/csv" disabled={mutation.isPending || fileLoading || Boolean(batch)} onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
          const sequence = ++fileSequence.current;
          setFileLoading(true); setText(""); setFileError(""); setError(""); setStatus(""); setBatch(null);
          if (file.size > MAX_CSV_BYTES) { setFileError("El archivo supera el máximo de 1 MiB."); setFileLoading(false); return; }
          try { const contents = decodeCatalogCsvBytes(await file.arrayBuffer()); if (sequence === fileSequence.current) setText(contents); }
          catch { if (sequence === fileSequence.current) setFileError("No se pudo leer el archivo. Guardalo como CSV UTF-8 y volvé a intentarlo."); }
          finally { if (sequence === fileSequence.current) setFileLoading(false); }
        }} />
      </label>
      {fileLoading && <p role="status" className="text-sm text-slate-600">Leyendo archivo…</p>}
      {fileError && <p role="alert" className="text-sm text-rose-700">{fileError}</p>}
      {status && <p role="status" aria-live="polite" className="rounded bg-emerald-50 p-2 text-sm text-emerald-800">{status}</p>}
      {text && <>
        <p aria-live="polite" className="text-sm font-semibold">{usable} válidas · {preview.rows.length - usable} filas con errores{preview.errors.length ? ` · ${preview.errors.length} errores generales` : ""}</p>
        {preview.errors.length > 0 && <ul className="text-sm text-rose-700">{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-200" role="region" aria-label="Vista previa CSV" tabIndex={0}>
          <table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{["Fila", "Código", "Nombre", "Categoría", "Precio", "Estado"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{preview.rows.map((r) => <tr key={r.line} className="border-t"><td className="p-2">{r.line}</td>{r.values.map((v, i) => <td key={i} className="p-2">{v}</td>)}<td className="p-2">{r.errors.length ? <span className="text-rose-700">{r.errors.join(" ")}</span> : "Lista para importar"}</td></tr>)}</tbody>
          </table>
        </div>
      </>}
      {batch && error && <><p role="alert" className="rounded bg-rose-50 p-2 text-sm text-rose-800">{error} No cambies el lote: reintentá con la misma clave. Si la respuesta se perdió, consultá el catálogo para confirmar si ya se crearon productos.</p><Button type="button" variant="secondary" disabled={mutation.isPending} onClick={discardBatch}>Descartar lote y elegir otro archivo…</Button></>}
      {error && !batch && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close} disabled={mutation.isPending || fileLoading}>Cerrar</Button>
        <Button type="button" disabled={mutation.isPending || fileLoading || Boolean(fileError) || (!batch && (!usable || usable !== preview.rows.length || preview.errors.length > 0))} onClick={() => {
          if (busy.current) return;
          if (!batch) {
            if (!usable || usable !== preview.rows.length || preview.errors.length > 0 || !window.confirm(`¿Crear ${usable} productos nuevos? Esta operación solo crea productos y no modifica productos existentes ni su stock.`)) return;
            const frozen = { idempotencyKey: crypto.randomUUID(), rows: preview.rows.map((r) => r.data!) };
            setBatch(frozen); setError(""); busy.current = true; mutation.mutate(frozen); return;
          }
          busy.current = true; mutation.mutate(batch);
        }}>{mutation.isPending ? "Importando…" : batch ? "Reintentar mismo lote" : `Importar ${usable} productos`}</Button>
      </div>
    </div>
  </Modal>;
}
