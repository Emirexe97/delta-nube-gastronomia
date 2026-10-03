/** Quote a CSV field and neutralize spreadsheet formulas in untrusted text. */
export function csvCell(
  value: string | number | null | undefined,
  trustedNumericText = false,
): string {
  let text = String(value ?? "");
  const isSafeNumericText =
    trustedNumericText && /^-?(?:0|[1-9]\d*)\.\d{2}$/.test(text);
  if (
    !isSafeNumericText &&
    typeof value !== "number" &&
    /^[\s\u0000-\u001f]*[=+\-@]/.test(text)
  )
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
