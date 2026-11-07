import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
import { Badge, cn, PreservedWorkspace } from "@gastronomy/ui";
import brandSymbol from "./assets/brand/simbolo.png";
import brandWordmark from "./assets/brand/marca.png";
import { useBootstrap } from "./api";
import { OrderPrintStatus } from "./components/order-print-status";
import { formatMoney } from "./lib";
import { DashboardPage } from "./pages/dashboard-page";
const TablesPage = lazy(() => import("./pages/tables-page").then(m => ({ default: m.TablesPage })));
const OrdersPage = lazy(() => import("./pages/orders-page").then(m => ({ default: m.OrdersPage })));
const CatalogPage = lazy(() => import("./pages/catalog-page").then(m => ({ default: m.CatalogPage })));
const PurchasesPage = lazy(() => import("./pages/purchases-page").then(m => ({ default: m.PurchasesPage })));
const CustomersPage = lazy(() => import("./pages/customers-page").then(m => ({ default: m.CustomersPage })));
const CashPage = lazy(() => import("./pages/cash-page").then(m => ({ default: m.CashPage })));
const ReportsPage = lazy(() => import("./pages/reports-page").then(m => ({ default: m.ReportsPage })));
const FinancePage = lazy(() => import("./pages/finance-page").then(m => ({ default: m.FinancePage })));
const SettingsPage = lazy(() => import("./pages/settings-page").then(m => ({ default: m.SettingsPage })));
const DeliveriesPage = lazy(() => import("./pages/deliveries-page").then(m => ({ default: m.DeliveriesPage })));
const UsersPage = lazy(() => import("./pages/users-page").then(m => ({ default: m.UsersPage })));
const AuditPage = lazy(() => import("./pages/audit-page").then(m => ({ default: m.AuditPage })));
import { isDemoMode } from "./demo/install-demo";
import { useEnterNavigation } from "./hooks/use-enter-navigation";
import { useLicenseStatus } from "./hooks/use-license-status";
import { useAppUpdateStatus } from "./hooks/use-app-update-status";
import { HeaderClock } from "./components/header-clock";
import { RouteErrorBoundary } from "./components/route-error-boundary";
import { resetDemoAndReload } from "./demo/startup";

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
    to: "/finanzas",
    label: "Finanzas",
    icon: ChartPieSlice,
    group: "Control",
    permission: "finance.view",
  },
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
  const waiterQueryClient = useQueryClient();
  const [waiterNotice,setWaiterNotice] = useState("");
  const [demoResetError, setDemoResetError] = useState<string | null>(null);
  useEffect(() => window.gastronomy?.onWaiterOrderChanged?.((notice) => {
    if (notice) setWaiterNotice(notice);
    void waiterQueryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    void waiterQueryClient.invalidateQueries({ queryKey: ["delayed-waiter-batches"] });
  }), [waiterQueryClient]);
  useEnterNavigation();
  const bootstrap = useBootstrap();
  const license = useLicenseStatus();
  const appUpdate = useAppUpdateStatus();
  const location = useLocation();
  const currentLocationRef = useRef(location);
  currentLocationRef.current = location;
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("gastronomy.sidebar.collapsed") === "true",
  );
  const [navigationNotice, setNavigationNotice] = useState<string | null>(null);
  const [visitedSalon, setVisitedSalon] = useState(() =>
    location.pathname.startsWith("/salon"),
  );
  const [visitedOrders, setVisitedOrders] = useState(() =>
    location.pathname.startsWith("/pedidos"),
  );
  const contentRef = useRef<HTMLDivElement>(null);
  const routeHeadingRef = useRef<HTMLHeadingElement>(null);
  const dirtyFormsRef = useRef(new WeakSet<HTMLFormElement>());
  const navigationNoticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navigationNoticeTimerRef.current !== null)
        window.clearTimeout(navigationNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith("/salon")) setVisitedSalon(true);
    if (location.pathname.startsWith("/pedidos")) setVisitedOrders(true);
  }, [location.pathname]);


  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
    routeHeadingRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    const dirtyForms = dirtyFormsRef.current;
    let historyGuardArmed = false;
    let bypassNextPop = false;
    let armTimer: number | null = null;
    const isPreservedWorkspaceElement = (element: Element) =>
      element.closest('[data-preserved-workspace="true"]') !== null;
    const isInactiveWorkspaceElement = (element: Element) =>
      element.closest(
        '[data-preserved-workspace][data-workspace-active="false"]',
      ) !== null;
    const hasPendingFormChanges = (includePreserved = false) => {
      const dirtyMarker = [
        ...document.querySelectorAll('[data-navigation-dirty="true"]'),
      ].some(
        (element) => includePreserved || !isPreservedWorkspaceElement(element),
      );
      return (
        dirtyMarker ||
        [...document.forms].some(
          (form) =>
            dirtyForms.has(form) &&
            (includePreserved || !isPreservedWorkspaceElement(form)),
        )
      );
    };
    const hasCriticalOperation = () =>
      [...document.querySelectorAll('[role="dialog"][aria-busy="true"]')].some(
        (element) => !isInactiveWorkspaceElement(element),
      );
    const hasOpenModal = () =>
      [...document.querySelectorAll('[role="dialog"]')].some(
        (element) =>
          !isInactiveWorkspaceElement(element) &&
          element.closest("[hidden], [inert]") === null,
      );
    const showBlockedNotice = (message: string) => {
      if (navigationNoticeTimerRef.current !== null)
        window.clearTimeout(navigationNoticeTimerRef.current);
      setNavigationNotice(message);
      navigationNoticeTimerRef.current = window.setTimeout(() => {
        navigationNoticeTimerRef.current = null;
        setNavigationNotice(null);
      }, 6_000);
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
      if (hasOpenModal()) {
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
      // Settings tabs share one form. Replace its fragment rather than adding
      // entries behind the unsaved-changes history guard.
      if (destination.origin === window.location.origin &&
          currentLocationRef.current.pathname === "/configuracion" &&
          destination.hash.slice(1).split(/[?#]/)[0] === "/configuracion") {
        event.preventDefault();
        event.stopPropagation();
        navigate(destination.hash.slice(1), { replace: true });
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
      if (!hasPendingFormChanges(true) && !hasCriticalOperation()) return;
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
  const licenseNotice =
    license.data &&
    license.data.state !== "DEVELOPMENT" &&
    (license.data.state !== "ACTIVE" || license.data.verificationOverdue)
      ? license.data
      : null;

  if (bootstrap.isLoading) {
    return (
      <div className="grid h-full place-items-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
          <p className="mt-3 text-sm font-semibold text-slate-600">
            Cargando el programa…
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
          <p className="mt-2 text-sm text-slate-600">
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
    <div
      className={cn(
        "dn-app flex h-full min-h-0 text-slate-950 max-sm:[--app-navigation-width:56px]",
        collapsed
          ? "[--app-navigation-width:64px]"
          : "[--app-navigation-width:214px]",
      )}
    >
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
        data-app-navigation="true"
        className={cn(
          "dn-sidebar relative flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 max-sm:w-14",
          collapsed ? "w-16" : "w-[214px]",
        )}
      >
        <div className={cn("flex h-16 shrink-0 items-center border-b border-slate-100", collapsed ? "justify-center px-2" : "justify-center gap-2 px-3")}>
          <div
            role="img"
            aria-labelledby="gastronomy-brand-name"
            title="Delta Nube Gastronomía"
            className="flex min-w-0 items-center justify-center gap-2"
          >
            <span id="gastronomy-brand-name" className="sr-only"><span>Delta Nube</span> Gastronomía</span>
            <img
              src={brandSymbol}
              alt=""
              aria-hidden="true"
              className="h-10 w-10 shrink-0 object-contain"
            />
            {!collapsed ? (
              <img
                src={brandWordmark}
                alt=""
                aria-hidden="true"
                className="h-auto w-[126px] min-w-0 object-contain max-sm:hidden"
              />
            ) : null}
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              {!collapsed ? (
                <p className="mb-1.5 px-3 text-xs font-medium text-slate-500 max-sm:hidden">
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
                          "dn-nav-link mb-1 flex h-10 items-center gap-3 rounded-xl px-3 text-[13px] font-semibold transition max-sm:justify-center max-sm:px-0",
                          isActive
                            ? "bg-dn-primary-soft text-dn-primary"
                            : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
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
          type="button"
          aria-label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          aria-expanded={!collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            localStorage.setItem("gastronomy.sidebar.collapsed", String(next));
          }}
          className="m-2 flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 max-sm:hidden"
        >
          <List size={17} />
          {!collapsed ? "Contraer" : null}
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="dn-app-header flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 max-sm:px-3">
          <div>
            <h1
              ref={routeHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold tracking-tight text-slate-950 outline-none"
            >
              {current?.label ?? "Gastronomía"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isDemoMode ? (
              <button
                type="button"
                title="Borra los cambios de prueba y recupera los datos iniciales"
                onClick={() => void resetDemoAndReload(
                  async () => (await import("./demo/demo-api")).resetDemoData,
                  () => window.location.reload(),
                  () => setDemoResetError("No se pudieron restablecer los datos de demostración. No se recargó la aplicación."),
                )}
                className="hidden items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 md:flex"
              >
                <ArrowCounterClockwise size={15} weight="bold" />
                Modo demostración · Restablecer
              </button>
            ) : null}
            {demoResetError ? <span role="alert" className="text-xs font-semibold text-rose-700">{demoResetError}</span> : null}
            <div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 xl:flex">
              <Clock size={15} />
              <HeaderClock />
            </div>
            {bootstrap.data.cashSession ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
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
              <p className="text-xs text-slate-600">
                {bootstrap.data.currentUser.roleName}
              </p>
            </div>
          </div>
        </header>
        <OrderPrintStatus />
          {waiterNotice && <div role="alert" className="flex justify-between gap-2 bg-amber-100 px-4 py-2 text-sm"><span>{waiterNotice}</span><button onClick={() => setWaiterNotice("")}>Ocultar</button></div>}
        {licenseNotice ? (
          <div
            className={`flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2.5 text-xs ${licenseNotice.canOperate ? "border-amber-200 bg-amber-50 text-amber-950" : "border-rose-200 bg-rose-50 text-rose-950"}`}
            role="status"
          >
            <p className="min-w-0">
              <strong>
                {licenseNotice.state === "GRACE"
                  ? "Período de gracia."
                  : licenseNotice.state === "EXPIRED"
                    ? "Licencia vencida."
                    : "Revisá la licencia."}
              </strong>{" "}
              {licenseNotice.verificationOverdue && licenseNotice.canOperate
                ? "La verificación está demorada. El período abonado se conserva; verificá cuando vuelva la conexión."
                : licenseNotice.message}
              {!licenseNotice.canOperate
                ? " Podés consultar informes, exportar datos, hacer copias, restaurar y renovar. Las nuevas operaciones están deshabilitadas."
                : ""}
            </p>
            <NavLink
              to="/configuracion#settings-license"
              className="shrink-0 rounded-lg border border-current/20 bg-white/70 px-3 py-1.5 font-bold hover:bg-white"
            >
              Ver licencia
            </NavLink>
          </div>
        ) : null}
        {appUpdate.data?.state === "READY" ? (
          <div
            className="flex shrink-0 items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-5 py-2.5 text-xs text-sky-950"
            role="status"
            aria-live="polite"
          >
            <p className="min-w-0">
              <strong>Actualización lista.</strong>{" "}
              {appUpdate.data.availableVersion
                ? `La versión ${appUpdate.data.availableVersion} está lista para instalar.`
                : "Hay una nueva versión lista para instalar."}
            </p>
            <NavLink
              to="/configuracion#settings-updates"
              className="shrink-0 rounded-lg border border-sky-300 bg-white/80 px-3 py-1.5 font-bold hover:bg-white"
            >
              Ver actualización
            </NavLink>
          </div>
        ) : null}
        <div
          ref={contentRef}
          className="min-h-0 flex-1 overflow-auto p-4 lg:p-5"
        >
          <RouteErrorBoundary key={location.pathname}>
          <Suspense fallback={<div role="status" className="p-4 text-sm text-slate-500">Cargando sección…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/resumen" replace />} />
            <Route
              path="/resumen"
              element={<DashboardPage data={bootstrap.data} />}
            />
            <Route path="/salon" element={null} />
            <Route path="/pedidos" element={null} />
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
              path="/finanzas"
              element={
                bootstrap.data.currentUser.permissions.includes(
                  "finance.view",
                ) || bootstrap.data.currentUser.permissions.includes("*") ? (
                  <FinancePage data={bootstrap.data} />
                ) : (
                  <Navigate to="/resumen" replace />
                )
              }
            />
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
          </Suspense>
          </RouteErrorBoundary>
          {visitedSalon ? (
            <PreservedWorkspace active={location.pathname.startsWith("/salon")}>
              <RouteErrorBoundary>
              <Suspense fallback={<div role="status" className="p-4 text-sm text-slate-500">Cargando salón…</div>}>
              <TablesPage data={bootstrap.data} />
              </Suspense>
              </RouteErrorBoundary>
            </PreservedWorkspace>
          ) : null}
          {visitedOrders ? (
            <PreservedWorkspace
              active={location.pathname.startsWith("/pedidos")}
            >
              <RouteErrorBoundary>
              <Suspense fallback={<div role="status" className="p-4 text-sm text-slate-500">Cargando pedidos…</div>}>
              <OrdersPage data={bootstrap.data} />
              </Suspense>
              </RouteErrorBoundary>
            </PreservedWorkspace>
          ) : null}
        </div>
      </main>
    </div>
  );
}
