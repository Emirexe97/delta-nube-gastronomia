/** Pure geometry helpers for the normalized floor-plan editor. */

export type NormalizedPoint = { x: number; y: number };

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const CANVAS_MIN = 0;
const CANVAS_MAX = 100;

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;

export const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, finite(value, minimum)));

/** Clamp a normalized rectangle to the 0..100 canvas and enforce its minimum size. */
export function clampNormalizedRect(
  rect: NormalizedRect,
  minimumWidth = 0,
  minimumHeight = 0,
): NormalizedRect {
  const widthMinimum = clamp(finite(minimumWidth), 0, CANVAS_MAX);
  const heightMinimum = clamp(finite(minimumHeight), 0, CANVAS_MAX);
  const width = clamp(
    finite(rect.width, widthMinimum),
    widthMinimum,
    CANVAS_MAX,
  );
  const height = clamp(
    finite(rect.height, heightMinimum),
    heightMinimum,
    CANVAS_MAX,
  );
  return {
    x: clamp(finite(rect.x), CANVAS_MIN, CANVAS_MAX - width),
    y: clamp(finite(rect.y), CANVAS_MIN, CANVAS_MAX - height),
    width,
    height,
  };
}

/** Resize a rectangle from any of the eight handles, keeping it in the canvas. */
export function resizeNormalizedRect(
  rect: NormalizedRect,
  handle: ResizeHandle,
  pointer: NormalizedPoint,
  minimumWidth = 2,
  minimumHeight = 2,
  maximumWidth = CANVAS_MAX,
  maximumHeight = CANVAS_MAX,
): NormalizedRect {
  const start = clampNormalizedRect(rect, minimumWidth, minimumHeight);
  const minWidth = clamp(finite(minimumWidth), 0, CANVAS_MAX);
  const minHeight = clamp(finite(minimumHeight), 0, CANVAS_MAX);
  const maxWidth = clamp(
    finite(maximumWidth, CANVAS_MAX),
    minWidth,
    CANVAS_MAX,
  );
  const maxHeight = clamp(
    finite(maximumHeight, CANVAS_MAX),
    minHeight,
    CANVAS_MAX,
  );
  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;
  const x = finite(pointer.x, left);
  const y = finite(pointer.y, top);

  if (handle.includes("w"))
    left = clamp(x, Math.max(CANVAS_MIN, right - maxWidth), right - minWidth);
  if (handle.includes("e"))
    right = clamp(x, left + minWidth, Math.min(CANVAS_MAX, left + maxWidth));
  if (handle.includes("n"))
    top = clamp(
      y,
      Math.max(CANVAS_MIN, bottom - maxHeight),
      bottom - minHeight,
    );
  if (handle.includes("s"))
    bottom = clamp(y, top + minHeight, Math.min(CANVAS_MAX, top + maxHeight));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export type LocalGeometry = {
  bounds: NormalizedRect;
  points: NormalizedPoint[];
};

/** Convert canvas points to their bounding box and coordinates local to that box (0..100). */
export function globalPointsToLocalGeometry(
  points: readonly NormalizedPoint[],
): LocalGeometry {
  if (points.length === 0)
    return { bounds: { x: 0, y: 0, width: 0, height: 0 }, points: [] };
  const xs = points.map((point) => finite(point.x));
  const ys = points.map((point) => finite(point.y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    bounds: { x: minX, y: minY, width, height },
    points: points.map((point) => ({
      x: width === 0 ? 0 : ((finite(point.x) - minX) / width) * 100,
      y: height === 0 ? 0 : ((finite(point.y) - minY) / height) * 100,
    })),
  };
}

/** Move a local node by a delta and clamp it to the normalized canvas. */
export function moveLocalNode(
  point: NormalizedPoint,
  delta: NormalizedPoint,
): NormalizedPoint {
  return {
    x: clamp(finite(point.x) + finite(delta.x), CANVAS_MIN, CANVAS_MAX),
    y: clamp(finite(point.y) + finite(delta.y), CANVAS_MIN, CANVAS_MAX),
  };
}

const formatCoordinate = (value: number, precision: number) => {
  const rounded = Number(finite(value).toFixed(precision));
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

/** Serialize points into the format accepted by an SVG points attribute. */
export function svgPoints(
  points: readonly NormalizedPoint[],
  precision = 2,
): string {
  const safePrecision = clamp(Math.floor(finite(precision, 2)), 0, 8);
  return points
    .map(
      (point) =>
        `${formatCoordinate(point.x, safePrecision)},${formatCoordinate(point.y, safePrecision)}`,
    )
    .join(" ");
}

// Explicit aliases make the intent discoverable at call sites.
export const pointsToLocalGeometry = globalPointsToLocalGeometry;
export const toSvgPoints = svgPoints;
