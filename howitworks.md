# How The Current Build Works

## 1. What this app is now

This codebase is a static-file flipbook viewer built with Next.js.

- It does **not** run an upload pipeline.
- It does **not** run server-side PDF compression.
- It does **not** require admin auth.
- It renders one fixed source file: `public/portfolio-compressed.pdf`.

The user experience is:

1. Open `/viewer`
2. App fetches metadata from `/api/viewer/document`
3. Viewer loads and renders `portfolio-compressed.pdf` with PDF.js
4. User flips pages, zooms, jumps pages, toggles fullscreen

---

## 2. Project structure that matters

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/viewer/page.tsx`
- `src/app/api/viewer/document/route.ts`
- `src/components/viewer/FlipbookViewer.tsx`
- `src/app/globals.css`
- `scripts/copy-pdf-worker.mjs`
- `public/portfolio-compressed.pdf`
- `public/pdf.worker.min.mjs`
- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`

---

## 3. Build and runtime configuration

### `package.json`

Scripts:

- `npm run dev` -> `next dev`
- `npm run build` -> `next build`
- `npm run start` -> `next start`
- `npm run lint` -> `next lint`
- `npm run typecheck` -> `tsc --noEmit`
- `npm run copy-pdf-worker` -> copies PDF.js worker to `public/`
- `postinstall` runs `copy-pdf-worker`

Dependencies used at runtime:

- `next`
- `react`
- `react-dom`
- `pdfjs-dist`

### `next.config.ts`

- `reactStrictMode: true`
- `poweredByHeader: false`
- `outputFileTracingRoot` set to repo directory

### `tsconfig.json`

- Strict TypeScript mode
- Next.js plugin enabled
- Path alias `@/* -> src/*`

### `eslint.config.mjs`

- Minimal flat config
- Ignores generated/build files

---

## 4. Global compatibility behavior

There are multiple protections around `Promise.withResolvers` because PDF.js uses it and some browsers/environments do not provide it.

### 4.1 Early polyfill in document head

`src/app/layout.tsx` injects an inline `<script>` in `<head>` that defines `Promise.withResolvers` if missing.

This runs before app logic and protects initial client runtime.

### 4.2 Viewer-level fallback polyfill

`src/components/viewer/FlipbookViewer.tsx` also runs `ensurePromiseWithResolvers()` at module load and again before importing PDF.js.

This protects late-loaded/chunked execution paths.

### 4.3 Worker copy script also injects polyfill

`scripts/copy-pdf-worker.mjs` prepends a tiny `Promise.withResolvers` polyfill to `public/pdf.worker.min.mjs`.

Even though the viewer currently sets `disableWorker: true`, the worker file is still prepared with the polyfill.

---

## 5. Routing and request flow

### 5.1 Landing page (`/`)

`src/app/page.tsx` renders a simple entry panel with a link to `/viewer`.

### 5.2 Viewer page (`/viewer`)

`src/app/viewer/page.tsx` renders the client component `FlipbookViewer`.

### 5.3 Metadata API (`/api/viewer/document`)

`src/app/api/viewer/document/route.ts`:

1. Looks for `public/portfolio-compressed.pdf`
2. If missing: returns `404` JSON with `error`
3. If present: returns JSON:
   - `id`
   - `status: "ready"`
   - `fileSize`
   - `updatedAt` (file mtime)
   - `url: "/portfolio-compressed.pdf"`
   - `warning: null`

The API route runs in Node runtime (`runtime = "nodejs"`).

---

## 6. Viewer internals (`FlipbookViewer`)

File: `src/components/viewer/FlipbookViewer.tsx`

### 6.1 Startup sequence

On mount:

1. `fetch("/api/viewer/document")`
2. Validate response and store metadata in state
3. Dynamically import PDF.js module:
   - `pdfjs-dist/legacy/build/pdf.mjs`
4. Set `GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"`
5. Call `getDocument(...)` with:
   - `url` from API
   - `disableWorker: true`
   - streaming/autofetch enabled
6. Store loaded PDF document in state

### 6.2 Rendering model

- `useSpreadMode()`:
  - desktop (`min-width: 900px`): two-page spread
  - mobile: single page
- `currentPage` tracks left page in spread mode
- `visiblePages` computes one or two currently visible pages
- Each page is rendered by `PageCanvas`

### 6.3 Canvas render logic and race protection

`PageCanvas` does all page drawing on a `<canvas>`.

Protections against concurrent `render()` errors:

- `activeRenderTaskRef` stores currently running PDF.js render task
- `renderVersionRef` invalidates stale async render cycles
- Before a new render starts:
  - cancels previous task
  - waits for previous promise to settle
- Cleanup cancels active task
- Cancelled-render errors are filtered and not shown as user-facing errors

This prevents:

- `Cannot use the same canvas during multiple render() operations`

### 6.4 Controls

Toolbar provides:

- `Prev` / `Next`
- Page jump input + button
- Zoom `-` / `+` / `100%`
- Fullscreen toggle
- Status text: current page, mode (Spread/Single), file size

### 6.5 Flip effect

The flip effect is a lightweight CSS animation class:

- `flip-next`
- `flip-prev`

If user has reduced motion preference, animation is skipped.

---

## 7. Styling and visual behavior

File: `src/app/globals.css`

Visual direction:

- Full black stage/background (`#000`)
- Neutral dark UI chrome
- White page surface containers
- Responsive sizing for single/spread layouts
- Simple perspective rotation animations for turn feedback

Key layout classes:

- `.page-shell`
- `.toolbar`
- `.viewer-stage`
- `.spread.single` / `.spread.double`
- `.page-canvas-wrap`

---

## 8. Static asset model

### Required file

- `public/portfolio-compressed.pdf`

This is the only PDF the app serves.

### Worker asset

- `public/pdf.worker.min.mjs`

Generated by `npm run copy-pdf-worker` (also on `postinstall`).

---

## 9. How to update the shown PDF

Replace:

- `public/portfolio-compressed.pdf`

Then restart dev/build process as needed.

---

## 10. Current constraints and non-features

This current build intentionally does not include:

- Upload UI
- Compression queue
- Worker service
- Signed file URLs
- Multi-document selection
- Thumbnail rail
- Search
- Persistence layer

It is a single static flipbook viewer around one local PDF file.

---

## 11. End-to-end summary

At runtime, the app is:

1. Next.js shell + CSS
2. `/viewer` client component
3. API route returns metadata for one static PDF
4. PDF.js loads that file and renders pages to canvas
5. User interacts via page turn, zoom, jump, fullscreen
6. Polyfills guard `Promise.withResolvers` compatibility issues
