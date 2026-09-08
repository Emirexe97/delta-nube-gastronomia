import * as React from "react";
import { createPortal } from "react-dom";
import clsx, { type ClassValue } from "clsx";

type ModalStackListener = () => void;

let modalStack: string[] = [];
const modalStackListeners = new Set<ModalStackListener>();
let bodyOverflowBeforeFirstModal: string | null = null;

function emitModalStackChange() {
  modalStackListeners.forEach((listener) => listener());
}

function registerModal(id: string) {
  if (modalStack.includes(id)) return;
  if (!modalStack.length && typeof document !== "undefined") {
    bodyOverflowBeforeFirstModal = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  modalStack = [...modalStack, id];
  emitModalStackChange();
}

function unregisterModal(id: string) {
  if (!modalStack.includes(id)) return;
  modalStack = modalStack.filter((candidate) => candidate !== id);
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

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const variants = {
    primary:
      "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-slate-300 disabled:text-white disabled:shadow-none",
    secondary:
      "border border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:bg-slate-50 hover:text-brand-700 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400",
    ghost:
      "bg-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-900 disabled:text-slate-300",
    danger:
      "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400",
  };
  return (
    <button
      className={cn(
        "inline-flex h-10 max-w-full min-w-0 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentPropsWithoutRef<"input">
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
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
      "h-10 w-full min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-700 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
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
      "min-h-24 w-full min-w-0 max-w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-[13px] font-medium text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
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
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        props.className,
      )}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "grid content-start gap-1.5 text-[12px] font-semibold text-slate-600",
        className,
      )}
    >
      <span>{label}</span>
      {children}
      {hint ? <span className="font-normal text-slate-400">{hint}</span> : null}
    </label>
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
        "inline-flex rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
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
  const dialogRef = React.useRef<HTMLElement>(null);
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
    if (!open) return;
    registerModal(modalId);
    return () => unregisterModal(modalId);
  }, [modalId, open]);
  React.useEffect(() => {
    if (!open) return;
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
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const frame = window.requestAnimationFrame(() => {
      if (!dialogRef.current?.contains(document.activeElement))
        dialogRef.current?.focus({ preventScroll: true });
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
        if (previousActive?.isConnected && !previousActive.closest("[inert]")) {
          previousActive.focus({ preventScroll: true });
          return;
        }
        const topDialog = document.querySelector<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        );
        const fallback = topDialog?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        (fallback ?? topDialog)?.focus({ preventScroll: true });
      });
    };
  }, [modalId, open]);
  const requestClose = () => {
    if (closeDisabled) return;
    if (confirmClose && !window.confirm(closeConfirmationMessage)) return;
    onClose();
  };
  if (!open) return null;
  return createPortal(
    <div
      ref={(node) => node?.toggleAttribute("inert", !topModal)}
      data-testid="modal-overlay"
      data-modal-depth={depth}
      aria-hidden={!topModal || undefined}
      style={{ zIndex: 100 + depth * 10 }}
      className="fixed inset-0 flex items-stretch justify-center overflow-hidden bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={topModal || undefined}
        aria-busy={closeDisabled || undefined}
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
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-wait disabled:opacity-40"
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
    document.body,
  );
}
