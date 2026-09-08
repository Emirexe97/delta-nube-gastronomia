export const PRODUCT_IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_OUTPUT_BYTES = 1.5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_DIMENSION = 1280;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateProductImageFile(file: Pick<File, "type" | "size">) {
  if (!ALLOWED_TYPES.has(file.type.toLowerCase()))
    throw new Error("El formato debe ser JPG, PNG o WebP.");
  if (file.size > PRODUCT_IMAGE_MAX_INPUT_BYTES)
    throw new Error("La imagen no puede superar los 10 MiB.");
}

export function productImageDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("La imagen tiene dimensiones inválidas.");
  const scale = Math.min(
    1,
    PRODUCT_IMAGE_MAX_DIMENSION / width,
    PRODUCT_IMAGE_MAX_DIMENSION / height,
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function convertProductImageToWebp(file: File) {
  validateProductImageFile(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("No se pudo leer la imagen.");
  });
  try {
    const dimensions = productImageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen.");
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("No se pudo convertir la imagen.")),
        "image/webp",
        0.82,
      ),
    );
    if (blob.type !== "image/webp")
      throw new Error("El navegador no pudo generar WebP.");
    if (blob.size > PRODUCT_IMAGE_MAX_OUTPUT_BYTES)
      throw new Error("La imagen convertida no puede superar 1,5 MiB.");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () =>
        reject(new Error("No se pudo leer la imagen convertida."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    return { dataUrl, ...dimensions, size: blob.size };
  } finally {
    bitmap.close();
  }
}
