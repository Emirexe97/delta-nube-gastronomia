import { useEffect, useMemo, useRef, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  AddressBook,
  ArrowCounterClockwise,
  ArrowsLeftRight,
  CashRegister,
  ChartPieSlice,
  Clock,
  ForkKnife,
  GearSix,
  List,
  Package,
  ShoppingCart,
  Motorcycle,
  Receipt,
  ShieldCheck,
  SquaresFour,
  UsersThree,
  WifiSlash,
} from "@phosphor-icons/react";
import { Badge, cn } from "@gastronomy/ui";
import { useBootstrap } from "./api";
import { formatMoney } from "./lib";
import { DashboardPage } from "./pages/dashboard-page";
import { TablesPage } from "./pages/tables-page";
import { OrdersPage } from "./pages/orders-page";
import { CatalogPage } from "./pages/catalog-page";
import { PurchasesPage } from "./pages/purchases-page";
import { CustomersPage } from "./pages/customers-page";
import { CashPage } from "./pages/cash-page";
import { ReportsPage } from "./pages/reports-page";
import { SettingsPage } from "./pages/settings-page";
import { DeliveriesPage } from "./pages/deliveries-page";
import { UsersPage } from "./pages/users-page";
import { AuditPage } from "./pages/audit-page";
import { resetDemoData } from "./demo/demo-api";
import { isDemoMode } from "./demo/install-demo";
import { useEnterNavigation } from "./hooks/use-enter-navigation";

const navigation = [
  { to: "/resumen", label: "Resumen", icon: ChartPieSlice, group: "General" },
  {
    to: "/salon",
    label: "Salón",
    icon: SquaresFour,
    group: "Operación",
    module: "diningRoom",
  },
  { to: "/pedidos", label: "Pedidos", icon: Receipt, group: "Operación" },
  { to: "/catalogo", label: "Productos", icon: Package, group: "Gestión" },
  {
    to: "/compras",
    label: "Compras",
    icon: ShoppingCart,
    group: "Gestión",
    permission: "purchases.manage",
  },
  { to: "/clientes", label: "Clientes", icon: AddressBook, group: "Gestión" },
  {
    to: "/repartidores",
    label: "Repartidores",
    icon: Motorcycle,
    group: "Gestión",
    module: "delivery",
  },
  { to: "/usuarios", label: "Usuarios", icon: UsersThree, group: "Gestión" },
  { to: "/caja", label: "Caja", icon: CashRegister, group: "Control" },
  {
    to: "/informes",
    label: "Informes",
    icon: ArrowsLeftRight,
    group: "Control",
  },
  { to: "/auditoria", label: "Auditoría", icon: ShieldCheck, group: "Control" },
  {
    to: "/configuracion",
    label: "Configuración",
    icon: GearSix,
    group: "Sistema",
  },
] as const;

export function App() {
  useEnterNavigation();
  const bootstrap = useBootstrap();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("gastronomy.sidebar.collapsed") === "true",
  );
  const [clock, setClock] = useState(new Date());
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const routeHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
    routeHeadingRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    const dirtyForms = new WeakSet<HTMLFormElement>();
    let historyGuardArmed = false;
    let bypassNextPop = false;
    let armTimer: number | null = null;
    const hasPendingFormChanges = () =>
      document.querySelector('[data-navigation-dirty="true"]') !== null ||
      [...document.forms].some((form) => dirtyForms.has(form));
    const hasCriticalOperation = () =>
      document.querySelector('[role="dialog"][aria-busy="true"]') !== null;
    const showBlockedNotice = (message: string) => {
      setNavigationNotice(message);
      window.setTimeout(
        () =>
          setNavigationNotice((current) =>
            current === message ? null : current,
          ),
        3_500,
      );
    };
    const armHistoryGuard = () => {
      if (historyGuardArmed || !hasPendingFormChanges()) return;
      window.history.pushState(
        { ...window.history.state, gastronomyDirtyGuard: true },
        "",
        window.location.href,
      );
      historyGuardArmed = true;
    };
    const markFormDirty = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const form = target.closest("form");
      if (form && form.dataset.navigationAutosave !== "true")
        dirtyForms.add(form);
      if (armTimer != null) window.clearTimeout(armTimer);
      armTimer = window.setTimeout(armHistoryGuard, 0);
    };
    const markFormSubmitted = (event: Event) => {
      if (event.target instanceof HTMLFormElement)
        dirtyForms.delete(event.target);
    };
    const handler = (event: KeyboardEvent) => {
      const destination =
        event.key === "F2"
          ? "/salon"
          : event.key === "F3"
            ? "/pedidos?nuevo=TAKEAWAY"
            : event.key === "F4"
              ? "/pedidos?nuevo=DELIVERY"
              : event.key === "F6"
                ? "/pedidos?buscar=1"
                : event.ctrlKey && event.key.toLowerCase() === "p"
                  ? "/catalogo?buscar=1"
                  : null;
      if (!destination) return;
      event.preventDefault();
      if (event.repeat) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
        showBlockedNotice(
          "Cerrá la ventana abierta antes de cambiar de sección.",
        );
        return;
      }
      if (hasCriticalOperation()) {
        showBlockedNotice("Esperá a que termine la operación en curso.");
        return;
      }
      if (hasPendingFormChanges()) {
        showBlockedNotice(
          "Hay cambios sin guardar. Guardalos o cancelalos antes de usar un atajo.",
        );
        return;
      }
      navigate(destination, { replace: historyGuardArmed });
      historyGuardArmed = false;
    };
    const handleNavigationClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank") return;
      const destination = new URL(anchor.href, window.location.href);
      if (hasCriticalOperation()) {
        event.preventDefault();
        event.stopPropagation();
        showBlockedNotice("Esperá a que termine la operación en curso.");
        return;
      }
      if (
        destination.origin !== window.location.origin ||
        destination.href === window.location.href ||
        !hasPendingFormChanges()
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (
        window.confirm(
          "Hay cambios sin guardar. ¿Querés descartarlos y cambiar de sección?",
        )
      ) {
        const replaceGuard = historyGuardArmed;
        historyGuardArmed = false;
        navigate(
          destination.hash.startsWith("#/")
            ? destination.hash.slice(1)
            : `${destination.pathname}${destination.search}${destination.hash}`,
          { replace: replaceGuard },
        );
      } else {
        showBlockedNotice(
          "La navegación se canceló para conservar tus cambios.",
        );
      }
    };
    const handleHistoryPop = () => {
      if (bypassNextPop) {
        bypassNextPop = false;
        return;
      }
      if (!historyGuardArmed) return;
      if (hasCriticalOperation()) {
        window.history.pushState(
          { ...window.history.state, gastronomyDirtyGuard: true },
          "",
          window.location.href,
        );
        showBlockedNotice("Esperá a que termine la operación en curso.");
        return;
      }
      if (
        hasPendingFormChanges() &&
        !window.confirm(
          "Hay cambios sin guardar. ¿Querés descartarlos y volver atrás?",
        )
      ) {
        window.history.pushState(
          { ...window.history.state, gastronomyDirtyGuard: true },
          "",
          window.location.href,
        );
        showBlockedNotice(
          "La navegación se canceló para conservar tus cambios.",
        );
        return;
      }
      historyGuardArmed = false;
      bypassNextPop = true;
      window.history.back();
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingFormChanges() && !hasCriticalOperation()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("input", markFormDirty, true);
    window.addEventListener("change", markFormDirty, true);
    window.addEventListener("submit", markFormSubmitted, true);
    window.addEventListener("keydown", handler);
    document.addEventListener("click", handleNavigationClick, true);
    window.addEventListener("popstate", handleHistoryPop);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("input", markFormDirty, true);
      window.removeEventListener("change", markFormDirty, true);
      window.removeEventListener("submit", markFormSubmitted, true);
      window.removeEventListener("keydown", handler);
      document.removeEventListener("click", handleNavigationClick, true);
      window.removeEventListener("popstate", handleHistoryPop);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (armTimer != null) window.clearTimeout(armTimer);
    };
  }, [navigate]);

  const visibleNavigation = useMemo(() => {
    const modules = bootstrap.data?.settings.modules;
    const permissions = bootstrap.data?.currentUser.permissions ?? [];
    return navigation.filter(
      (item) =>
        (!("module" in item) || modules?.[item.module] !== false) &&
        (!("permission" in item) ||
          permissions.includes(item.permission) ||
          permissions.includes("*")),
    );
  }, [
    bootstrap.data?.currentUser.permissions,
    bootstrap.data?.settings.modules,
  ]);
  const groups = [...new Set(visibleNavigation.map((item) => item.group))];
  const current = navigation.find((item) =>
    location.pathname.startsWith(item.to),
  );

  if (bootstrap.isLoading) {
    return (
      <div className="grid h-full place-items-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
          <p className="mt-3 text-sm font-semibold text-slate-500">
            Preparando operación local…
          </p>
        </div>
      </div>
    );
  }
  if (bootstrap.isError || !bootstrap.data) {
    return (
      <div className="grid h-full place-items-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-soft">
          <WifiSlash className="mx-auto h-10 w-10 text-rose-500" />
          <h1 className="mt-3 text-lg font-bold">No se pudo iniciar</h1>
          <p className="mt-2 text-sm text-slate-500">
            {bootstrap.error?.message}
          </p>
          <button
            className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => bootstrap.refetch()}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-slate-50 text-slate-950">
      {navigationNotice ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[250] max-w-md -translate-x-1/2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900 shadow-xl"
        >
          {navigationNotice}
        </div>
      ) : null}
      <aside
        className={cn(
          "relative flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 max-sm:w-14",
          collapsed ? "w-16" : "w-[214px]",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-4">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-800 via-brand-600 to-amber-400 text-white shadow-lg shadow-brand-200">
            <ForkKnife size={20} weight="bold" />
          </div>
          {!collapsed ? (
            <div className="min-w-0 max-sm:hidden">
              <p className="truncate text-sm font-extrabold tracking-tight">
                Delta Nube
              </p>
              <p className="truncate text-[10px] font-bold uppercase tracking-[.17em] text-brand-600">
                Gastronomía
              </p>
            </div>
          ) : null}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              {!collapsed ? (
                <p className="mb-1 px-2 text-[9px] font-bold uppercase tracking-[.18em] text-slate-400 max-sm:hidden">
                  {group}
                </p>
              ) : null}
              {visibleNavigation
                .filter((item) => item.group === group)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      aria-label={item.label}
                      title={item.label}
                      className={({ isActive }) =>
                        cn(
                          "mb-0.5 flex h-10 items-center gap-3 rounded-lg px-3 text-[12px] font-semibold transition max-sm:justify-center max-sm:px-0",
                          isActive
                            ? "bg-brand-50 text-brand-700"
                            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                        )
                      }
                    >
                      <Icon size={18} weight="duotone" />
                      {!collapsed ? (
                        <span className="max-sm:hidden">{item.label}</span>
                      ) : null}
                    </NavLink>
                  );
                })}
            </div>
          ))}
        </nav>
        <button
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            localStorage.setItem("gastronomy.sidebar.collapsed", String(next));
          }}
          className="m-2 flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50 max-sm:hidden"
        >
          <List size={17} />
          {!collapsed ? "Contraer" : null}
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 max-sm:px-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">
              Operación local
            </p>
            <h1
              ref={routeHeadingRef}
              tabIndex={-1}
              className="text-base font-bold text-slate-950 outline-none"
            >
              {current?.label ?? "Gastronomía"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isDemoMode ? (
              <button
                type="button"
                title="Borra los cambios de prueba y recupera los datos iniciales"
                onClick={() => {
                  resetDemoData();
                  window.location.reload();
                }}
                className="hidden items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[.08em] text-amber-800 transition hover:bg-amber-100 md:flex"
              >
                <ArrowCounterClockwise size={15} weight="bold" />
                Modo demostración · Restablecer
              </button>
            ) : null}
            <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 xl:flex">
              <Clock size={15} />
              <span>
                {clock.toLocaleDateString("es-AR", {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                })}{" "}
                ·{" "}
                {clock.toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {bootstrap.data.cashSession ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-600">
                  Caja #{bootstrap.data.cashSession.number} abierta
                </p>
                <p className="text-xs font-bold text-emerald-800">
                  {formatMoney(bootstrap.data.cashSession.expectedAmountMinor)}
                </p>
              </div>
            ) : (
              <Badge tone="amber">Caja cerrada</Badge>
            )}
            <div className="border-l border-slate-200 pl-3 text-right max-sm:hidden">
              <p className="text-xs font-bold">
                {bootstrap.data.currentUser.fullName}
              </p>
              <p className="text-[10px] text-slate-400">
                {bootstrap.data.currentUser.roleName}
              </p>
            </div>
          </div>
        </header>
        <div
          ref={contentRef}
          className="min-h-0 flex-1 overflow-auto p-4 lg:p-5"
        >
          <Routes>
            <Route path="/" element={<Navigate to="/resumen" replace />} />
            <Route
              path="/resumen"
              element={<DashboardPage data={bootstrap.data} />}
            />
            <Route
              path="/salon"
              element={<TablesPage data={bootstrap.data} />}
            />
            <Route
              path="/pedidos"
              element={<OrdersPage data={bootstrap.data} />}
            />
            <Route
              path="/catalogo"
              element={<CatalogPage data={bootstrap.data} />}
            />
            <Route
              path="/compras"
              element={
                bootstrap.data.currentUser.permissions.includes(
                  "purchases.manage",
                ) || bootstrap.data.currentUser.permissions.includes("*") ? (
                  <PurchasesPage data={bootstrap.data} />
                ) : (
                  <Navigate to="/resumen" replace />
                )
              }
            />
            <Route
              path="/clientes"
              element={<CustomersPage data={bootstrap.data} />}
            />
            <Route
              path="/repartidores"
              element={<DeliveriesPage data={bootstrap.data} />}
            />
            <Route
              path="/usuarios"
              element={<UsersPage data={bootstrap.data} />}
            />
            <Route path="/caja" element={<CashPage data={bootstrap.data} />} />
            <Route
              path="/informes"
              element={<ReportsPage data={bootstrap.data} />}
            />
            <Route path="/auditoria" element={<AuditPage />} />
            <Route
              path="/configuracion"
              element={<SettingsPage data={bootstrap.data} />}
            />
            <Route path="*" element={<Navigate to="/resumen" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
