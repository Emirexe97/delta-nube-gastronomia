import type { PrinterProfileDto } from "@gastronomy/contracts";

const ESC = 0x1b;
const GS = 0x1d;

// CP850 bytes 0x80 through 0xff, in byte order. ESC t 2 selects this page on
// common ESC/POS printers. Keep the table local so encoding needs no runtime
// codec dependency.
const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";
const CP850: Record<string, number> = Object.fromEntries(
  Array.from(CP850_HIGH, (character, index) => [character, index + 0x80]),
);

function printableByte(character: string): number {
  const code = character.codePointAt(0)!;
  if (code >= 0x20 && code <= 0x7e) return code;
  return CP850[character] ?? 0x3f;
}

function normalizeVisibleText(text: string): string {
  return (
    text
      .normalize("NFC")
      // Intl formatters may use NBSP or narrow NBSP as a grouping separator.
      .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
      .replace(/[“”„‟]/g, '"')
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/…/g, "...")
  );
}

function cleanLines(text: string): string[] {
  return normalizeVisibleText(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/\t/g, "  ")
        // Drop ESC and its operand together so command bytes cannot leave a
        // stray printable character in the note.
        .replace(/\u001b./g, "")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "")
        .replace(/ +/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
}

function wrapLine(line: string, width: number): string[] {
  const result: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    let split = remaining.lastIndexOf(" ", width);
    if (split <= 0) split = width;
    result.push(remaining.slice(0, split).trimEnd());
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) result.push(remaining);
  return result;
}

/** Encode visible ticket text as safe, plain-text ESC/POS bytes. */
export function encodeEscPosTicket(
  text: string,
  profile: PrinterProfileDto,
): Buffer {
  const maxWidth = profile.paperWidth === "58mm" ? 32 : 48;
  const requestedWidth = Number.isFinite(profile.charsPerLine)
    ? Math.floor(profile.charsPerLine)
    : maxWidth;
  const width = Math.max(20, Math.min(maxWidth, requestedWidth));
  const copies = Math.max(
    1,
    Math.min(3, Math.floor(Number(profile.copies) || 1)),
  );
  const feed = Math.max(
    0,
    Math.min(8, Math.floor(Number(profile.feedLinesBeforeCut) || 0)),
  );
  const lines = cleanLines(text).flatMap((line) => wrapLine(line, width));
  const output: number[] = [ESC, 0x40, ESC, 0x74, 2]; // Initialize; select PC850.

  for (let copy = 0; copy < copies; copy += 1) {
    for (const line of lines) {
      for (const character of line) output.push(printableByte(character));
      output.push(0x0a);
    }
    if (profile.cutter) {
      for (let line = 0; line < feed; line += 1) output.push(0x0a);
      // GS V 0 = full cut; GS V 1 = partial cut (manual confirm).
      output.push(GS, 0x56, profile.cutMode === "FULL" ? 0 : 1);
    } else if (copy < copies - 1) {
      // Keep successive tickets distinct when the printer has no cutter.
      output.push(0x0a);
    }
  }
  return Buffer.from(output);
}
