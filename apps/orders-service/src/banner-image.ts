export type JpegImageLimits = { maxBytes: number; maxWidth: number; maxHeight: number; square?: boolean };
export const LOGO_JPEG_LIMITS = { maxBytes: 96 * 1024, maxWidth: 384, maxHeight: 384, square: true } as const satisfies JpegImageLimits;
export const PRODUCT_PHOTO_JPEG_LIMITS = { maxBytes: 160 * 1024, maxWidth: 800, maxHeight: 600 } as const satisfies JpegImageLimits;
const BANNER_LIMITS: JpegImageLimits = { maxBytes: 320 * 1024, maxWidth: 1600, maxHeight: 1000 };

/** Strictly parse a JPEG and read its real frame dimensions (not client metadata). */
export function parseBannerDataUrl(value: unknown, limits: JpegImageLimits = BANNER_LIMITS): Buffer {
  if (typeof value !== "string" || !value.startsWith("data:image/jpeg;base64,"))
    throw new Error("invalid_banner");
  const encoded = value.slice("data:image/jpeg;base64,".length);
  if (encoded.length > Math.ceil(limits.maxBytes / 3) * 4)
    throw new Error("invalid_banner");
  // Round-trip below enforces canonical padding. Avoid a repeated regexp group
  // per quartet: large, perfectly valid photo payloads must not exhaust the stack.
  if (
    !encoded ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    throw new Error("invalid_banner");
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length > limits.maxBytes ||
    bytes.toString("base64") !== encoded ||
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8
  )
    throw new Error("invalid_banner");
  let offset = 2,
    dimensions: [number, number] | undefined,
    ended = false;
  let sawQuantization = false,
    sawHuffman = false,
    sawScan = false;
  let frameComponents = 0;
  const quantTables = new Set<number>(),
    huffmanTables = new Set<string>();
  const frameQuantById = new Map<number, number>();
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error("invalid_banner");
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (
      marker === undefined ||
      marker === 0x00 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      if (marker === 0xd9) {
        ended = true;
        break;
      }
      throw new Error("invalid_banner");
    }
    if (offset + 2 > bytes.length) throw new Error("invalid_banner");
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length)
      throw new Error("invalid_banner");
    const isFrame = marker === 0xc0;
    if (isFrame) {
      if (dimensions || length < 11 || bytes[offset + 2] !== 8)
        throw new Error("invalid_banner");
      const height = bytes.readUInt16BE(offset + 3),
        width = bytes.readUInt16BE(offset + 5);
      const components = bytes[offset + 7];
      if (
        (components !== 1 && components !== 3) ||
        length !== 8 + components * 3
      )
        throw new Error("invalid_banner");
      frameComponents = components;
      for (let i = 0; i < components; i++) {
        const p = offset + 8 + i * 3,
          sampling = bytes[p + 1],
          quant = bytes[p + 2];
        const componentId = bytes[p];
        if (
          !componentId ||
          sampling === undefined ||
          quant === undefined ||
          !(sampling >> 4) ||
          !(sampling & 15) ||
          sampling >> 4 > 4 ||
          (sampling & 15) > 4 ||
          quant > 3 ||
          frameQuantById.has(componentId)
        )
          throw new Error("invalid_banner");
        frameQuantById.set(componentId, quant);
      }
      if (!width || !height || width > limits.maxWidth || height > limits.maxHeight || (limits.square && width !== height))
        throw new Error("invalid_banner");
      dimensions = [width, height];
    }
    if (marker === 0xdb) {
      let p = offset + 2;
      while (p < offset + length) {
        const spec = bytes[p++];
        if (spec === undefined) throw new Error("invalid_banner");
        const precision = spec >> 4,
          id = spec & 15;
        if (precision > 1 || id > 3) throw new Error("invalid_banner");
        const tableLength = 64 * (precision + 1);
        if (p + tableLength > offset + length)
          throw new Error("invalid_banner");
        p += tableLength;
        quantTables.add(id);
        sawQuantization = true;
      }
      if (p !== offset + length) throw new Error("invalid_banner");
    }
    if (marker === 0xc4) {
      let p = offset + 2;
      while (p < offset + length) {
        if (p + 17 > offset + length) throw new Error("invalid_banner");
        const spec = bytes[p++];
        if (spec === undefined) throw new Error("invalid_banner");
        const tableClass = spec >> 4,
          id = spec & 15;
        if (tableClass > 1 || id > 3) throw new Error("invalid_banner");
        let count = 0;
        for (let i = 0; i < 16; i++) {
          const value = bytes[p + i];
          if (value === undefined) throw new Error("invalid_banner");
          count += value;
        }
        p += 16;
        if (!count || p + count > offset + length)
          throw new Error("invalid_banner");
        p += count;
        huffmanTables.add(`${tableClass}:${id}`);
        sawHuffman = true;
      }
      if (p !== offset + length) throw new Error("invalid_banner");
    }
    if (marker === 0xda) {
      if (
        !dimensions ||
        !sawQuantization ||
        !sawHuffman ||
        sawScan ||
        length < 8
      )
        throw new Error("invalid_banner");
      const scanComponents = bytes[offset + 2];
      if (
        scanComponents !== frameComponents ||
        length !== 6 + scanComponents * 2
      )
        throw new Error("invalid_banner");
      const scanIds = new Set<number>();
      for (let i = 0; i < scanComponents; i++) {
        const componentId = bytes[offset + 3 + i * 2],
          selectors = bytes[offset + 4 + i * 2];
        if (
          componentId === undefined ||
          selectors === undefined ||
          scanIds.has(componentId)
        )
          throw new Error("invalid_banner");
        scanIds.add(componentId);
        const dctId = selectors >> 4,
          acId = selectors & 15;
        if (
          !frameQuantById.has(componentId) ||
          !quantTables.has(frameQuantById.get(componentId)!) ||
          !huffmanTables.has(`0:${dctId}`) ||
          !huffmanTables.has(`1:${acId}`)
        )
          throw new Error("invalid_banner");
      }
      const spectral = offset + 3 + scanComponents * 2;
      if (
        bytes[spectral] !== 0 ||
        bytes[spectral + 1] !== 63 ||
        bytes[spectral + 2] !== 0
      )
        throw new Error("invalid_banner");
      sawScan = true;
      offset += length;
      const entropyStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue;
        const next = bytes[offset++];
        if (
          next === 0x00 ||
          (next !== undefined && next >= 0xd0 && next <= 0xd7)
        )
          continue;
        if (next === 0xd9 && offset - 2 > entropyStart) {
          ended = true;
          break;
        }
        offset -= 2;
        break;
      }
      if (ended) break;
    } else offset += length;
  }
  if (!dimensions || !sawScan || !ended || offset !== bytes.length)
    throw new Error("invalid_banner");
  return bytes;
}
