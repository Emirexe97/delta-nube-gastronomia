import jsQR from "jsqr";
import { PNG } from "pngjs";

/** Decode a saved PNG QR code independently of the qrcode encoder under test. */
export function decodeWebSiteQr(pngBuffer) {
  const image = PNG.sync.read(Buffer.from(pngBuffer));
  return (
    jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ??
    null
  );
}
