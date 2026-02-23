import {
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  DEFAULT_FLIP_RULES,
  detectFlipDirection,
  isPointInCornerZone,
  shouldCompleteFlip,
  type FlipBounds,
  type FlipDirectionIntent,
  type FlipRules,
} from "./flipRules";

interface PointLike {
  x: number;
  y: number;
}

interface UIAdapter {
  getDistElement: () => HTMLElement;
}

interface FlipGestureEngine {
  startUserTouch: (pos: PointLike) => void;
  userMove: (pos: PointLike, isTouch: boolean) => void;
  userStop: (pos: PointLike, isSwipe?: boolean) => void;
  getBoundsRect: () => FlipBounds;
  getCurrentPageIndex: () => number;
  getPageCount: () => number;
  turnToPage: (pageNumber: number) => void;
  getUI: () => UIAdapter;
}

type NavigateIntent = "next" | "prev";
type NavigateSource = "tap" | "wheel";

interface FlipGestureSession {
  pointerId: number;
  pointerType: string;
  start: PointLike;
  last: PointLike;
  prev: PointLike;
  startAtMs: number;
  lastAtMs: number;
  prevAtMs: number;
  bounds: FlipBounds;
  direction: FlipDirectionIntent;
  startedPageIndex: number;
  inCornerZone: boolean;
  dragStarted: boolean;
}

interface UseFlipGesturesArgs {
  enabled: boolean;
  getEngine: () => FlipGestureEngine | null;
  onNavigate: (intent: NavigateIntent, source: NavigateSource) => void;
  rules?: FlipRules;
}

interface FlipGestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
}

const TAP_MAX_MOVEMENT_PX = 10;
const TAP_MAX_DURATION_MS = 320;
const WHEEL_DELTA_THRESHOLD = 12;
const WHEEL_COOLDOWN_MS = 55;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function getPointerPoint(event: ReactPointerEvent<HTMLElement>, root: HTMLElement): PointLike {
  const rect = root.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getWheelPoint(event: ReactWheelEvent<HTMLElement>, root: HTMLElement): PointLike {
  const rect = root.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function isPointInBook(point: PointLike, bounds: FlipBounds): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height
  );
}

export function useFlipGestures(args: UseFlipGesturesArgs): FlipGestureHandlers {
  const sessionRef = useRef<FlipGestureSession | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const wheelCooldownUntilRef = useRef(0);
  const rules = useMemo(() => args.rules ?? DEFAULT_FLIP_RULES, [args.rules]);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
  }, []);

  const maybeNavigate = useCallback(
    (engine: FlipGestureEngine, intent: NavigateIntent, source: NavigateSource) => {
      const currentIndex = engine.getCurrentPageIndex();
      const lastIndex = Math.max(0, engine.getPageCount() - 1);
      if (intent === "next") {
        if (currentIndex >= lastIndex) return;
      } else if (currentIndex <= 0) {
        return;
      }
      args.onNavigate(intent, source);
    },
    [args],
  );

  const finalize = useCallback(
    (event: ReactPointerEvent<HTMLElement>, pointerCancelled: boolean) => {
      const active = sessionRef.current;
      if (!active || event.pointerId !== active.pointerId) return;

      const engine = args.getEngine();
      if (!engine) {
        clearSession();
        return;
      }

      const root = engine.getUI().getDistElement();
      const point = getPointerPoint(event, root);
      const now = event.timeStamp || performance.now();
      const gestureDurationMs = now - active.startAtMs;
      const gestureDistance = Math.hypot(point.x - active.start.x, point.y - active.start.y);

      if (active.inCornerZone && active.dragStarted && !pointerCancelled) {
        const dt = Math.max(1, now - active.prevAtMs);
        const dxSincePrev = point.x - active.prev.x;
        const signedVelocityPxPerMs =
          active.direction === "forward" ? -dxSincePrev / dt : dxSincePrev / dt;
        const signedDragDistancePx =
          active.direction === "forward" ? active.start.x - point.x : point.x - active.start.x;
        const dragDistanceRatio = signedDragDistancePx / active.bounds.pageWidth;

        const y = clamp(point.y, active.bounds.top + 1, active.bounds.top + active.bounds.height - 1);
        const centerX = active.bounds.left + active.bounds.width / 2;
        const releaseCompletesByPosition =
          active.direction === "forward" ? point.x <= centerX : point.x >= centerX;
        const shouldComplete = shouldCompleteFlip(
          {
            dragDistanceRatio,
            signedVelocityPxPerMs,
          },
          rules,
        );

        if (shouldComplete === releaseCompletesByPosition) {
          engine.userStop(point, false);
        } else {
          const nudgeTarget: PointLike =
            active.direction === "forward"
              ? { x: shouldComplete ? centerX - 1 : centerX + 1, y }
              : { x: shouldComplete ? centerX + 1 : centerX - 1, y };
          engine.userMove(nudgeTarget, active.pointerType !== "mouse");
          engine.userStop(nudgeTarget, false);
        }

        if (!shouldComplete && engine.getCurrentPageIndex() !== active.startedPageIndex) {
          engine.turnToPage(active.startedPageIndex);
        }
      } else {
        if (active.inCornerZone) {
          // Clear internal engine touch state without triggering click-to-turn.
          engine.userStop(point, true);
        }

        const isTap =
          !pointerCancelled &&
          gestureDistance <= TAP_MAX_MOVEMENT_PX &&
          gestureDurationMs <= TAP_MAX_DURATION_MS;

        if (isTap) {
          let intent: NavigateIntent;
          if (active.startedPageIndex === 0) {
            intent = "next";
          } else {
            const centerX = active.bounds.left + active.bounds.width / 2;
            intent = point.x >= centerX ? "next" : "prev";
          }
          maybeNavigate(engine, intent, "tap");
        }
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      clearSession();
    },
    [args, clearSession, maybeNavigate, rules],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!args.enabled) return;

      const engine = args.getEngine();
      if (!engine) return;

      const root = engine.getUI().getDistElement();
      const point = getPointerPoint(event, root);
      const bounds = engine.getBoundsRect();
      if (!isPointInBook(point, bounds)) {
        return;
      }

      const inCornerZone = isPointInCornerZone(point, bounds, rules);
      const now = event.timeStamp || performance.now();

      sessionRef.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        start: point,
        last: point,
        prev: point,
        startAtMs: now,
        lastAtMs: now,
        prevAtMs: now,
        bounds,
        direction: detectFlipDirection(point, bounds),
        startedPageIndex: engine.getCurrentPageIndex(),
        inCornerZone,
        dragStarted: false,
      };

      if (inCornerZone) {
        engine.startUserTouch(point);
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      if (event.cancelable) {
        event.preventDefault();
      }
    },
    [args, rules],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const active = sessionRef.current;
      if (!active || event.pointerId !== active.pointerId) return;

      const engine = args.getEngine();
      if (!engine) {
        clearSession();
        return;
      }

      const root = engine.getUI().getDistElement();
      const point = getPointerPoint(event, root);
      const distanceFromStart = Math.hypot(point.x - active.start.x, point.y - active.start.y);

      active.prev = active.last;
      active.prevAtMs = active.lastAtMs;
      active.last = point;
      active.lastAtMs = event.timeStamp || performance.now();

      if (!active.inCornerZone) {
        return;
      }

      if (!active.dragStarted && distanceFromStart >= rules.minDragPx) {
        active.dragStarted = true;
        const easedStartPoint: PointLike = {
          x: active.start.x + (point.x - active.start.x) * 0.35,
          y: active.start.y + (point.y - active.start.y) * 0.35,
        };
        engine.userMove(easedStartPoint, active.pointerType !== "mouse");
      }

      if (active.dragStarted) {
        engine.userMove(point, active.pointerType !== "mouse");
        if (event.cancelable) {
          event.preventDefault();
        }
      }
    },
    [args, clearSession, rules.minDragPx],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      finalize(event, false);
    },
    [finalize],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      finalize(event, true);
    },
    [finalize],
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!args.enabled) return;

      const engine = args.getEngine();
      if (!engine) return;

      const root = engine.getUI().getDistElement();
      const point = getWheelPoint(event, root);
      const bounds = engine.getBoundsRect();
      if (!isPointInBook(point, bounds)) {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const now = event.timeStamp || performance.now();
      if (now < wheelCooldownUntilRef.current) {
        return;
      }

      wheelAccumulatorRef.current += event.deltaY;
      if (Math.abs(wheelAccumulatorRef.current) < WHEEL_DELTA_THRESHOLD) {
        return;
      }

      const intent: NavigateIntent = wheelAccumulatorRef.current > 0 ? "next" : "prev";
      wheelAccumulatorRef.current = 0;
      wheelCooldownUntilRef.current = now + WHEEL_COOLDOWN_MS;
      maybeNavigate(engine, intent, "wheel");
    },
    [args, maybeNavigate],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onWheel,
  };
}
