Architecture Flipbook Implementation Plan

Project objective
- Build and deploy a single-owner architecture flipbook on Vercel.
- Use `portfolio.pdf` as the first real test asset.
- Preserve drawing fidelity, enforce black stage, and avoid center crease artifacts.

Scope baseline (from MVP)
- Max upload size: 70MB.
- Max pages: 300.
- Max page dimension: 10000px long side.
- Browser matrix: Chrome >= 121, Safari >= 17, Firefox >= 122, Edge >= 121.

Phase 0: Repository and platform bootstrap
Deliverables
- Next.js App Router project with TypeScript.
- Core dependencies: `pdfjs-dist`, flip engine library (or custom), upload SDK, queue client.
- Environment variable template and runtime validation.
- Vercel project linked with preview deployments enabled.

Tasks
- Scaffold app and base routing (`/viewer`, `/admin/upload`).
- Configure static worker asset path for `pdf.js`.
- Add global theme tokens with mandatory black stage (`#000000`).
- Add CI checks: typecheck, lint, unit tests.

Exit criteria
- App deploys to Vercel preview successfully.
- `pdf.js` worker loads in production build.

Phase 1: Viewer foundation (no compression yet)
Deliverables
- PDF open/render flow with page navigation and zoom/pan.
- Single-page mobile and two-page desktop spread behavior.
- Center seam neutral in idle state.

Tasks
- Build PDF data layer (document loading, page metadata, render scheduler).
- Implement viewer controls: next/prev, jump, zoom presets, fullscreen.
- Implement render cache with budget-based eviction.
- Implement seam artifact guardrails and transparent-page white backing.

Exit criteria
- `portfolio.pdf` renders reliably in preview deployment.
- No persistent center gutter line at idle across browser matrix.

Phase 2: Flip interaction and performance hardening
Deliverables
- Page-curl flip interaction with deterministic state machine.
- Reduced-motion and low-power fallback transitions.
- Performance telemetry wired to key viewer metrics.

Tasks
- Implement interaction states: idle, hover, grabbing, dragging, settling, canceled.
- Add gesture arbitration (pinch/pan vs flip).
- Add degradation tier logic with hysteresis.
- Measure and optimize for FPS and input latency budgets.

Exit criteria
- Meets animation/input SLOs on reference desktop and mobile devices.
- Reduced-motion mode passes functional parity checks.

Phase 3: Upload and compression pipeline
Deliverables
- Admin-only upload endpoint and direct-to-storage upload path.
- Async compression job pipeline with original/optimized outputs.
- Quality and size gates before publish.

Tasks
- Build `/admin/upload` auth gate (single-owner token/session).
- Upload `original.pdf` to object storage with metadata.
- Enqueue compression job in Redis queue.
- Worker service executes structural optimization + image optimization.
- Run publish gates:
- Text extraction parity on sample pages.
- Visual diff <= 1.0% non-background pixels at 150 DPI.
- If size reduction is insignificant, keep original as serving asset.
- Publish `optimized.pdf` and persist status transitions.

Exit criteria
- 70MB file upload and processing succeeds in preview environment.
- Compression SLO target is met or fallback path works correctly.

Phase 4: Security and reliability completion
Deliverables
- Strict upload and hosted-import controls.
- Recovery paths for failures and stale jobs.
- Document delivery with range-request support.

Tasks
- Enforce file signature/type/size/page limits server-side.
- If hosted URL import enabled: allowlist + HTTPS + redirect/time/size/IP guards.
- Add rate limits for upload and compression job creation.
- Add retry policy and dead-letter handling.
- Add orphaned artifact cleanup schedule.
- Validate storage delivery supports `Accept-Ranges` / `206`.

Exit criteria
- Security checks pass for all ingestion paths.
- First interaction does not require full-file download.

Phase 5: QA, launch readiness, and production release
Deliverables
- Full acceptance run against MVP gates.
- Vercel production deployment with observability and rollback readiness.

Tasks
- Run visual regressions across zoom and DPR.
- Run seam and black-stage tests in windowed and fullscreen modes.
- Run 30-minute soak test and compression reliability tests.
- Verify preview-to-prod parity and environment configuration.
- Deploy to production and monitor first-session telemetry.

Exit criteria
- All MVP acceptance criteria are satisfied.
- Production deployment is stable with no blocker issues.

Immediate execution order (start now)
1. Scaffold Next.js app and baseline routing.
2. Wire `pdf.js` worker and render `portfolio.pdf` in `/viewer`.
3. Implement black-stage viewer shell with zoom/nav controls.
4. Add seam artifact checks and browser smoke tests.
5. Build admin upload + object storage integration.
6. Add queue + worker compression pipeline.

Open decisions to lock before coding day 1
- Flip engine choice: `StPageFlip` vs custom implementation.
- Storage provider: Vercel Blob vs S3-compatible bucket.
- Worker host for compression: Fly.io vs Render vs Railway.
- Hosted URL import for v1: enabled or deferred.
