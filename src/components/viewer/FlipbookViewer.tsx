"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface ViewerDocumentPayload {
  id: string;
  status: string;
  fileSize: number;
  updatedAt: string;
  url: string;
  warning: string | null;
}

interface PDFDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<any>;
  destroy(): Promise<void>;
}

interface PdfJsModuleLike {
  getDocument: (source: unknown) => { promise: Promise<PDFDocumentLike> };
  GlobalWorkerOptions: {
    workerSrc: string;
  };
}

function ensurePromiseWithResolvers(): void {
  const candidate = Promise as PromiseConstructor & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };
  if (typeof candidate.withResolvers === "function") {
    return;
  }
  const polyfill = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
  try {
    Object.defineProperty(Promise, "withResolvers", {
      value: polyfill,
      configurable: true,
      writable: true,
    });
  } catch {
    candidate.withResolvers = polyfill;
  }
}

ensurePromiseWithResolvers();

function usePrefersReducedMotion(): boolean {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setValue(media.matches);
    const handler = () => setValue(media.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);
  return value;
}

function useSpreadMode(): boolean {
  const [spread, setSpread] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(min-width: 900px)");
    setSpread(media.matches);
    const listener = () => setSpread(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return spread;
}

function bytesToLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PageCanvas({
  pdf,
  pageNumber,
  zoom,
}: {
  pdf: PDFDocumentLike;
  pageNumber: number;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRenderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const renderVersionRef = useRef(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const renderVersion = ++renderVersionRef.current;

    async function render(): Promise<void> {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        setError(null);
        const page = await pdf.getPage(pageNumber);
        if (disposed || renderVersion !== renderVersionRef.current) {
          return;
        }

        if (activeRenderTaskRef.current) {
          activeRenderTaskRef.current.cancel();
          await activeRenderTaskRef.current.promise.catch(() => undefined);
          activeRenderTaskRef.current = null;
        }

        const viewport = page.getViewport({ scale: Math.max(1, zoom * 2) });
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas context unavailable");
        }
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const localRenderTask = page.render({
          canvasContext: context,
          viewport,
        });
        activeRenderTaskRef.current = localRenderTask;
        await localRenderTask.promise;
        if (activeRenderTaskRef.current === localRenderTask) {
          activeRenderTaskRef.current = null;
        }
      } catch (reason) {
        if (disposed || renderVersion !== renderVersionRef.current) return;
        const cancelledMessage =
          reason instanceof Error &&
          reason.message.toLowerCase().includes("rendering cancelled");
        if (cancelledMessage) {
          return;
        }
        const message = reason instanceof Error ? reason.message : "Failed to render page";
        setError(message);
      }
    }

    void render();
    return () => {
      disposed = true;
      activeRenderTaskRef.current?.cancel();
    };
  }, [pdf, pageNumber, zoom]);

  return (
    <div className="page-canvas-wrap">
      {error ? (
        <div style={{ color: "#a00", padding: "1rem" }} className="mono">
          {error}
        </div>
      ) : (
        <canvas ref={canvasRef} className="page-canvas" />
      )}
    </div>
  );
}

export function FlipbookViewer() {
  const [meta, setMeta] = useState<ViewerDocumentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentLike | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpValue, setJumpValue] = useState("1");
  const [zoom, setZoom] = useState(1);
  const [transitionClass, setTransitionClass] = useState("");
  const spreadMode = useSpreadMode();
  const reducedMotion = usePrefersReducedMotion();
  const pdfJsRef = useRef<PdfJsModuleLike | null>(null);

  useEffect(() => {
    let disposed = false;
    async function loadDocumentMeta(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/viewer/document", {
          cache: "no-store",
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Failed to load viewer metadata");
        }
        const payload = (await response.json()) as ViewerDocumentPayload;
        if (disposed) return;
        setMeta(payload);

        if (!pdfJsRef.current) {
          ensurePromiseWithResolvers();
          const module = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJsModuleLike;
          module.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          pdfJsRef.current = module;
        }

        const task = pdfJsRef.current.getDocument({
          url: payload.url,
          disableWorker: true,
          disableAutoFetch: false,
          disableStream: false,
        });
        const loaded = (await task.promise) as PDFDocumentLike;
        if (disposed) {
          await loaded.destroy();
          return;
        }
        setPdfDoc((previous) => {
          if (previous) {
            void previous.destroy();
          }
          return loaded;
        });
        setCurrentPage(1);
        setJumpValue("1");
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : "Failed to load portfolio";
        if (!disposed) {
          setError(message);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }
    void loadDocumentMeta();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!pdfDoc) return;
    const maxStart = spreadMode ? Math.max(1, pdfDoc.numPages - 1) : pdfDoc.numPages;
    setCurrentPage((previous) => {
      let next = Math.min(previous, maxStart);
      if (spreadMode && next % 2 === 0) {
        next -= 1;
      }
      return Math.max(next, 1);
    });
  }, [spreadMode, pdfDoc]);

  const visiblePages = useMemo(() => {
    if (!pdfDoc) return [];
    if (!spreadMode) {
      return [currentPage];
    }
    const right = currentPage + 1 <= pdfDoc.numPages ? currentPage + 1 : null;
    return [currentPage, right].filter((value): value is number => Boolean(value));
  }, [currentPage, pdfDoc, spreadMode]);

  function withFlipAnimation(direction: "next" | "prev", update: () => void): void {
    if (reducedMotion) {
      update();
      return;
    }
    setTransitionClass(direction === "next" ? "flip-next" : "flip-prev");
    update();
    window.setTimeout(() => setTransitionClass(""), 280);
  }

  function goNext(): void {
    if (!pdfDoc) return;
    const step = spreadMode ? 2 : 1;
    const maxStart = spreadMode ? Math.max(1, pdfDoc.numPages - 1) : pdfDoc.numPages;
    withFlipAnimation("next", () => {
      setCurrentPage((previous) => {
        const next = Math.min(previous + step, maxStart);
        setJumpValue(String(next));
        return next;
      });
    });
  }

  function goPrev(): void {
    if (!pdfDoc) return;
    const step = spreadMode ? 2 : 1;
    withFlipAnimation("prev", () => {
      setCurrentPage((previous) => {
        let next = Math.max(1, previous - step);
        if (spreadMode && next % 2 === 0) {
          next -= 1;
        }
        next = Math.max(next, 1);
        setJumpValue(String(next));
        return next;
      });
    });
  }

  function jumpToPage(): void {
    if (!pdfDoc) return;
    const parsed = Number.parseInt(jumpValue, 10);
    if (Number.isNaN(parsed)) return;
    let page = Math.max(1, Math.min(parsed, pdfDoc.numPages));
    if (spreadMode && page % 2 === 0) {
      page -= 1;
    }
    setCurrentPage(Math.max(page, 1));
    setJumpValue(String(Math.max(page, 1)));
  }

  async function toggleFullscreen(): Promise<void> {
    if (typeof document === "undefined") return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  }

  if (loading) {
    return (
      <main className="page-shell">
        <div className="panel mono">Loading portfolio...</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-shell">
        <div className="panel danger mono">{error}</div>
      </main>
    );
  }

  if (!pdfDoc || !meta) {
    return (
      <main className="page-shell">
        <div className="panel mono">No portfolio available.</div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <div className="toolbar">
        <button type="button" onClick={goPrev}>
          Prev
        </button>
        <button type="button" onClick={goNext}>
          Next
        </button>
        <input
          value={jumpValue}
          onChange={(event) => setJumpValue(event.target.value)}
          onBlur={jumpToPage}
          style={{ width: "4.4rem" }}
          aria-label="Jump to page"
        />
        <button type="button" onClick={jumpToPage}>
          Jump
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>
          -
        </button>
        <span className="mono">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(8, value + 0.1))}>
          +
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          100%
        </button>
        <button type="button" onClick={toggleFullscreen}>
          Fullscreen
        </button>
        <div className="status mono">
          {currentPage}/{pdfDoc.numPages} • {spreadMode ? "Spread" : "Single"} •{" "}
          {bytesToLabel(meta.fileSize)}
        </div>
      </div>

      <section className="viewer-stage" aria-live="polite">
        <div className={`spread ${spreadMode ? "double" : "single"} ${transitionClass}`.trim()}>
          {visiblePages.map((page) => (
            <PageCanvas key={page} pdf={pdfDoc} pageNumber={page} zoom={zoom} />
          ))}
          {spreadMode && visiblePages.length === 1 ? <div className="page-empty" /> : null}
        </div>
      </section>

      {meta.warning ? (
        <div className="panel mono">
          Compression warning: <span className="danger">{meta.warning}</span>
        </div>
      ) : null}
    </main>
  );
}
