import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

export async function checkInitialAdminPin(api: Pick<typeof window.gastronomy, "isInitialAdminPinSetupRequired">) {
  return api.isInitialAdminPinSetupRequired();
}

export async function configureInitialAdminPin(
  api: Pick<typeof window.gastronomy, "setInitialAdminPin">,
  values: { currentPin: string; newPin: string; confirmPin: string },
) {
  if (values.newPin !== values.confirmPin) throw new Error("Los PIN nuevos no coinciden.");
  await api.setInitialAdminPin({ currentPin: values.currentPin, newPin: values.newPin });
}

export function InitialAdminPinGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "error" | "pending" | "ready">("checking");
  const [fields, setFields] = useState({ currentPin: "", newPin: "", confirmPin: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    setState("checking"); setError("");
    try { setState(await checkInitialAdminPin(window.gastronomy) ? "pending" : "ready"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo verificar el PIN inicial."); setState("error"); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await configureInitialAdminPin(window.gastronomy, fields);
      setFields({ currentPin: "", newPin: "", confirmPin: "" });
      await check();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo configurar el PIN."); }
    finally { setBusy(false); }
  };
  if (state === "ready") return <>{children}</>;
  if (state === "checking") return <main className="grid h-full place-items-center bg-slate-50" aria-live="polite"><p>Verificando la configuración inicial…</p></main>;
  if (state === "error") return <main className="grid h-full place-items-center bg-slate-50 p-4"><section className="max-w-md rounded-2xl bg-white p-6 shadow"><h1 className="text-lg font-bold">No se pudo verificar el PIN inicial</h1><p role="alert" className="mt-2 text-sm text-rose-700">{error}</p><button className="mt-4 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white" onClick={() => void check()}>Reintentar</button></section></main>;
  return <main className="grid h-full place-items-center bg-slate-950/70 p-4"><form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl" aria-labelledby="initial-pin-title">
    <h1 id="initial-pin-title" className="text-xl font-bold">Configurá el PIN del administrador</h1><p className="text-sm text-slate-600">Ingresá el PIN actual y elegí uno propio de 4 a 8 dígitos. Si es una instalación nueva y no te dieron un PIN inicial distinto, el de fábrica es 1234.</p>
    {([["currentPin", "PIN actual"], ["newPin", "PIN nuevo"], ["confirmPin", "Repetí el PIN nuevo"]] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold">{label}<input autoComplete="off" inputMode={key === "currentPin" ? undefined : "numeric"} pattern={key === "currentPin" ? undefined : "[0-9]{4,8}"} required maxLength={key === "currentPin" ? undefined : 8} type="password" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={fields[key]} onChange={(event) => setFields((old) => ({ ...old, [key]: event.target.value }))} /></label>)}
    {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}<button disabled={busy} className="w-full rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "Guardando…" : "Guardar PIN y continuar"}</button>
  </form></main>;
}
