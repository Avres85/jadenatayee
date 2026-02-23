export interface FlipBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  pageWidth: number;
}

export interface FlipPoint {
  x: number;
  y: number;
}

export type FlipDirectionIntent = "forward" | "back";

export interface FlipCompletionMetrics {
  dragDistanceRatio: number;
  signedVelocityPxPerMs: number;
}

export interface FlipRules {
  minDragPx: number;
  completeDistanceRatio: number;
  completeVelocityPxPerMs: number;
  cornerWidthRatio: number;
  cornerHeightRatio: number;
}

export const DEFAULT_FLIP_RULES: FlipRules = {
  minDragPx: 9,
  completeDistanceRatio: 0.34,
  completeVelocityPxPerMs: 0.65,
  cornerWidthRatio: 0.26,
  cornerHeightRatio: 0.26,
};

export function detectFlipDirection(point: FlipPoint, bounds: FlipBounds): FlipDirectionIntent {
  const centerX = bounds.left + bounds.width / 2;
  return point.x >= centerX ? "forward" : "back";
}

export function isPointInCornerZone(
  point: FlipPoint,
  bounds: FlipBounds,
  rules: FlipRules = DEFAULT_FLIP_RULES,
): boolean {
  if (
    point.x < bounds.left ||
    point.x > bounds.left + bounds.width ||
    point.y < bounds.top ||
    point.y > bounds.top + bounds.height
  ) {
    return false;
  }

  const xInBook = point.x - bounds.left;
  const edgeGrabWidth = Math.max(22, bounds.pageWidth * 0.14);

  // Grab only from the long outer edges (left-most / right-most), not broad side areas.
  return xInBook <= edgeGrabWidth || xInBook >= bounds.width - edgeGrabWidth;
}

export function shouldCompleteFlip(
  metrics: FlipCompletionMetrics,
  rules: FlipRules = DEFAULT_FLIP_RULES,
): boolean {
  return (
    metrics.dragDistanceRatio >= rules.completeDistanceRatio ||
    metrics.signedVelocityPxPerMs >= rules.completeVelocityPxPerMs
  );
}
