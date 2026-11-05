export type Size = { width: number; height: number };

export function fitScale(
  container: Size,
  page: Size,
  mode: "fit-width" | "fit-page",
  padding = 40,
): number {
  const availableWidth = Math.max(100, container.width - padding);
  const availableHeight = Math.max(100, container.height - padding);
  if (mode === "fit-width") return availableWidth / page.width;
  return Math.min(availableWidth / page.width, availableHeight / page.height);
}

export function clampScale(scale: number): number {
  return Math.min(8, Math.max(0.25, scale));
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, pageCount), Math.max(1, Math.round(page)));
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function parsePageNumber(value: string, pageCount: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(pageCount, Math.max(1, parsed));
}

export type PageRotation = 0 | 90 | 180 | 270;

/** Convert a PDF-space point (bottom-left origin) to CSS coordinates in the rotated page view. */
export function pdfToDisplay(
  point: { x: number; y: number },
  page: Size,
  scale: number,
  rotation: number,
): { x: number; y: number } {
  const sx = point.x * scale;
  const sy = (page.height - point.y) * scale;
  const width = page.width * scale;
  const height = page.height * scale;
  switch (normalizeRotation(rotation)) {
    case 90:
      return { x: height - sy, y: sx };
    case 180:
      return { x: width - sx, y: height - sy };
    case 270:
      return { x: sy, y: width - sx };
    default:
      return { x: sx, y: sy };
  }
}

/** Convert CSS coordinates in the rotated page view back to PDF space. */
export function displayToPdf(
  point: { x: number; y: number },
  page: Size,
  scale: number,
  rotation: number,
): { x: number; y: number } {
  const width = page.width * scale;
  const height = page.height * scale;
  let sx: number;
  let sy: number;
  switch (normalizeRotation(rotation)) {
    case 90:
      sx = point.y;
      sy = height - point.x;
      break;
    case 180:
      sx = width - point.x;
      sy = height - point.y;
      break;
    case 270:
      sx = width - point.y;
      sy = point.x;
      break;
    default:
      sx = point.x;
      sy = point.y;
      break;
  }
  return { x: sx / scale, y: page.height - sy / scale };
}

export function rotatedPageSize(page: Size, rotation: number): Size {
  const normalized = normalizeRotation(rotation);
  return normalized === 90 || normalized === 270
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height };
}

export function normalizeRotation(rotation: number): PageRotation {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized as PageRotation;
}

