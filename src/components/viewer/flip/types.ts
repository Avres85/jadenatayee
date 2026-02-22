export type EngineFlipState = "user_fold" | "fold_corner" | "flipping" | "read";

export type FlipPhase = "idle" | "corner_preview" | "dragging" | "flipping";

export interface FlipStateSnapshot {
  phase: FlipPhase;
  locked: boolean;
  hasPendingTurn: boolean;
}
