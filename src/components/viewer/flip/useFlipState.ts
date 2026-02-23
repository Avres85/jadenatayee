import { useCallback, useEffect, useRef, useState } from "react";
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
  const lockTimeoutRef = useRef<number | null>(null);

  const clearLockTimeout = useCallback(() => {
    if (lockTimeoutRef.current !== null) {
      window.clearTimeout(lockTimeoutRef.current);
      lockTimeoutRef.current = null;
    }
  }, []);

  const armLockTimeout = useCallback(() => {
    clearLockTimeout();
    lockTimeoutRef.current = window.setTimeout(() => {
      pendingTurnRef.current = null;
      setPhase("idle");
      setLocked(false);
      lockTimeoutRef.current = null;
    }, 1800);
  }, [clearLockTimeout]);

  const reset = useCallback(() => {
    pendingTurnRef.current = null;
    clearLockTimeout();
    setPhase("idle");
    setLocked(false);
  }, [clearLockTimeout]);

  const runTurn = useCallback((turn: DeferredTurn) => {
    try {
      setPhase("flipping");
      setLocked(true);
      armLockTimeout();
      turn();
      return true;
    } catch {
      clearLockTimeout();
      setPhase("idle");
      setLocked(false);
      return false;
    }
  }, [armLockTimeout, clearLockTimeout]);

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
        armLockTimeout();
        return;
      }

      if (state === "flipping") {
        setPhase("flipping");
        setLocked(true);
        armLockTimeout();
        return;
      }

      clearLockTimeout();
      const pending = pendingTurnRef.current;
      pendingTurnRef.current = null;
      if (pending) {
        void runTurn(pending);
        return;
      }
      setPhase("idle");
      setLocked(false);
    },
    [armLockTimeout, clearLockTimeout, runTurn],
  );

  useEffect(() => {
    return () => {
      clearLockTimeout();
    };
  }, [clearLockTimeout]);

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
