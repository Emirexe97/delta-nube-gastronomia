import { describe, expect, it, vi } from "vitest";
import {
  fileFromImageDataUrl,
  normalizeSiteBanner,
  normalizeSiteImage,
} from "./web-site-banner";

function pngFile(width = 500, height = 200) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return new File([bytes], "x.png", { type: "image/png" });
}

describe("normalizeSiteBanner", () => {
  it("rejects unsupported formats and oversized files before decoding", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    await expect(
      normalizeSiteBanner(new File(["x"], "x.gif", { type: "image/gif" })),
    ).rejects.toThrow("JPG, PNG o WebP");
    await expect(
      normalizeSiteBanner(
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], "x.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).rejects.toThrow("8 MB");
    expect(decode).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("requires a decodable, reasonably-sized image", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("bad image")),
    );
    await expect(normalizeSiteBanner(pngFile())).rejects.toThrow(
      "No se pudo leer",
    );
    const huge = pngFile();
    const bytes = new Uint8Array(await huge.arrayBuffer());
    new DataView(bytes.buffer).setUint32(16, 20_000);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 20_000, height: 1, close() {} }),
    );
    await expect(
      normalizeSiteBanner(new File([bytes], "huge.png", { type: "image/png" })),
    ).rejects.toThrow("dimensiones demasiado grandes");
    vi.unstubAllGlobals();
  });

  it("encodes to a fresh JPEG canvas without upscaling small input", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, fillRect: vi.fn() }),
      toDataURL: vi.fn(() => "data:image/jpeg;base64,AA=="),
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 500, height: 200, close() {} }),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    const result = await normalizeSiteBanner(pngFile());
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
    expect(canvas.width).toBe(500);
    expect(canvas.height).toBe(200);
    expect(drawImage).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("crops portrait images to the storefront 5:2 ratio without distortion", async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn() }),
      toDataURL: () => "data:image/jpeg;base64,AA==",
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1000, height: 1000, close() {} }),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    await normalizeSiteBanner(pngFile(1000, 1000));
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(400);
    vi.unstubAllGlobals();
  });

  it("contains logos on a square white canvas without stretching", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, fillRect: vi.fn() }),
      toDataURL: () => "data:image/jpeg;base64,AA==",
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 200, height: 100, close() {} }),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    await normalizeSiteImage(pngFile(200, 100), "logo");
    expect(canvas.width).toBe(384);
    expect(canvas.height).toBe(384);
    const [left, top, drawnWidth, drawnHeight] =
      drawImage.mock.calls[0]!.slice(-4);
    expect(left).toBeCloseTo(30.72, 1);
    expect(top).toBeCloseTo(111.36, 1);
    expect(drawnWidth).toBeCloseTo(322.56, 1);
    expect(drawnHeight).toBeCloseTo(161.28, 1);
    vi.unstubAllGlobals();
  });

  it("normalizes product photos to a centered 4:3 image within 800x600", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, fillRect: vi.fn() }),
      toDataURL: () => "data:image/jpeg;base64,AA==",
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1200, height: 1200, close() {} }),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    await normalizeSiteImage(pngFile(1200, 1200), "product");
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(drawImage.mock.calls[0]?.slice(-4)).toEqual([0, 0, 800, 600]);
    vi.unstubAllGlobals();
  });

  it("normalizes real POS-stored PNG/WebP data URLs without fetch", async () => {
    const png = fileFromImageDataUrl(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p5sAAAAASUVORK5CYII=",
      "pos.png",
    );
    const webp = fileFromImageDataUrl(
      "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==",
      "pos.webp",
    );
    expect(png.type).toBe("image/png");
    expect(new Uint8Array(await png.slice(0, 8).arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(webp.type).toBe("image/webp");
    expect(
      new TextDecoder().decode(await webp.slice(0, 12).arrayBuffer()),
    ).toBe('RIFF"\0\0\0WEBP');
    expect(() =>
      fileFromImageDataUrl("https://remote.example/image.png", "bad.png"),
    ).toThrow("No se pudo leer");
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn() }),
      toDataURL: () => "data:image/jpeg;base64,AA==",
    };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 1, height: 1, close() {} }),
    );
    vi.stubGlobal("document", { createElement: () => canvas });
    expect(await normalizeSiteImage(png, "product")).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    expect(await normalizeSiteImage(webp, "product")).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    vi.unstubAllGlobals();
  });
});
