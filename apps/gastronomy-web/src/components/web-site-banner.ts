const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 320 * 1024;
const MAX_SOURCE_EDGE = 12_000;
const MAX_SOURCE_PIXELS = 40_000_000;
const OUTPUT_WIDTH = 1440;
const OUTPUT_HEIGHT = 576;
export type SiteImageKind = "banner" | "logo" | "product";

export function fileFromImageDataUrl(dataUrl: string, name: string): File {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z\d+/]+=*)$/i.exec(
    dataUrl,
  );
  if (!match || match[2]!.length > 11_184_812) {
    throw new Error("No se pudo leer la imagen guardada en el POS.");
  }
  let binary: string;
  try {
    binary = atob(match[2]!);
  } catch {
    throw new Error("No se pudo leer la imagen guardada en el POS.");
  }
  if (binary.length > MAX_INPUT_BYTES) {
    throw new Error("La foto guardada en el POS supera el límite de 8 MB.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: match[1]!.toLowerCase() });
}

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

async function preflight(file: File) {
  const header = new Uint8Array(
    await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer(),
  );
  const byte = (index: number) => header[index] ?? 0;
  let width = 0,
    height = 0,
    valid = false;
  if (file.type === "image/png") {
    valid =
      header.length >= 24 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v) &&
      String.fromCharCode(...header.slice(12, 16)) === "IHDR";
    if (valid) {
      const view = new DataView(header.buffer);
      width = view.getUint32(16);
      height = view.getUint32(20);
    }
  } else if (file.type === "image/webp") {
    valid =
      header.length >= 30 &&
      String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...header.slice(8, 12)) === "WEBP";
    const chunk = String.fromCharCode(...header.slice(12, 16));
    if (valid && chunk === "VP8X") {
      width = 1 + byte(24) + (byte(25) << 8) + (byte(26) << 16);
      height = 1 + byte(27) + (byte(28) << 8) + (byte(29) << 16);
    } else if (
      valid &&
      chunk === "VP8 " &&
      byte(23) === 0x9d &&
      byte(24) === 0x01 &&
      byte(25) === 0x2a
    ) {
      width = (byte(26) | (byte(27) << 8)) & 0x3fff;
      height = (byte(28) | (byte(29) << 8)) & 0x3fff;
    } else if (valid && chunk === "VP8L" && byte(20) === 0x2f) {
      width = 1 + (byte(21) | ((byte(22) & 63) << 8));
      height =
        1 + ((byte(22) >> 6) | (byte(23) << 2) | ((byte(24) & 15) << 10));
    }
  } else {
    valid = byte(0) === 0xff && byte(1) === 0xd8;
    for (let i = 2; valid && i + 8 < header.length;) {
      if (byte(i) !== 0xff) {
        i++;
        continue;
      }
      const marker = byte(i + 1);
      if (marker === 0xd9 || marker === 0xda) break;
      const length = (byte(i + 2) << 8) | byte(i + 3);
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = (byte(i + 5) << 8) | byte(i + 6);
        width = (byte(i + 7) << 8) | byte(i + 8);
        break;
      }
      if (length < 2) break;
      i += 2 + length;
    }
  }
  if (!valid || !width || !height)
    throw new Error(
      "No se pudo verificar el formato y las dimensiones. Probá guardando la foto como JPG o PNG.",
    );
  if (
    width > MAX_SOURCE_EDGE ||
    height > MAX_SOURCE_EDGE ||
    width * height > MAX_SOURCE_PIXELS
  ) {
    throw new Error("La imagen tiene dimensiones demasiado grandes.");
  }
}

export async function normalizeSiteImage(
  file: File,
  kind: SiteImageKind,
): Promise<string> {
  if (!allowedTypes.has(file.type)) {
    throw new Error("Elegí una imagen JPG, PNG o WebP.");
  }
  if (file.size <= 0 || file.size > MAX_INPUT_BYTES) {
    throw new Error("La imagen debe pesar menos de 8 MB.");
  }
  await preflight(file);

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la imagen. Probá con otro archivo.");
  }
  try {
    const { width, height } = image;
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_SOURCE_EDGE ||
      height > MAX_SOURCE_EDGE ||
      width * height > MAX_SOURCE_PIXELS
    ) {
      throw new Error("La imagen tiene dimensiones demasiado grandes.");
    }

    const config =
      kind === "banner"
        ? {
            width: OUTPUT_WIDTH,
            height: OUTPUT_HEIGHT,
            limit: 320 * 1024,
            contain: false,
          }
        : kind === "logo"
          ? { width: 384, height: 384, limit: 96 * 1024, contain: true }
          : { width: 800, height: 600, limit: 160 * 1024, contain: false };
    // Photos are centered-cropped to the target ratio. Logos are contained on white.
    const ratio = config.width / config.height;
    const sourceRatio = width / height;
    let sx = 0,
      sy = 0,
      sw = width,
      sh = height,
      dx = 0,
      dy = 0,
      dw = 0,
      dh = 0;
    if (kind === "logo") {
      const scale = Math.min(
        (0.84 * config.width) / width,
        (0.84 * config.height) / height,
      );
      dw = width * scale;
      dh = height * scale;
      dx = (config.width - dw) / 2;
      dy = (config.height - dh) / 2;
    } else if (sourceRatio > ratio) {
      sw = height * ratio;
      sx = (width - sw) / 2;
    } else {
      sh = width / ratio;
      sy = (height - sh) / 2;
    }
    const scale =
      kind === "logo" ? 1 : Math.min(1, config.width / sw, config.height / sh);
    const targetW =
      kind === "logo" ? config.width : Math.max(1, Math.round(sw * scale));
    const targetH =
      kind === "logo" ? config.height : Math.max(1, Math.round(sh * scale));
    if (kind !== "logo") {
      dw = targetW;
      dh = targetH;
    }
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("No se pudo preparar la imagen.");
    context.fillStyle = kind === "logo" ? "#ffffff" : "#f8f4eb";
    context.fillRect(0, 0, targetW, targetH);
    context.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);

    const qualityLevels = [0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36];
    for (const quality of qualityLevels) {
      const result = canvas.toDataURL("image/jpeg", quality);
      if (!result.startsWith("data:image/jpeg;base64,"))
        throw new Error("No se pudo preparar la portada en formato JPG.");
      const encodedLength = result.length - result.indexOf(",") - 1;
      const padding = result.endsWith("==") ? 2 : result.endsWith("=") ? 1 : 0;
      if (encodedLength > 0 && encodedLength * 0.75 - padding <= config.limit)
        return result;
    }
    throw new Error("La imagen no se pudo reducir lo suficiente. Elegí otra.");
  } finally {
    image.close();
  }
}

export function normalizeSiteBanner(file: File): Promise<string> {
  return normalizeSiteImage(file, "banner");
}
