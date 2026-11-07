import { useEffect, useMemo, useRef, useState } from "react";
import type { BootstrapDto } from "@gastronomy/contracts";
import { ChatCircleDots, MagnifyingGlass, X } from "@phosphor-icons/react";
import {
  answerPosQuestion,
  canAskPosQuestion,
  POS_ASSISTANT_QUESTIONS,
  type PosAssistantAnswer,
} from "../pos-assistant";
import "./pos-assistant-menu.css";

type Props = { data: BootstrapDto };
const sourceLabels: Record<PosAssistantAnswer["source"], string> = {
  local: "Respuesta local",
  dashboard: "Datos del panel",
  report: "Informe",
  guide: "Guía del POS",
  permission: "Permisos",
  not_found: "Sin coincidencias",
};
const normalize = (value: string) =>
  value
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Compact, offline-first help menu for the POS top bar. */
export function PosAssistantMenu({ data }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [answer, setAnswer] = useState<PosAssistantAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiFormOpen, setAiFormOpen] = useState(false);
  const [staffNumber, setStaffNumber] = useState("");
  const [pin, setPin] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const [quota, setQuota] = useState<{ user: number; merchant: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const aiRequestId = useRef(0);
  const aiBusyRef = useRef(false);
  const permissions = data.currentUser.permissions;
  const questions = useMemo(
    () =>
      POS_ASSISTANT_QUESTIONS.filter((item) =>
        canAskPosQuestion(permissions, item),
      ),
    [permissions],
  );
  const matches = useMemo(() => {
    const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
    return questions.filter((item) => {
      const text = normalize(`${item.question} ${item.category}`);
      return terms.every((term) => text.includes(term));
    });
  }, [query, questions]);

  function close(restoreFocus = true) {
    requestId.current += 1;
    aiRequestId.current += 1;
    setOpen(false);
    setQuery("");
    setSelected("");
    setAnswer(null);
    setBusy(false);
    setAiBusy(aiBusyRef.current);
    setAiFormOpen(false);
    setStaffNumber("");
    setPin("");
    setAiMessage("");
    setQuota(null);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      )
        close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  async function ask(item: (typeof POS_ASSISTANT_QUESTIONS)[number]) {
    aiRequestId.current += 1;
    if (!aiBusyRef.current) {
      setAiBusy(false);
      setAiMessage("");
    }
    setAiFormOpen(false);
    setPin("");
    setStaffNumber("");
    setQuota(null);
    const currentRequest = ++requestId.current;
    setSelected(item.question);
    setAnswer(null);
    setBusy(true);
    bodyRef.current?.scrollTo({ top: 0 });
    try {
      const result = await answerPosQuestion(item.id, {
        data,
        getDetailedReport: (filters) =>
          window.gastronomy.getDetailedReport(filters),
        getCashSessionReport: (filters) =>
          window.gastronomy.getCashSessionReport(filters),
      });
      if (requestId.current === currentRequest) setAnswer(result);
    } catch {
      if (requestId.current === currentRequest) {
        setAnswer({
          answer:
            "No pude resolver la consulta ahora. Probá nuevamente en un momento.",
          questionId: item.id,
          source: "not_found",
        });
      }
    } finally {
      if (requestId.current === currentRequest) setBusy(false);
    }
  }

  async function askAi() {
    const text = query.trim() || selected;
    const parsedStaffNumber = Number(staffNumber);
    if (
      !text ||
      aiBusyRef.current ||
      !Number.isSafeInteger(parsedStaffNumber) ||
      parsedStaffNumber < 1 ||
      !/^\d{4,8}$/.test(pin)
    )
      return;
    aiBusyRef.current = true;
    const thisRequest = ++aiRequestId.current;
    requestId.current += 1;
    setAiBusy(true);
    setAiMessage("Consultando…");
    setSelected("");
    setAnswer(null);
    const submittedPin = pin;
    setPin("");
    if (!navigator.onLine) {
      setAiBusy(false);
      aiBusyRef.current = false;
      setAiMessage(
        "La consulta con IA requiere conexión. Las preguntas frecuentes siguen disponibles sin conexión.",
      );
      return;
    }
    try {
      const response = await window.gastronomy.askPosAssistantAi({
        text,
        requestId: crypto.randomUUID(),
        staffNumber: parsedStaffNumber,
        pin: submittedPin,
      });
      if (aiRequestId.current !== thisRequest) return;
      if (response.remaining) setQuota(response.remaining);
      if (!response.ok) {
        const messages: Record<typeof response.code, string> = {
          unavailable: "La consulta con IA no está disponible ahora.",
          unauthorized:
            "No se pudo verificar el número de personal y PIN o falta permiso para consultar con IA.",
          user_daily_limit: "Alcanzaste tu cupo diario de consultas con IA.",
          merchant_daily_limit: "Se alcanzó el cupo diario de IA del comercio.",
          cooldown: `Esperá ${Math.max(1, response.retryAfter ?? 1)} segundos antes de volver a consultar.`,
          invalid:
            "La consulta no pudo procesarse. Probá con una pregunta más concreta.",
          duplicate: "Esta consulta ya se está procesando. Esperá un momento.",
        };
        setAiMessage(messages[response.code]);
        return;
      }
      if (!response.questionId) {
        setAiMessage(
          "La IA no encontró una pregunta del catálogo que corresponda. Probá con otra consulta.",
        );
        return;
      }
      const item = POS_ASSISTANT_QUESTIONS.find(
        (question) => question.id === response.questionId,
      );
      if (!item || !canAskPosQuestion(permissions, item)) {
        setAiMessage("La sugerencia no está disponible para tu usuario.");
        return;
      }
      setSelected(item.question);
      setBusy(true);
      setAiMessage(
        "La IA encontró una pregunta frecuente. Consultando los datos autorizados del POS…",
      );
      const result = await answerPosQuestion(item.id, {
        data,
        getDetailedReport: (filters) =>
          window.gastronomy.getDetailedReport(filters),
        getCashSessionReport: (filters) =>
          window.gastronomy.getCashSessionReport(filters),
      });
      if (aiRequestId.current !== thisRequest) return;
      setAnswer(result);
      setAiMessage(
        "La respuesta se obtuvo del catálogo local del POS; no se mostró texto generado por IA.",
      );
    } catch {
      if (aiRequestId.current === thisRequest) {
        setAiMessage(
          "No se pudo completar la consulta con IA. Tus preguntas frecuentes siguen disponibles.",
        );
      }
    } finally {
      aiBusyRef.current = false;
      setAiBusy(false);
      if (aiRequestId.current !== thisRequest) setAiMessage("");
      if (aiRequestId.current === thisRequest) {
        setBusy(false);
      }
    }
  }

  return (
    <div
      className="pos-assistant"
      ref={rootRef}
      onBlur={(event) => {
        if (
          open &&
          (!(event.relatedTarget instanceof Node) ||
            !rootRef.current?.contains(event.relatedTarget))
        )
          close(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="pos-assistant__trigger"
        aria-label="Preguntale al POS"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="pos-assistant-panel"
        aria-describedby="pos-assistant-tooltip"
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <ChatCircleDots size={19} weight="duotone" aria-hidden="true" />
        <span className="pos-assistant__trigger-label">Preguntale al POS</span>
        <span
          id="pos-assistant-tooltip"
          className="pos-assistant__tooltip"
          role="tooltip"
        >
          Consultá cómo resolver tareas del POS
        </span>
      </button>
      {open && (
        <section
          id="pos-assistant-panel"
          className="pos-assistant__panel"
          role="dialog"
          aria-label="Asistente del POS"
        >
          <header className="pos-assistant__header">
            <div>
              <strong>Preguntale al POS</strong>
              <span>Ayuda disponible sin conexión</span>
            </div>
            <button
              type="button"
              className="pos-assistant__close"
              aria-label="Cerrar asistente"
              onClick={() => close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <label className="pos-assistant__search">
            <MagnifyingGlass size={18} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              role="searchbox"
              value={query}
              maxLength={500}
              onChange={(event) => {
                requestId.current += 1;
                aiRequestId.current += 1;
                setQuery(event.target.value);
                setSelected("");
                setAnswer(null);
                setBusy(false);
                setAiBusy(aiBusyRef.current);
                setAiFormOpen(false);
                setStaffNumber("");
                setPin("");
                setAiMessage("");
                setQuota(null);
              }}
              placeholder="¿Qué necesitás resolver?"
              aria-label="Buscar una pregunta"
            />
          </label>
          <div className="pos-assistant__ai-action">
            <button
              type="button"
              onClick={() => {
                if (aiFormOpen) {
                  setPin("");
                  setStaffNumber("");
                }
                setAiFormOpen(!aiFormOpen);
              }}
              disabled={aiBusy || !(query.trim() || selected)}
            >
              Consultar con IA
            </button>
            <p className="pos-assistant__ai-note">
              Las preguntas frecuentes no consumen cupo. Para IA, identificáte
              con tu número de personal y PIN.
            </p>
            {aiFormOpen && (
              <div className="pos-assistant__identity">
                <label>
                  Número de personal
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={12}
                    value={staffNumber}
                    onChange={(event) => {
                      setStaffNumber(event.target.value.replace(/\D/g, ""));
                      setQuota(null);
                    }}
                  />
                </label>
                <label>
                  PIN
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={8}
                    value={pin}
                    onChange={(event) =>
                      setPin(event.target.value.replace(/\D/g, ""))
                    }
                  />
                </label>
                <p>
                  La identificación se verifica localmente; a Google se envía
                  únicamente la pregunta. El PIN no se guarda.
                </p>
                <button
                  type="button"
                  onClick={() => void askAi()}
                  disabled={
                    aiBusy ||
                    !Number.isSafeInteger(Number(staffNumber)) ||
                    Number(staffNumber) < 1 ||
                    !/^\d{4,8}$/.test(pin)
                  }
                >
                  {aiBusy ? "Consultando…" : "Enviar consulta"}
                </button>
              </div>
            )}
            {aiMessage && (
              <p className="pos-assistant__ai-status" role="status">
                {aiMessage}
              </p>
            )}
            {quota && (
              <p className="pos-assistant__quota" aria-live="polite">
                Cupo restante · usuario: {quota.user} · comercio:{" "}
                {quota.merchant}
              </p>
            )}
          </div>
          <div className="pos-assistant__body" ref={bodyRef}>
            {selected && (
              <div className="pos-assistant__answer-block" aria-live="polite">
                <p className="pos-assistant__question">{selected}</p>
                {busy ? (
                  <p className="pos-assistant__answer" role="status">
                    Buscando una respuesta…
                  </p>
                ) : (
                  answer && (
                    <div className="pos-assistant__answer" role="status">
                      <span className="pos-assistant__source">
                        {sourceLabels[answer.source]}
                      </span>
                      <p>{answer.answer}</p>
                    </div>
                  )
                )}
              </div>
            )}
            <p className="pos-assistant__caption">
              {query ? "Resultados" : "Preguntas frecuentes"}
            </p>
            {matches.length > 0 ? (
              <ul className="pos-assistant__questions">
                {matches.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => void ask(item)}>
                      {item.question}
                      <span aria-hidden="true">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pos-assistant__empty">
                No encontramos coincidencias. Probá con “caja”, “pedido” o
                “ventas”.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
