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

export const FLOOR_CANVAS_WIDTH = 1800;
export const FLOOR_CANVAS_HEIGHT = 1200;
export const DEFAULT_TABLE_WIDTH = 7;
export const DEFAULT_TABLE_HEIGHT = 7;
export const DEFAULT_RECT_TABLE_WIDTH = 10;
export const DEFAULT_RECT_TABLE_HEIGHT = 7;

/** Check if two normalized rectangles overlap, with an optional safety margin. */
export function rectsOverlap(
  a: NormalizedRect,
  b: NormalizedRect,
  margin = 0.5,
): boolean {
  return (
    a.x < b.x + b.width + margin &&
    a.x + a.width > b.x - margin &&
    a.y < b.y + b.height + margin &&
    a.y + a.height > b.y - margin
  );
}

export type GridPlacementOptions = {
  cols?: number;
  rows?: number;
  startX?: number;
  startY?: number;
  gapX?: number;
  gapY?: number;
};

/**
 * Find the next available non-overlapping position for a table.
 * Primary scan: 10x10 grid (allowing 100 non-overlapping tables with comfortable margins).
 * Secondary scan: fine-grained canvas scan in 2% steps.
 * Fallback: staggered position within bounds so it is never hidden or lost.
 */
export function findAvailableTablePosition(
  existingElements: readonly NormalizedRect[],
  tableWidth = DEFAULT_TABLE_WIDTH,
  tableHeight = DEFAULT_TABLE_HEIGHT,
  options?: GridPlacementOptions,
): NormalizedPoint {
  const cols = options?.cols ?? 10;
  const rows = options?.rows ?? 10;
  const startX = options?.startX ?? 5;
  const startY = options?.startY ?? 5;
  const stepX = options?.gapX ?? 9.2;
  const stepY = options?.gapY ?? 9.2;

  // 1. Primary scan: 10x10 grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const candidate: NormalizedRect = {
        x: Math.round((startX + c * stepX) * 10) / 10,
        y: Math.round((startY + r * stepY) * 10) / 10,
        width: tableWidth,
        height: tableHeight,
      };
      if (
        candidate.x + candidate.width > 99 ||
        candidate.y + candidate.height > 99
      ) {
        continue;
      }
      const hasOverlap = existingElements.some((elem) =>
        rectsOverlap(candidate, elem),
      );
      if (!hasOverlap) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  // 2. Secondary scan: fine 2% grid search across full canvas
  for (let y = 2; y <= 98 - tableHeight; y += 2) {
    for (let x = 2; x <= 98 - tableWidth; x += 2) {
      const candidate: NormalizedRect = {
        x,
        y,
        width: tableWidth,
        height: tableHeight,
      };
      const hasOverlap = existingElements.some((elem) =>
        rectsOverlap(candidate, elem),
      );
      if (!hasOverlap) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  // 3. Fallback: staggered offset so tables never stack directly on each other
  const count = existingElements.length;
  const fallbackX = clamp(5 + (count % 10) * 2, 0, 100 - tableWidth);
  const fallbackY = clamp(5 + (count % 8) * 2, 0, 100 - tableHeight);
  return {
    x: Math.round(fallbackX * 10) / 10,
    y: Math.round(fallbackY * 10) / 10,
  };
}
