export interface RectangleLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface RelativePoint {
  x: number;
  y: number;
}

export type ResizeCorner = "north-west" | "north-east" | "south-west" | "south-east";

export interface RelativeRectangle {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export function fitVideoContentRect(
  elementRect: RectangleLike,
  videoWidth: number,
  videoHeight: number,
  objectFit: string
): RectangleLike {
  if (
    objectFit !== "contain" || videoWidth <= 0 || videoHeight <= 0 ||
    elementRect.width <= 0 || elementRect.height <= 0
  ) return {...elementRect};

  const intrinsicAspect = videoWidth / videoHeight;
  const elementAspect = elementRect.width / elementRect.height;
  if (elementAspect > intrinsicAspect) {
    const width = elementRect.height * intrinsicAspect;
    return {
      left: elementRect.left + (elementRect.width - width) / 2,
      top: elementRect.top,
      width,
      height: elementRect.height
    };
  }

  const height = elementRect.width / intrinsicAspect;
  return {
    left: elementRect.left,
    top: elementRect.top + (elementRect.height - height) / 2,
    width: elementRect.width,
    height
  };
}

export function relativePointFromClient(
  clientX: number,
  clientY: number,
  videoRect: RectangleLike,
  maskWidthRatio: number,
  maskHeightRatio: number
): RelativePoint {
  const halfWidth = maskWidthRatio / 2;
  const halfHeight = maskHeightRatio / 2;
  const rawX = videoRect.width > 0 ? (clientX - videoRect.left) / videoRect.width : 0.5;
  const rawY = videoRect.height > 0 ? (clientY - videoRect.top) / videoRect.height : 0.5;
  return {
    x: clamp(rawX, halfWidth, 1 - halfWidth),
    y: clamp(rawY, halfHeight, 1 - halfHeight)
  };
}

export function clampRelativePosition(
  position: RelativePoint,
  maskWidthRatio: number,
  maskHeightRatio: number
): RelativePoint {
  const halfWidth = maskWidthRatio / 2;
  const halfHeight = maskHeightRatio / 2;
  return {
    x: clamp(position.x, halfWidth, 1 - halfWidth),
    y: clamp(position.y, halfHeight, 1 - halfHeight)
  };
}

export function resizeRelativeRectangleFromCorner(
  rectangle: RelativeRectangle,
  corner: ResizeCorner,
  pointer: RelativePoint,
  limits: {minimumWidth: number; maximumWidth: number; minimumHeight: number; maximumHeight: number}
): RelativeRectangle {
  const east = corner.endsWith("east");
  const south = corner.startsWith("south");
  const oppositeX = rectangle.centerX + (east ? -rectangle.width / 2 : rectangle.width / 2);
  const oppositeY = rectangle.centerY + (south ? -rectangle.height / 2 : rectangle.height / 2);
  const targetX = east
    ? clamp(pointer.x, oppositeX + limits.minimumWidth, Math.min(1, oppositeX + limits.maximumWidth))
    : clamp(pointer.x, Math.max(0, oppositeX - limits.maximumWidth), oppositeX - limits.minimumWidth);
  const targetY = south
    ? clamp(pointer.y, oppositeY + limits.minimumHeight, Math.min(1, oppositeY + limits.maximumHeight))
    : clamp(pointer.y, Math.max(0, oppositeY - limits.maximumHeight), oppositeY - limits.minimumHeight);
  return {
    centerX: (oppositeX + targetX) / 2,
    centerY: (oppositeY + targetY) / 2,
    width: Math.abs(targetX - oppositeX),
    height: Math.abs(targetY - oppositeY)
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
