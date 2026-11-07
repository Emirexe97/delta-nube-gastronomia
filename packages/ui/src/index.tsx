import * as React from "react";
import { createPortal } from "react-dom";
import clsx, { type ClassValue } from "clsx";

type ModalStackListener = () => void;

let modalStack: string[] = [];
let nextModalOrder = 0;
const modalOrders = new Map<string, number>();
const modalStackListeners = new Set<ModalStackListener>();
let bodyOverflowBeforeFirstModal: string | null = null;

function emitModalStackChange() {
  modalStackListeners.forEach((listener) => listener());
}

function registerModal(id: string, order: number) {
  if (modalStack.includes(id)) return;
  if (!modalStack.length && typeof document !== "undefined") {
    bodyOverflowBeforeFirstModal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  modalOrders.set(id, order);
  modalStack = [...modalStack, id].sort(
    (left, right) => modalOrders.get(left)! - modalOrders.get(right)!,
  );
  emitModalStackChange();
}

function unregisterModal(id: string) {
  if (!modalStack.includes(id)) return;
  modalStack = modalStack.filter((candidate) => candidate !== id);
  modalOrders.delete(id);
  if (!modalStack.length && typeof document !== "undefined") {
    document.body.style.overflow = bodyOverflowBeforeFirstModal ?? "";
    bodyOverflowBeforeFirstModal = null;
  }
  emitModalStackChange();
}

function subscribeModalStack(listener: ModalStackListener) {
  modalStackListeners.add(listener);
  return () => {
    modalStackListeners.delete(listener);
  };
}

function getModalStackSnapshot() {
  return modalStack;
}

function isTopModal(id: string) {
  return modalStack.at(-1) === id;
}

export function cn(...values: ClassValue[]) {
  return clsx(values);
}

const WorkspaceContext = React.createContext<{
  active: boolean;
  portalRoot: HTMLDivElement | null;
} | null>(null);

export function useWorkspaceActive() {
  return React.useContext(WorkspaceContext)?.active ?? true;
}

/** Keep both the page and its portalled dialogs alive while another section is active. */
export function PreservedWorkspace({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  const [portalRoot, setPortalRoot] = React.useState<HTMLDivElement | null>(
    null,
  );
  const context = React.useMemo(
    () => ({ active, portalRoot }),
    [active, portalRoot],
  );
  return (
    <WorkspaceContext.Provider value={context}>
      <div
        hidden={!active}
        aria-hidden={!active || undefined}
        ref={(node) => node?.toggleAttribute("inert", !active)}
        data-preserved-workspace="true"
        data-workspace-active={String(active)}
      >
        {children}
        <div ref={setPortalRoot} />
      </div>
    </WorkspaceContext.Provider>
  );
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
  }
>(({ variant = "primary", className, ...props }, ref) => {
  const variants = {
    primary:
      "bg-dn-primary text-white shadow-sm hover:bg-dn-primary-hover disabled:bg-slate-300 disabled:text-white disabled:shadow-none",
    secondary:
      "border border-dn-border bg-dn-surface text-dn-body hover:border-brand-200 hover:bg-dn-surface-2 hover:text-dn-primary disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400",
    ghost:
      "bg-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:text-slate-300",
    danger:
      "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400",
  };
  return (
    <button
      ref={ref}
      className={cn(
        "dn-button inline-flex h-10 max-w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--dn-radius-control)] px-3 text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed shrink-0",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
Button.displayName = "Button";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "dn-input h-10 w-full min-w-0 max-w-full rounded-[var(--dn-radius-control)] border border-dn-border bg-dn-surface px-3 text-[13px] font-medium text-dn-body outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentPropsWithoutRef<"select">
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "dn-input h-10 w-full min-w-0 max-w-full rounded-[var(--dn-radius-control)] border border-dn-border bg-dn-surface px-3 text-[13px] font-medium text-dn-body outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
      className,
    )}
    {...props}
  />
));
Select.displayName = "Select";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "dn-input min-h-24 w-full min-w-0 max-w-full resize-y rounded-[var(--dn-radius-control)] border border-dn-border bg-dn-surface px-3 py-3 text-[13px] font-medium text-dn-body outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Card(props: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "dn-card rounded-[var(--dn-radius-card)] border border-dn-border bg-dn-surface",
        props.className,
      )}
    />
  );
}

/** Compact, keyboard/touch-accessible contextual help, rendered outside clipped containers. */
export function HelpTip({
  children,
  label = "Más información",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const id = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<React.CSSProperties>({});
  const pinned = React.useRef(false);
  const hovered = React.useRef(false);
  const focused = React.useRef(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceActive = useWorkspaceActive();
  const updatePosition = React.useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 24);
    const left = Math.max(
      12,
      Math.min(rect.left, window.innerWidth - width - 12),
    );
    // Position above when the lower edge would leave too little room.
    const estimatedHeight = panelRef.current?.offsetHeight ?? 80;
    const top =
      rect.bottom + estimatedHeight + 12 > window.innerHeight
        ? Math.max(12, rect.top - estimatedHeight - 8)
        : rect.bottom + 8;
    setPosition({
      position: "fixed",
      zIndex: 10000,
      top,
      left,
      width,
      maxHeight: "calc(100dvh - 24px)",
      overflowY: "auto",
    });
  }, []);
  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        pinned.current = false;
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      ) {
        pinned.current = false;
        setOpen(false);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pinned.current = false;
        setOpen(false);
      }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [open, updatePosition]);
  React.useEffect(() => {
    if (workspaceActive && document.visibilityState !== "hidden") return;
    pinned.current = false;
    hovered.current = false;
    focused.current = false;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(false);
  }, [workspaceActive]);
  React.useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  const closeIfIdle = () => {
    if (!pinned.current && !hovered.current && !focused.current) {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setOpen(false), 120);
    }
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dn-help-trigger inline-grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold text-slate-500 transition-colors hover:bg-orange-50 hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => {
          cancelClose();
          hovered.current = true;
          setOpen(true);
        }}
        onMouseLeave={() => {
          hovered.current = false;
          closeIfIdle();
        }}
        onFocus={() => {
          cancelClose();
          focused.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          focused.current = false;
          closeIfIdle();
        }}
        onClick={() => {
          pinned.current = !pinned.current;
          setOpen(pinned.current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ")
            event.stopPropagation();
        }}
      >
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <circle cx="10" cy="10" r="8" />
          <path d="M10 9v5" strokeLinecap="round" />
          <circle cx="10" cy="6" r=".8" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="tooltip"
              style={position}
              className="rounded-xl border border-dn-border bg-dn-surface px-3 py-2 text-xs font-normal leading-5 text-dn-body shadow-lg"
              onMouseEnter={() => {
                cancelClose();
                hovered.current = true;
              }}
              onMouseLeave={() => {
                hovered.current = false;
                closeIfIdle();
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function Field({
  label,
  hint,
  hintMode = "help",
  children,
  className,
}: {
  label: string;
  hint?: string;
  hintMode?: "help" | "inline";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div data-has-help={Boolean(hint?.trim() && hintMode === "help")} className={cn("dn-field relative grid content-start gap-1.5", className)}>
      <label className="grid content-start gap-1.5 text-[12px] font-semibold text-slate-600">
        <span className={cn("dn-field-caption", hint?.trim() && hintMode === "help" && "pr-7")}>
          {label}
        </span>
        {children}
      </label>
      {hint?.trim() && hintMode === "inline" ? (
        <span className="text-[12px] font-normal text-slate-600" role="status">
          {hint}
        </span>
      ) : null}
      {hint?.trim() && hintMode === "help" ? (
        <span className="dn-field-help absolute right-0 top-0 inline-grid h-6 w-6 place-items-center">
          <HelpTip label={`Ayuda: ${label}`}>{hint}</HelpTip>
        </span>
      ) : null}
    </div>
  );
}

export function Badge({
  tone = "slate",
  children,
}: {
  tone?: "slate" | "violet" | "orange" | "green" | "amber" | "rose" | "blue";
  children: React.ReactNode;
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    violet: "bg-brand-100 text-brand-700",
    orange: "bg-orange-100 text-orange-800",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    blue: "bg-sky-100 text-sky-700",
  };
  return (
    <span
      className={cn(
        "dn-badge inline-flex items-center whitespace-nowrap shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  width = "max-w-lg",
  closeDisabled = false,
  confirmClose = false,
  closeConfirmationMessage = "Hay cambios sin guardar. ¿Querés cerrar igualmente?",
}: {
  open: boolean;
  title: string;
  description?: string;
  children: React.ReactNode;
  onClose(): void;
  width?: string;
  closeDisabled?: boolean;
  confirmClose?: boolean;
  closeConfirmationMessage?: string;
}) {
  const workspace = React.useContext(WorkspaceContext);
  const enabled =
    open &&
    (workspace?.active ?? true) &&
    (!workspace || workspace.portalRoot !== null);
  const dialogRef = React.useRef<HTMLElement>(null);
  const lastFocusedRef = React.useRef<HTMLElement | null>(null);
  const wasOpen = React.useRef(false);
  const openingOrder = React.useRef(0);
  if (open && !wasOpen.current) openingOrder.current = ++nextModalOrder;
  wasOpen.current = open;
  const onCloseRef = React.useRef(onClose);
  const closeDisabledRef = React.useRef(closeDisabled);
  const confirmCloseRef = React.useRef(confirmClose);
  const confirmationMessageRef = React.useRef(closeConfirmationMessage);
  const modalId = React.useId();
  const titleId = React.useId();
  const descriptionId = React.useId();
  const stack = React.useSyncExternalStore(
    subscribeModalStack,
    getModalStackSnapshot,
    getModalStackSnapshot,
  );
  const depth = Math.max(0, stack.indexOf(modalId));
  const topModal = stack.at(-1) === modalId;
  React.useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
    confirmCloseRef.current = confirmClose;
    confirmationMessageRef.current = closeConfirmationMessage;
  }, [closeConfirmationMessage, closeDisabled, confirmClose, onClose]);
  React.useEffect(() => {
    if (!enabled) return;
    registerModal(modalId, openingOrder.current);
    return () => unregisterModal(modalId);
  }, [modalId, enabled]);
  React.useEffect(() => {
    if (!enabled) return;
    const previousActive =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const requestClose = () => {
      if (closeDisabledRef.current) return;
      if (
        confirmCloseRef.current &&
        !window.confirm(confirmationMessageRef.current)
      )
        return;
      onCloseRef.current();
    };
    const handler = (event: KeyboardEvent) => {
      if (!isTopModal(modalId)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const navigationControls = workspace
        ? [
            ...document.querySelectorAll<HTMLElement>(
              "[data-app-navigation] a[href], [data-app-navigation] button:not([disabled])",
            ),
          ]
        : [];
      const focusable = [
        ...navigationControls,
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        (element) =>
          !element.closest("[hidden], [inert]") &&
          element.getClientRects().length > 0,
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (workspace) {
        event.preventDefault();
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const next =
          index < 0
            ? event.shiftKey
              ? focusable.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + focusable.length) %
              focusable.length;
        focusable[next]?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const frame = window.requestAnimationFrame(() => {
      if (
        !isTopModal(modalId) ||
        dialogRef.current?.contains(document.activeElement)
      )
        return;
      const lastFocused = lastFocusedRef.current;
      if (
        lastFocused?.isConnected &&
        !lastFocused.closest("[hidden], [inert]") &&
        lastFocused.getClientRects().length > 0
      )
        lastFocused.focus({ preventScroll: true });
      else dialogRef.current?.focus({ preventScroll: true });
    });
    window.addEventListener("keydown", handler);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handler);
      const closingDialog = dialogRef.current;
      window.requestAnimationFrame(() => {
        const active =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const needsRestoration =
          !active ||
          active === document.body ||
          !active.isConnected ||
          Boolean(closingDialog?.contains(active));
        // No robes el foco si la persona o una automatización ya avanzó al
        // siguiente control durante el frame de desmontaje del modal.
        if (!needsRestoration) return;
        if (
          previousActive?.isConnected &&
          !previousActive.closest("[hidden], [inert]") &&
          previousActive.getClientRects().length > 0
        ) {
          previousActive.focus({ preventScroll: true });
          return;
        }
        const topDialog = document.querySelector<HTMLElement>(
          '[role="dialog"][data-top-dialog="true"]',
        );
        const fallback = topDialog?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        (fallback ?? topDialog)?.focus({ preventScroll: true });
      });
    };
  }, [modalId, enabled, Boolean(workspace)]);
  const requestClose = () => {
    if (closeDisabled) return;
    if (confirmClose && !window.confirm(closeConfirmationMessage)) return;
    onClose();
  };
  if (!open || (workspace && !workspace.portalRoot)) return null;
  return createPortal(
    <div
      ref={(node) => node?.toggleAttribute("inert", !enabled || !topModal)}
      data-testid="modal-overlay"
      data-modal-depth={depth}
      aria-hidden={!enabled || !topModal || undefined}
      style={{
        zIndex: 100 + depth * 10,
        ...(workspace ? { left: "var(--app-navigation-width, 0px)" } : {}),
      }}
      className="fixed inset-0 flex items-stretch justify-center overflow-hidden bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={(enabled && topModal && !workspace) || undefined}
        data-workspace-dialog={workspace ? "true" : undefined}
        data-top-dialog={enabled && topModal ? "true" : undefined}
        aria-busy={closeDisabled || undefined}
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLElement)
            lastFocusedRef.current = event.target;
        }}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          "flex h-full max-h-full w-full flex-col overflow-hidden rounded-none border border-slate-200 bg-white shadow-2xl outline-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl",
          width,
        )}
      >
        <header className="z-10 shrink-0 border-b border-slate-100 bg-white px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="truncate text-base font-bold text-slate-950"
              >
                {title}
              </h2>
              {description ? (
                <p
                  id={descriptionId}
                  className="mt-0.5 text-[12px] leading-5 text-slate-500"
                >
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={closeDisabled}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xl leading-none text-slate-600 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-wait disabled:opacity-40"
              aria-label={closeDisabled ? "Operación en curso" : "Cerrar"}
              title={
                closeDisabled ? "Esperá a que termine la operación" : undefined
              }
            >
              ×
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [scrollbar-gutter:stable] sm:p-5">
          {children}
        </div>
      </section>
    </div>,
    workspace?.portalRoot ?? document.body,
  );
}
