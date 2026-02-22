import { useCallback, useRef, useState } from "react";
import type { EngineFlipState, FlipPhase, FlipStateSnapshot } from "./types";

type DeferredTurn = () => void;

interface UseFlipStateResult {
  snapshot: FlipStateSnapshot;
  reset: () => void;
  handleEngineState: (state: EngineFlipState) => void;
  requestProgrammaticTurn: (turn: DeferredTurn) => boolean;
}

export function useFlipState(): UseFlipStateResult {
  const [phase, setPhase] = useState<FlipPhase>("idle");
  const [locked, setLocked] = useState(false);
  const pendingTurnRef = useRef<DeferredTurn | null>(null);

  const reset = useCallback(() => {
    pendingTurnRef.current = null;
    setPhase("idle");
    setLocked(false);
  }, []);

  const runTurn = useCallback((turn: DeferredTurn) => {
    try {
      setPhase("flipping");
      setLocked(true);
      turn();
      return true;
    } catch {
      setPhase("idle");
      setLocked(false);
      return false;
    }
  }, []);

  const requestProgrammaticTurn = useCallback(
    (turn: DeferredTurn) => {
      if (locked || phase !== "idle") {
        pendingTurnRef.current = turn;
        return false;
      }
      return runTurn(turn);
    },
    [locked, phase, runTurn],
  );

  const handleEngineState = useCallback(
    (state: EngineFlipState) => {
      if (state === "fold_corner") {
        setPhase("corner_preview");
        return;
      }

      if (state === "user_fold") {
        setPhase("dragging");
        setLocked(true);
        return;
      }

      if (state === "flipping") {
        setPhase("flipping");
        setLocked(true);
        return;
      }

      const pending = pendingTurnRef.current;
      pendingTurnRef.current = null;
      if (pending) {
        void runTurn(pending);
        return;
      }
      setPhase("idle");
      setLocked(false);
    },
    [runTurn],
  );

  return {
    snapshot: {
      phase,
      locked,
      hasPendingTurn: pendingTurnRef.current !== null,
    },
    reset,
    handleEngineState,
    requestProgrammaticTurn,
  };
}
