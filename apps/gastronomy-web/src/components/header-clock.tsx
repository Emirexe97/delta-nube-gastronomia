import { useEffect, useState } from "react";

export function HeaderClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return <span>{now.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })} · {now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>;
}
