import { useEffect, useState } from "react";

export const AUTOCOMPLETE_DELAY_MS = 1_000;

export function useDebouncedValue<T>(
  value: T,
  delay = AUTOCOMPLETE_DELAY_MS,
) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}
