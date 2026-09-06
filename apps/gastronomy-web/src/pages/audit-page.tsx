import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClockCounterClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { Badge, Card, Field, Input, Select } from "@gastronomy/ui";
import { auditActionLabel, auditEntityLabel, permissionLabel } from "../lib";

const today = () => new Date().toISOString().slice(0,10);
const daysAgo = (days:number) => new Date(Date.now()-days*86_400_000).toISOString().slice(0,10);

export function AuditPage() {
  const [dateFrom,setDateFrom]=useState(daysAgo(30)); const [dateTo,setDateTo]=useState(today()); const [action,setAction]=useState(""); const [search,setSearch]=useState("");
  const query=useQuery({queryKey:["audit",dateFrom,dateTo,action],queryFn:()=>window.gastronomy.getAuditLog({dateFrom,dateTo,action:action||undefined,limit:500})});
  const rows=useMemo(()=>(query.data??[]).filter(row=>`${row.action} ${row.entityType} ${row.entityId} ${row.operatorName??""} ${row.authorizerName??""} ${row.reason??""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),[query.data,search]);
  const actions=[...new Set((query.data??[]).map(row=>row.action))].sort();
  return <div className="panel-enter mx-auto max-w-[1450px] space-y-4"><div><h2 className="text-lg font-extrabold">Auditoría operativa</h2><p className="text-xs text-slate-400">Registro append-only de operaciones, autorizaciones y motivos</p></div><Card className="p-3"><div className="grid gap-3 md:grid-cols-[150px_150px_220px_1fr]"><Field label="Desde"><Input type="date" value={dateFrom} onChange={event=>setDateFrom(event.target.value)}/></Field><Field label="Hasta"><Input type="date" value={dateTo} onChange={event=>setDateTo(event.target.value)}/></Field><Field label="Acción"><Select value={action} onChange={event=>setAction(event.target.value)}><option value="">Todas</option>{actions.map(value=><option key={value} value={value}>{auditActionLabel(value)}</option>)}</Select></Field><Field label="Buscar"><div className="relative"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><Input value={search} onChange={event=>setSearch(event.target.value)} className="pl-9" placeholder="Entidad, usuario o motivo"/></div></Field></div></Card><Card className="overflow-hidden">{query.isLoading?<div className="grid h-56 place-items-center text-xs font-semibold text-slate-400">Cargando auditoría…</div>:rows.length?<div className="max-h-[calc(100vh-270px)] overflow-auto"><table className="dn-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Entidad</th><th>Operador / autorizante</th><th>Permiso</th><th>Motivo</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td className="whitespace-nowrap"><p className="font-semibold">{new Date(row.timestamp).toLocaleDateString("es-AR")}</p><p className="text-[10px] text-slate-400">{new Date(row.timestamp).toLocaleTimeString("es-AR")}</p></td><td><Badge tone={row.action.includes("CANCEL")?"rose":row.action.includes("CLOSED")?"amber":"orange"}>{auditActionLabel(row.action)}</Badge></td><td><p className="font-semibold">{auditEntityLabel(row.entityType)}</p><p className="max-w-[160px] truncate font-mono text-[9px] text-slate-400">{row.entityId}</p></td><td><p className="font-semibold">{row.operatorName??"Sistema"}</p>{row.authorizerName?<p className="text-[10px] text-brand-600">Autorizó: {row.authorizerName}</p>:null}</td><td className="font-mono text-[10px]">{permissionLabel(row.permissionUsed)}</td><td><p className="max-w-[260px] text-xs">{row.reason??"—"}</p></td></tr>)}</tbody></table></div>:<div className="grid h-56 place-items-center text-center"><div><ClockCounterClockwise className="mx-auto text-slate-300" size={36}/><p className="mt-2 text-sm font-semibold text-slate-500">No hay eventos para este filtro</p></div></div>}</Card></div>;
}




