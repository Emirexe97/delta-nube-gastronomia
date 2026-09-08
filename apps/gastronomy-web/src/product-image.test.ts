import { describe, expect, it } from "vitest";
import {
  productImageDimensions,
  validateProductImageFile,
} from "./product-image";

describe("product image helpers", () => {
  it("valida formatos y tamaño", () => {
    expect(() =>
      validateProductImageFile({ type: "image/jpeg", size: 1 }),
    ).not.toThrow();
    expect(() =>
      validateProductImageFile({ type: "image/gif", size: 1 }),
    ).toThrow("JPG");
    expect(() =>
      validateProductImageFile({
        type: "image/png",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).toThrow("10 MiB");
  });
  it("redimensiona proporcionalmente hasta 1280", () => {
    expect(productImageDimensions(2560, 1280)).toEqual({
      width: 1280,
      height: 640,
    });
    expect(productImageDimensions(640, 480)).toEqual({
      width: 640,
      height: 480,
    });
    expect(() => productImageDimensions(0, 10)).toThrow("dimensiones");
  });
});
