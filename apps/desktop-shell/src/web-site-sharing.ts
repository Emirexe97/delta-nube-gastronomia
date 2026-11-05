import { writeFile } from "node:fs/promises";
import { getMerchantShareUrl } from "@gastronomy/contracts/web-commerce";

export type WebSiteShareAction = "open" | "copy" | "qr";
type ShareStatus = { state: string; slug: string | null; url: string | null };
type Dependencies = {
  getStatus: () => ShareStatus | Promise<ShareStatus>;
  openExternal: (url: string) => Promise<void>;
  writeClipboard: (text: string) => void;
  showSaveDialog: () => Promise<{ canceled: boolean; filePath?: string }>;
  toBuffer: (url: string) => Promise<Buffer>;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
};

export function canonicalStorefrontUrl(status: ShareStatus): string {
  const url = getMerchantShareUrl(status);
  if (!url)
    throw new Error(
      "No hay una dirección válida de carta activa para compartir.",
    );
  return url;
}

export async function shareWebSite(
  action: WebSiteShareAction,
  deps: Dependencies,
): Promise<{ completed: boolean }> {
  if (!["open", "copy", "qr"].includes(action))
    throw new Error("Operación no válida.");
  const url = canonicalStorefrontUrl(await deps.getStatus());
  if (action === "open") {
    await deps.openExternal(url);
    return { completed: true };
  }
  if (action === "copy") {
    deps.writeClipboard(url);
    return { completed: true };
  }
  const choice = await deps.showSaveDialog();
  if (choice.canceled || !choice.filePath) return { completed: false };
  if (!choice.filePath.toLowerCase().endsWith(".png"))
    throw new Error("Elegí un archivo con extensión .png.");
  const png = await deps.toBuffer(url);
  if (
    png.length < 8 ||
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("No se pudo generar el código QR.");
  await (deps.writeFile ?? ((path, data) => writeFile(path, data)))(
    choice.filePath,
    png,
  );
  return { completed: true };
}
