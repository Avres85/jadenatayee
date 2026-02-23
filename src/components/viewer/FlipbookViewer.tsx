"use client";

import HTMLFlipBook from "react-pageflip";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineFlipState } from "@/components/viewer/flip/types";
import { useFlipGestures } from "@/components/viewer/flip/useFlipGestures";
import { useFlipState } from "@/components/viewer/flip/useFlipState";

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

type BookMode = "portrait" | "landscape";
type PageDensity = "soft" | "hard";

interface FlipBookPage {
  setDensity: (density: PageDensity) => void;
}

interface PageFlipApi {
  flipNext: (corner?: "top" | "bottom") => void;
  flipPrev: (corner?: "top" | "bottom") => void;
  flip: (pageNumber: number, corner?: "top" | "bottom") => void;
  turnToPage: (pageNumber: number) => void;
  getCurrentPageIndex: () => number;
  getPageCount: () => number;
  getPage: (pageNumber: number) => FlipBookPage;
  getBoundsRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
    pageWidth: number;
  };
  startUserTouch: (pos: { x: number; y: number }) => void;
  userMove: (pos: { x: number; y: number }, isTouch: boolean) => void;
  userStop: (pos: { x: number; y: number }, isSwipe?: boolean) => void;
  getUI: () => {
    getDistElement: () => HTMLElement;
  };
}

interface FlipBookRefLike {
  pageFlip: () => PageFlipApi;
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

function useIsDesktop(breakpoint = 1024): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = `(min-width: ${breakpoint}px)`;
    const media = window.matchMedia(query);
    const sync = () => setIsDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [breakpoint]);

  return isDesktop;
}

function useIsSafari(): boolean {
  const [isSafari, setIsSafari] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    const vendor = navigator.vendor ?? "";
    const safari =
      /Safari/i.test(ua) &&
      /Apple/i.test(vendor) &&
      !/CriOS|Chrome|Chromium|Edg|OPR|FxiOS|Firefox|SamsungBrowser/i.test(ua);
    setIsSafari(safari);
  }, []);

  return isSafari;
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
  onBitmap,
}: {
  pdf: PDFDocumentLike;
  pageNumber: number;
  zoom: number;
  onBitmap?: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRenderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const renderVersionRef = useRef(0);
  const onBitmapRef = useRef(onBitmap);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onBitmapRef.current = onBitmap;
  }, [onBitmap]);

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
        if (onBitmapRef.current) {
          onBitmapRef.current(canvas.toDataURL("image/png"));
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

const FlipPage = forwardRef<
  HTMLDivElement,
  {
    pdf: PDFDocumentLike;
    pageNumber: number;
    zoom: number;
    className?: string;
    doubleSided?: boolean;
    isFrontCover?: boolean;
    coverTexture?: string | null;
    onCoverBitmap?: (dataUrl: string) => void;
  }
>(function FlipPage(
  { pdf, pageNumber, zoom, className, doubleSided = false, isFrontCover = false, coverTexture, onCoverBitmap },
  ref,
) {
  if (doubleSided) {
    return (
      <div ref={ref} className={`flipbook-page double-sided-cover${className ? ` ${className}` : ""}`}>
        <div className="cover-side cover-side-front">
          <PageCanvas
            pdf={pdf}
            pageNumber={pageNumber}
            zoom={zoom}
            onBitmap={isFrontCover ? onCoverBitmap : undefined}
          />
          {isFrontCover && coverTexture ? (
            <img
              src={coverTexture}
              alt=""
              aria-hidden="true"
              className="cover-texture-overlay"
              draggable={false}
            />
          ) : null}
        </div>
        <div className="cover-side cover-side-back" aria-hidden="true">
          <PageCanvas pdf={pdf} pageNumber={pageNumber} zoom={zoom} />
          {isFrontCover && coverTexture ? (
            <img
              src={coverTexture}
              alt=""
              aria-hidden="true"
              className="cover-texture-overlay"
              draggable={false}
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`flipbook-page${className ? ` ${className}` : ""}`}>
      <PageCanvas pdf={pdf} pageNumber={pageNumber} zoom={zoom} />
    </div>
  );
});

export function FlipbookViewer() {
  const [meta, setMeta] = useState<ViewerDocumentPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentLike | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [jumpValue, setJumpValue] = useState("1");
  const [zoom, setZoom] = useState(0.5);
  const [bookMode, setBookMode] = useState<BookMode>("landscape");
  const [frontCoverTexture, setFrontCoverTexture] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const isDesktop = useIsDesktop(1024);
  const isSafari = useIsSafari();
  const pdfJsRef = useRef<PdfJsModuleLike | null>(null);
  const bookRef = useRef<FlipBookRefLike | null>(null);
  const { snapshot: flipSnapshot, reset: resetFlipState, handleEngineState, requestProgrammaticTurn } =
    useFlipState();

  const ensureHardBoundaryCovers = useCallback(() => {
    const pageFlip = bookRef.current?.pageFlip?.();
    if (!pageFlip) return;
    const pageCount = pageFlip.getPageCount();
    if (pageCount <= 0) return;

    try {
      pageFlip.getPage(0).setDensity("hard");
    } catch {
      // no-op guard for transient engine state
    }

    if (pageCount > 1) {
      try {
        pageFlip.getPage(pageCount - 1).setDensity("hard");
      } catch {
        // no-op guard for transient engine state
      }
    }
  }, []);

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
        setFrontCoverTexture(null);
        resetFlipState();
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
  }, [resetFlipState]);

  const allPages = useMemo(() => {
    if (!pdfDoc) return [];
    return Array.from({ length: pdfDoc.numPages }, (_value, index) => index + 1);
  }, [pdfDoc]);

  const onFlip = useCallback((event: { data?: number }) => {
    const nextPage = Number(event?.data ?? 0) + 1;
    if (!Number.isFinite(nextPage) || nextPage < 1) {
      return;
    }
    setCurrentPage(nextPage);
    setJumpValue(String(nextPage));
  }, []);

  const setCoverTexture = useCallback((dataUrl: string) => {
    setFrontCoverTexture((current) => (current === dataUrl ? current : dataUrl));
  }, []);

  const onBookInit = useCallback((event: { data?: { page?: number; mode?: BookMode } }) => {
    ensureHardBoundaryCovers();

    resetFlipState();
    const pageIndex = Number(event?.data?.page ?? 0);
    const nextPage = Number.isFinite(pageIndex) ? pageIndex + 1 : 1;
    setCurrentPage(Math.max(1, nextPage));
    setJumpValue(String(Math.max(1, nextPage)));
    if (event?.data?.mode) {
      setBookMode(event.data.mode);
    }
  }, [ensureHardBoundaryCovers, resetFlipState]);

  const onChangeOrientation = useCallback((event: { data?: BookMode }) => {
    if (event?.data === "portrait" || event?.data === "landscape") {
      setBookMode(event.data);
    }
  }, []);

  const onChangeState = useCallback(
    (event: { data?: unknown }) => {
      const state = event?.data;
      if (
        state === "user_fold" ||
        state === "fold_corner" ||
        state === "flipping" ||
        state === "read"
      ) {
        handleEngineState(state as EngineFlipState);
      }
    },
    [handleEngineState],
  );

  const requestBookTurn = useCallback(
    (turn: (api: PageFlipApi) => void, fallback: () => void) => {
      const pageFlip = bookRef.current?.pageFlip?.();
      if (!pageFlip) {
        fallback();
        return;
      }
      requestProgrammaticTurn(() => turn(pageFlip));
    },
    [requestProgrammaticTurn],
  );

  function goNext(): void {
    if (!pdfDoc) return;
    if (currentPage === 1 && frontCoverTexture === null) return;
    const pageFlip = bookRef.current?.pageFlip?.();
    if (pageFlip) {
      const index = pageFlip.getCurrentPageIndex();
      const pageCount = pageFlip.getPageCount();
      if (index >= pageCount - 1) {
        return;
      }
    } else if (currentPage >= pdfDoc.numPages) {
      return;
    }
    requestBookTurn(
      (pageFlip) => pageFlip.flipNext("top"),
      () => {
        const next = Math.min(currentPage + 1, pdfDoc.numPages);
        setCurrentPage(next);
        setJumpValue(String(next));
      },
    );
  }

  function goPrev(): void {
    if (!pdfDoc) return;
    const pageFlip = bookRef.current?.pageFlip?.();
    if (pageFlip) {
      if (pageFlip.getCurrentPageIndex() <= 0) {
        return;
      }
    } else if (currentPage <= 1) {
      return;
    }
    requestBookTurn(
      (pageFlip) => pageFlip.flipPrev("top"),
      () => {
        const next = Math.max(1, currentPage - 1);
        setCurrentPage(next);
        setJumpValue(String(next));
      },
    );
  }

  function jumpToPage(): void {
    if (!pdfDoc) return;
    const parsed = Number.parseInt(jumpValue, 10);
    if (Number.isNaN(parsed)) return;
    const page = Math.max(1, Math.min(parsed, pdfDoc.numPages));
    if (currentPage === 1 && page > 1 && frontCoverTexture === null) return;
    requestBookTurn(
      (pageFlip) => pageFlip.flip(page - 1, "top"),
      () => {
        setCurrentPage(page);
        setJumpValue(String(page));
      },
    );
  }

  const gestureHandlers = useFlipGestures({
    enabled: !flipSnapshot.locked && (currentPage !== 1 || frontCoverTexture !== null),
    getEngine: () => bookRef.current?.pageFlip?.() ?? null,
    onNavigate: (intent) => {
      if (intent === "next") {
        goNext();
        return;
      }
      goPrev();
    },
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, []);

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
      <main className="page-shell viewer-shell">
        <div className="panel mono">Loading portfolio...</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page-shell viewer-shell">
        <div className="panel danger mono">{error}</div>
      </main>
    );
  }

  if (!pdfDoc || !meta) {
    return (
      <main className="page-shell viewer-shell">
        <div className="panel mono">No portfolio available.</div>
      </main>
    );
  }

  const isFrontCoverCentered =
    bookMode === "landscape" && currentPage === 1 && flipSnapshot.phase === "idle";
  const coverReadyForTurn = currentPage !== 1 || frontCoverTexture !== null;
  const canGoPrev = !flipSnapshot.locked && currentPage > 1;
  const canGoNext = !flipSnapshot.locked && currentPage < pdfDoc.numPages && coverReadyForTurn;
  const bookWidth = isDesktop ? (isSafari ? 378 : 420) : 620;
  const bookHeight = isDesktop ? (isSafari ? 535 : 594) : 877;
  const bookMaxWidth = isDesktop ? (isSafari ? 504 : 560) : 820;
  const bookMaxHeight = isDesktop ? (isSafari ? 711 : 790) : 1160;

  return (
    <main className="page-shell viewer-shell">
      <div className="toolbar">
        <button type="button" onClick={goPrev} disabled={!canGoPrev}>
          Prev
        </button>
        <button type="button" onClick={goNext} disabled={!canGoNext}>
          Next
        </button>
        <input
          value={jumpValue}
          onChange={(event) => setJumpValue(event.target.value)}
          onBlur={jumpToPage}
          disabled={flipSnapshot.locked}
          style={{ width: "4.4rem" }}
          aria-label="Jump to page"
        />
        <button type="button" onClick={jumpToPage} disabled={flipSnapshot.locked}>
          Jump
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(0.25, value - 0.1))}>
          -
        </button>
        <span className="mono">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(8, value + 0.1))}>
          +
        </button>
        <button type="button" onClick={() => setZoom(0.5)}>
          50%
        </button>
        <button type="button" onClick={toggleFullscreen}>
          Fullscreen
        </button>
        <div className="status mono">
          {currentPage}/{pdfDoc.numPages} • {bookMode === "landscape" ? "Spread" : "Single"} •{" "}
          {bytesToLabel(meta.fileSize)} • {flipSnapshot.phase}
          {flipSnapshot.hasPendingTurn ? " • queued" : ""}
        </div>
      </div>

      <section className="viewer-stage" aria-live="polite">
        <div
          className={`flipbook-shell${isFrontCoverCentered ? " front-cover-centered" : ""}`}
          {...gestureHandlers}
        >
          <HTMLFlipBook
            ref={bookRef}
            width={bookWidth}
            height={bookHeight}
            size="stretch"
            minWidth={140}
            maxWidth={bookMaxWidth}
            minHeight={200}
            maxHeight={bookMaxHeight}
            drawShadow={!reducedMotion}
            flippingTime={reducedMotion ? 300 : 900}
            usePortrait={false}
            startPage={0}
            startZIndex={1}
            autoSize
            maxShadowOpacity={0.35}
            showCover
            mobileScrollSupport
            clickEventForward
            useMouseEvents={false}
            swipeDistance={30}
            showPageCorners={false}
            disableFlipByClick
            className="flipbook"
            style={{}}
            renderOnlyPageLengthChange
            onFlip={onFlip}
            onInit={onBookInit}
            onChangeOrientation={onChangeOrientation}
            onChangeState={onChangeState}
          >
            {allPages.map((page) => (
              <FlipPage
                key={page}
                pdf={pdfDoc}
                pageNumber={page}
                zoom={zoom}
                className={page === 1 || page === allPages.length ? "cover-face" : undefined}
                doubleSided={page === 1 || page === allPages.length}
                isFrontCover={page === 1}
                coverTexture={page === 1 ? frontCoverTexture : null}
                onCoverBitmap={page === 1 ? setCoverTexture : undefined}
              />
            ))}
          </HTMLFlipBook>
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
