# Cinematic Pointer Agent Operating Guide

> Last Updated: 2026-11-20

<!-- MADFAM-AGENTS-CANONICAL v1 -->

This is the canonical instruction file for Claude, Codex, and any other LLM
agent working in this repository. `CLAUDE.md` is kept only as a compatibility
redirect and should not become the source of truth again.

## Required operating doctrine

- Read this file before making repo changes.
- Prefer existing repo conventions, scripts, and docs over introducing new
  patterns.
- Preserve user work and never revert unrelated changes.
- Treat production operations as Enclii-first: use Enclii web, API, or CLI for
  provisioning, deployment, observability, domains, secrets, provider
  operations, scaling, rollback, and remediation.
- Use direct `kubectl`, `helm`, SSH, provider CLIs/APIs, `docker exec`, or
  direct container access only for platform bootstrap or documented break-glass
  emergencies when Enclii is unavailable or lacks an implemented adapter.
- Record any missing Enclii adapter gap instead of normalizing raw production
  access in docs or runbooks.

## What this repository is

Cinematic Pointer replays a scripted journey in a real browser, records it with a cursor overlay, and
edits the recording into a trailer. Inside MADFAM it produces the trailers for the public pages of
MADFAM's products and their tiers (SKUs). It is a command-line tool. The one thing deployed from this
repository is its landing at `trailer.madfam.io` (see [The landing](#the-landing)).

## Boundary

This repository is **public**. Read [`docs/REPO_BOUNDARY.md`](./docs/REPO_BOUNDARY.md) before adding a
journey, a document or a fixture. The short form: public, signed-out pages of MADFAM's own products only;
no secrets, no node identity, no client hosts, no hand-typed prices, no committed recordings. The canonical
policy is the MADFAM repo-boundary contract, kept in MADFAM's private ops repository. Licensing,
visibility, naming and publishing rulings belong to the owner: prepare them, never take them.

## The landing

`site/` is the landing served at `https://trailer.madfam.io` (owner direction, 2026-11-19): a
dependency-free Node server (`site/server/`) and one page in Spanish and English (`site/web/`). It is
deployed through Enclii, dispatch-only; [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) is the contract.

- Host names sit one level under `madfam.io` and are never nested. A later surface takes a hyphenated
  name (`trailer-api.madfam.io`, `trailer-admin.madfam.io`); only the landing exists, and each new name
  needs the owner's word.
- The page is unindexed until the owner says otherwise (`INDEXABLE` in `site/server/config.mjs`).
- [`PRODUCT.md`](./PRODUCT.md) and [`DESIGN.md`](./DESIGN.md) are the product and visual records. Every
  change to the page goes through the impeccable design flow, with its telemetry off, and keeps the
  direction recorded in `.impeccable/surfaces/`.
- The page states only what the tool does today. Work in progress is labelled as such, never shown as
  shipped. No invented metric, no price, no client name.
- `site/web/footage/` holds stills and one clip of a real take, by the owner's permission. It is the
  one exception to "no committed recordings"; adding footage of another page needs the owner's word
  and a line in `site/web/footage/SOURCE.json`.
- Checks: `node --test site/server/test/*.test.mjs` (CI runs it). Preview: `node site/server/dev.mjs`.
- `site/Dockerfile` is the landing's image. The `Dockerfile` at the root is the command-line image.

## Licence

AGPL-3.0-only (owner ruling 2026-11-17), holder Innovaciones MADFAM S.A.S. de C.V. See `LICENSE` and
`NOTICE`. Do not add a dependency whose licence is incompatible with AGPL-3.0-only.

## Trailer catalog

| Path                               | What                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog/products.json`            | GENERATED. The filmable products (live or beta, with a public host) and their tier slugs, from MADFAM's public product projection. Refresh with `node scripts/refresh-catalog.mjs <projection.public.json>`; never hand-edit. Products that are not filmed are listed under `skipped` with the reason |
| `catalog/pricing-pages.json`       | Hand-kept. A product gets a pricing trailer only when its public pricing page is listed here                                                                                                                                                                                                          |
| `journeys/generated/`              | GENERATED by `npm run catalog:generate`. One landing tour per product, one pricing tour per listed pricing page. `npm run catalog:check` fails on a missing, stale or orphaned file (CI runs it)                                                                                                      |
| `journeys/*.cinematicpointer.json` | Hand-written example journeys                                                                                                                                                                                                                                                                         |

Slugs follow the ecosystem standard: product slugs are kebab-case, tier slugs are snake_case, and a SKU is
`<product>__<tier>`. A product whose slug breaks the standard is skipped, not renamed here.

Generated journeys only read a page: they pause, scroll and mark. They never click, fill or navigate, so
a batch cannot sign up, submit a form or reach a checkout. Keep that property; a test enforces it.

```bash
npm run produce -- --dry-run                 # list what would be filmed
npm run produce -- --filter '^dhanam\.'      # film a subset (regex on the trailer id)
npm run produce                              # film everything, one trailer at a time
```

**Page tiles.** `capture page <url>` writes the full length of a page as PNG tiles plus
`manifest.json` (schema `cinematic-pointer/page-tiles@1`: URL, capture time, page size, tile grid, each
tile's place and bytes, landmarks). It is read-only: it scrolls and looks, and clicks nothing. Tiles
default to 2048 px; edge tiles are smaller and none is padded. A page taller than `--max-height`
(60000 px) is cut off and the manifest says `truncated: true`. The command exits 1 when every tile is
a flat colour and 2 on any error: an HTTP error page, a page that changes height mid-capture, a URL
that is not http(s). Each run first removes the tiles and manifest already in `--out`. A captured page is someone's work: capture MADFAM's own public pages only, and never
commit a capture (`captures/` is ignored).

```bash
npx tsx src/cli.ts capture page https://enclii.dev/ --out captures/enclii
```

`--allow-hosts enclii.dev,.madfam.io` turns on the egress guard (`src/cinema/egress.ts`), for captures run
on our own infrastructure. Chromium only. The browser is started behind a forwarding proxy inside this
process, so every connection it makes (a redirect, a frame, a popup, a preconnect) is checked the same
way: https on port 443 only, no IP literal, no local name, and no name that resolves to an address
that is not public. The proxy connects to the address it checked, so a name cannot answer one thing to
the check and another to the connection. On top of that the page itself must stay on a listed host (an
entry is exact; a leading dot means any subdomain): a capture whose page leaves the list, for example
through a redirect, is failed and its pictures are deleted. Other public hosts stay reachable as
sub-resources. WebSockets are closed, and WebRTC, shared workers and service-worker registration are removed from the page. The
manifest records the list and the first 200 refusals. The network policy around the process remains
the outer stop.

**Export.** `export <video>` writes one take to a matrix of formats (`mp4`, `webm`, `hevc`, `gif`,
`prores`) and aspects (`16:9`, `9:16`, `1:1`, `4:5`, `4:3`, `21:9`), plus any `--platforms` presets, and
`export.json` (schema `cinematic-pointer/export@1`). Each output is measured before it is listed: size
in bytes, length against the take, the dimensions of its aspect, its codec, sound when the take has
sound, and two frames that differ. A file that fails a measurement is deleted and listed under `failed`
with the reason. The manifest also says whether this FFmpeg build can burn captions. Exit 0 when every
target passed, 1 when any failed, 2 when the export could not run at all. A platform preset contributes
its format and aspects only: its own quality and its size and length limits are not applied or checked.
Unknown formats, aspects and
platforms are errors, never a default. Outputs are 1080-class (a 16:9 export is 1920x1080), so a
smaller take is scaled up, and other aspects are a centre crop.

```bash
npx tsx src/cli.ts export take.mp4 --formats mp4,webm --aspects 16:9,9:16 --out exports/take
```

**Image.** `ghcr.io/madfam-org/cinematic-pointer` is the CLI with Chromium and FFmpeg inside, for
unattended runs (CEQ's CPU worker is built on it). `.github/workflows/image.yml` builds it on every pull
request that touches it, and on `main` publishes it and signs the digest with cosign. The Dockerfile's
last step is a self-test, run as the runtime user (uid 1001): the CLI starts, the native modules load,
FFmpeg answers and Chromium opens a page, so an image that cannot do its job is never published. Pin
the digest the publish job prints, never a tag. Chromium runs without its own sandbox inside the
container (Playwright's default), so the container and the network policy around it are the boundary.

```bash
docker run --rm -v "$PWD/out:/work" ghcr.io/madfam-org/cinematic-pointer@sha256:<digest> \
  capture page https://enclii.dev/ --out /work/enclii
```

Outputs are written as uid 1001. When mounting a host directory on Linux, make it writable by that
user or pass `--user "$(id -u)"`. Paths such as `--catalog` default to the working directory, so name
them (`/opt/cinematic-pointer/catalog/products.json`) when running from `/work`.

**Estate tour.** `tour` films a flight past each product's captured page (RFC 0061 §4b). It reads one
`capture page` output per product from `<captures>/<slug>/`, stands each page in space as a tall panel,
one row per registry stack layer (soil lowest; `catalog/products.json` now carries `layer`), and flies
the camera to each panel and down it. The direction is plain data computed in `src/tour/layout.ts`
(panels, shots, camera samples), so it is tested without a browser; the page built by
`src/tour/stage.ts` only draws it with three.js, which is bundled in, and implements the stage contract.
A page taller than four panel-widths is cut and marked `cropped`. `tour.json` records what drew the
frames (`renderer`), the shots, products with no capture, and the time per picture. `--software` draws
WebGL on the CPU, as a machine without a GPU does; `--seconds n` films a timed sample.

```bash
npx tsx src/cli.ts capture page https://enclii.dev/ --out captures/enclii
npx tsx src/cli.ts tour --only enclii --draft --viewport 1280x720 --out exports/tour
```

**Recorders.** `produce --recorder` picks how a trailer is filmed:

| Recorder            | What it makes                                                                                                                                                                                                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stepped` (default) | A plain eased scroll of the page, frame by frame                                                                                                                                                                                                                                           | No overlay, no captions, no sound                                                                                                                                                                                                                                                                                                                           |
| `cinematic`         | A shot list over one still of the page: title card, tilted push-in on the headline, a montage of sections, a close on the page's primary call to action, an end card, with the pointer as the lead (see below); 24 fps with motion blur, letterbox, grain, a grade and a synthesized score | The page is a still, so nothing on it moves. Sound is generated by FFmpeg from oscillators and noise; there is no sample to license. `--no-score` leaves it silent. `--draft` drops motion blur (one picture per frame instead of five) for a machine that cannot finish a full take; `results.json` marks it `quality: draft` and it is not for publishing |
| `realtime`          | The live page with the cursor overlay and the FFmpeg edit                                                                                                                                                                                                                                  | Depends on the machine keeping up in real time                                                                                                                                                                                                                                                                                                              |

**The pointer.** A cinematic take has a pointer in it by default (`src/pointer/`). It lives in the page's
3D space, enters each shot, reads the headline (a persona that does not read rests under it), visits each section, and presses the call to action in
the closing shot; it stays off the title and end cards. A persona decides its manner and its outfits:
`--persona guide|operator|analyst|explorer|maker` or a validated `.json` file; `--no-pointer` films
without it. The eight outfits are drawn in this repository (never copied from a stock icon set). The
closing shot and the press go to the page's primary call to action: among the lowest row of filled
buttons, the one whose fill stands out most from what is behind it (`weight`, recorded by
`capture page`), leftmost on a tie; buttons in fixed or sticky bars are never candidates. Only
cinematic takes use the pointer; `stepped`, `realtime` and the tour do not. See `docs/EXAMPLES.md`.

`stepped` and `cinematic` draw each frame at their own pace, so a slow or paused machine gives the same
take. Both run on a CPU alone. The cinematic stage implements the stage contract
(`window.__stage.ready`, `.duration`, `.seek(t)`) and must stay a pure function of time: no clock, no
unseeded randomness. A test enforces it.

`produce` writes `exports/<trailer-id>/` and `exports/results.json` (schema
`cinematic-pointer/results@1`). A trailer counts as rendered only when its start page answered 2xx, every
step ran, and each output file was measured (bytes, seconds, dimensions). The command exits 0 only when
everything selected rendered, 1 on any failure, and 2 when the filter selected nothing: an empty run is
never reported as a clean one.

## Checks

| Check                              | Runs in CI    | Command                                                           |
| ---------------------------------- | ------------- | ----------------------------------------------------------------- |
| Typecheck, lint, format            | yes           | `npm run typecheck && npm run lint && npm run format:check`       |
| Catalog journeys match the catalog | yes           | `npm run catalog:check`                                           |
| Unit tests                         | yes           | `npm test`                                                        |
| Landing server and deploy contract | yes           | `node --test site/server/test/*.test.mjs`                         |
| End-to-end (Playwright)            | **no, local** | `npm run test:e2e` (needs browsers)                               |
| A real recording and render        | **no, local** | `npm run produce -- --filter <id>` (needs browsers and FFmpeg 6+) |

The runners carry no browsers and no FFmpeg. When a change touches recording or post-production, run the
local checks and paste the `produce:` summary line into the pull request. A skipped check is not a pass.

## Known gaps (2026-11-17)

- `run --brand <theme>` is accepted but not applied: the brand themes in `src/themes/` are not yet wired
  to the cursor overlay or the edit.
- Generated tours are generic (scroll and mark). Close-ups of one tier card need a hand-written journey.
- The legacy section below predates these sections and wins nothing where the two disagree.

## Repo entrypoints

- `README.md`
- `docs/` ([`REPO_BOUNDARY.md`](./docs/REPO_BOUNDARY.md), `API.md`, `EXAMPLES.md`)
- `catalog/`, `journeys/`
- `.github/workflows/`

## LLM context files

- `llms.txt` is the compact context index.
- `llms-full.txt` is the durable full-context map and operating contract.
- `AGENTS.md` is canonical for agent instructions.
- `CLAUDE.md` redirects here for Claude compatibility.

## Maintenance

Regenerate or repair these files with
`internal-devops/scripts/sync-agent-docs.py` from the labspace ecosystem.

---

## Legacy CLAUDE.md guidance imported on 2026-11-17

<!-- BEGIN LEGACY_CLAUDE_IMPORT -->

# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Cinematic Pointer is an automated system that replays preplanned user journeys on the web and produces polished, cinematic videos where the cursor is the protagonist. Designed for product demos, instructional videos, and storytelling at scale.

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLI (src/cli.ts)                          │
├─────────────────────────────────────────────────────────────────┤
│  run          │   cut           │   reframe      │   doctor     │
├───────────────┼─────────────────┼────────────────┼──────────────┤
│               │                 │                │              │
│  ┌─────────┐  │  ┌───────────┐  │  ┌──────────┐  │  ┌────────┐  │
│  │Executor │  │  │ Pipeline  │  │  │ Reframe  │  │  │ Health │  │
│  └────┬────┘  │  └─────┬─────┘  │  └────┬─────┘  │  └────────┘  │
│       │       │        │        │       │        │              │
│  ┌────┴────┐  │  ┌─────┴─────┐  │  ┌────┴─────┐  │              │
│  │ Driver  │  │  │  FFmpeg   │  │  │  FFmpeg  │  │              │
│  │Playwright│  │  │  Effects  │  │  │  Smart   │  │              │
│  └────┬────┘  │  │  Captions │  │  │  Crop    │  │              │
│       │       │  │  Export   │  │  └──────────┘  │              │
│  ┌────┴────┐  │  └───────────┘  │                │              │
│  │Recorder │  │                 │                │              │
│  │ Overlay │  │                 │                │              │
│  └─────────┘  │                 │                │              │
└───────────────┴─────────────────┴────────────────┴──────────────┘
```

### Module Overview

| Module          | Location         | Purpose                            |
| --------------- | ---------------- | ---------------------------------- |
| CLI             | `src/cli.ts`     | Command-line interface entry point |
| Executor        | `src/executor/`  | Journey parsing and step execution |
| Driver          | `src/drivers/`   | Browser automation (Playwright)    |
| Recorder        | `src/recorders/` | Video capture implementations      |
| Overlay         | `src/overlay/`   | Cursor effects injection           |
| Post-Production | `src/postprod/`  | FFmpeg video processing            |
| Themes          | `src/themes/`    | Brand theming system               |
| Utils           | `src/utils/`     | Shared utilities                   |
| Types           | `src/types/`     | TypeScript definitions             |

### Key Interfaces

```typescript
// Driver - Browser automation abstraction
interface Driver {
  init(meta: Meta): Promise<void>;
  goto(url: string): Promise<void>;
  click(sel: Selector): Promise<void>;
  fill(sel: Selector, text: string, mask?: boolean): Promise<void>;
  hover(sel: Selector): Promise<void>;
  scroll(to: ScrollTarget): Promise<void>;
  press(key: string): Promise<void>;
  waitFor(condition: Condition): Promise<void>;
  teardown(): Promise<void>;
}

// Recorder - Video capture abstraction
interface Recorder {
  start(meta: Meta): Promise<void>;
  mark(event: UesEvent): void;
  stop(): Promise<RecordingArtifacts>;
}

// UesEvent - Universal Event Schema
interface UesEvent {
  ts: number; // Timestamp in ms
  t: string; // Event type
  to?: number[]; // Target coordinates
  from?: number[]; // Source coordinates
  // ... additional properties per event type
}
```

## Development Setup

### Quick Setup

```bash
./scripts/setup.sh
```

### Manual Setup

```bash
npm install
npx playwright install
npm run prepare  # Setup Husky hooks
npm run build
```

### System Dependencies

- Node.js ≥ 20 (see `.nvmrc`)
- FFmpeg ≥ 6.0
- Optional: OBS with WebSocket plugin

## Development Scripts

```bash
npm run dev          # Development mode with hot reload
npm run build        # Build TypeScript to JavaScript
npm run test         # Run unit tests (Jest)
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage
npm run test:e2e     # Run E2E tests (Playwright)
npm run lint         # Check code with ESLint
npm run lint:fix     # Auto-fix ESLint issues
npm run format       # Format code with Prettier
npm run format:check # Check formatting
npm run typecheck    # Run TypeScript type checking
```

## CLI Commands

### `run` - Execute a Journey

```bash
cinematic-pointer run <journey.json> \
  --browser=chromium \
  --recorder=playwright \
  --out=artifacts \
  --brand=madfam_trailer \
  --headed
```

### `cut` - Post-Production

```bash
cinematic-pointer cut <video.webm> <events.ndjson> \
  --template=trailer \
  --music=assets/uplift_a.mp3 \
  --captions=auto \
  --aspect=16:9 \
  --quality=high \
  --out=exports/output.mp4
```

### `reframe` - Aspect Conversion

```bash
cinematic-pointer reframe <video.mp4> \
  --aspect=9:16 \
  --smart-crop \
  --events=events.ndjson \
  --quality=standard
```

### `doctor` - System Health Check

```bash
cinematic-pointer doctor --json
```

## Journey DSL Format

Journeys are defined in `.cinematicpointer.json` files:

```json
{
  "meta": {
    "name": "string",
    "description": "string",
    "viewport": { "w": 1440, "h": 900 }
  },
  "start": { "url": "https://example.com" },
  "steps": [
    {
      "action": "click|fill|scroll|hover|press|waitFor|cameraMark|pause",
      "locator": { "role": "button", "name": "Submit" },
      "cinema": { "beat": "impact", "ripple": true, "zoom": 1.2 }
    }
  ],
  "output": {
    "preset": "trailer|howto|teaser",
    "aspect": "16:9|1:1|9:16",
    "music": "track_name",
    "captions": true
  }
}
```

### Step Actions

| Action       | Required Props         | Optional Props                 |
| ------------ | ---------------------- | ------------------------------ |
| `click`      | `locator`              | `button`, `cinema`             |
| `fill`       | `locator`, `text`      | `mask`, `cinema`               |
| `hover`      | `locator`              | `cinema`                       |
| `scroll`     | `to`                   | `durationMs`                   |
| `press`      | `key`                  | -                              |
| `waitFor`    | `locator` or condition | `timeoutMs`                    |
| `cameraMark` | -                      | `zoom`, `target`, `durationMs` |
| `pause`      | `durationMs`           | -                              |
| `navigate`   | `to` (URL)             | `waitFor`                      |

## Locator Strategy Priority

1. **Accessibility**: `role`, `name`, `label`, `placeholder`
2. **Test IDs**: `data-testid`
3. **CSS/XPath fallback**: `by: "css"`, `by: "xpath"`

```typescript
// Resolution order in src/utils/selector.ts
const strategies = [
  resolveByRole,
  resolveByLabel,
  resolveByPlaceholder,
  resolveByText,
  resolveByTestId,
  resolveByCss,
  resolveByXPath,
];
```

## Post-Production Pipeline

### FFmpeg Module (`src/postprod/ffmpeg.ts`)

Fluent API for building FFmpeg commands:

```typescript
await ffmpeg()
  .overwrite()
  .input('input.webm')
  .filter('zoompan=z=1.2:d=100:s=1920x1080')
  .videoCodec('libx264')
  .crf(18)
  .preset('slow')
  .audioCodec('aac')
  .audioBitrate('192k')
  .output('output.mp4')
  .run({ onProgress: (seconds) => console.log(seconds) });
```

### Effects Module (`src/postprod/effects.ts`)

- `generateZoomPanFilter()` - Ken Burns effect
- `generateSpeedFilter()` - Speed ramps with setpts
- `generateFadeFilter()` - Fade in/out
- `generateMotionBlurFilter()` - Motion blur
- `generateAudioDuckingFilter()` - Audio ducking
- `generateColorGradeFilter()` - Color grading presets

### Caption Module (`src/postprod/captions.ts`)

- `generateASSSubtitles()` - ASS format with styling
- `generateSRTSubtitles()` - SRT format
- `generateVTTSubtitles()` - WebVTT format
- `exportCaptions()` - Export to any format

### Export Module (`src/postprod/export.ts`)

Multi-format export with platform presets:

```typescript
await exportVideo({
  inputPath: 'video.mp4',
  outputDir: 'exports/',
  formats: ['mp4', 'webm'],
  aspects: ['16:9', '9:16', '1:1'],
  quality: 'high',
});

await exportForPlatform('video.mp4', 'exports/', 'tiktok');
```

### Privacy Module (`src/postprod/privacy.ts`)

Blur maps for sensitive content:

```typescript
const config: BlurMapConfig = {
  regions: [
    {
      id: 'password-field',
      type: 'selector',
      selector: { placeholder: 'Password' },
      style: { type: 'blur', strength: 30 },
    },
  ],
  autoDetect: {
    passwords: true,
    creditCards: true,
  },
};
```

## Brand Theming (`src/themes/`)

### Theme Presets

- `default` - MADFAM brand colors
- `madfam_trailer` - High energy, cinematic
- `madfam_howto` - Clear, instructional
- `madfam_teaser` - Subtle, elegant
- `minimal` - Clean, no effects
- `dark` - Dark mode optimized
- `light` - Light mode optimized

### Theme Manager

```typescript
import { themeManager } from './themes';

// Use preset
themeManager.setTheme('madfam_trailer');

// Load custom theme
await themeManager.loadFromFile('./my-theme.json');

// Apply overrides
themeManager.applyOverrides({ cursor: { size: 32 } });

// Generate CSS
const css = themeManager.generateOverlayStyles();
```

## Testing Approach

### Unit Tests (`src/__tests__/`)

**644 tests across 22 test suites** covering:

- Captions: generation, formats (ASS/SRT/VTT), manipulation
- Effects: zoom, speed, fade, motion blur, audio ducking
- Export: multi-format output, platform presets
- Privacy: blur filter generation, selector matching
- FFmpeg: command builder, filter chains
- Templates: edit presets, quality settings
- Themes: preset validation, CSS generation
- Validation: input/file/URL/journey validation
- Selector: resolution strategies
- Errors: custom error classes, utilities
- Logger: structured logging
- Retry: exponential backoff with jitter
- Health: dependency checks
- UES: event emission, NDJSON I/O
- Time/Aspect/Colors: utility functions

### E2E Tests (`tests/e2e/`)

- Journey execution against real sites
- Overlay injection and effects
- CLI command execution
- Recording artifacts

### Running Tests

```bash
npm test                          # Unit tests
npm run test:coverage             # With coverage
npm run test:e2e                  # E2E tests
npm run test:e2e -- --project=chromium  # Single browser
```

### Coverage

| Metric     | Coverage |
| ---------- | -------- |
| Statements | ~54%     |
| Branches   | ~57%     |
| Functions  | ~67%     |
| Lines      | ~54%     |

**Note:** Remaining uncovered code requires integration tests (FFmpeg/Playwright) or uses dynamic imports.

## Error Handling

Custom error classes in `src/utils/errors.ts`:

```typescript
class CinematicPointerError extends Error
class ValidationError extends CinematicPointerError
class FileNotFoundError extends CinematicPointerError
class DependencyError extends CinematicPointerError
class ExecutionError extends CinematicPointerError
class TimeoutError extends CinematicPointerError
```

## Retry Logic

Exponential backoff with jitter in `src/utils/retry.ts`:

```typescript
import { withRetry, retryStrategies } from './utils/retry';

const result = await withRetry(
  async () => await riskyOperation(),
  retryStrategies.network,
  (attempt, error) => console.log(`Attempt ${attempt} failed`),
);
```

## Logging

Structured logging in `src/utils/logger.ts`:

```typescript
import { logger } from './utils/logger';

logger.info('Starting journey', { name: journey.meta.name });
logger.error('Step failed', error, { step: stepIndex });
```

Log levels: `debug`, `info`, `warn`, `error`

## Security & Privacy

- Secrets via environment variables only
- `mask: true` renders field values as bullets
- Blur maps redact sensitive regions
- Auto-detection for passwords, credit cards, emails

## Performance Targets

- 60-90s trailer renders in < 5 min (MacBook Pro class)
- 95% pass rate across supported journeys
- Automatic retry of flaky steps

## Code Style

- TypeScript strict mode
- ESLint with Prettier
- Import order: builtin → external → internal → relative
- Unused variables prefixed with `_`

## CI/CD

GitHub Actions workflows:

- `.github/workflows/ci.yml` - Lint, test, build, E2E
- `.github/workflows/release.yml` - Tagged releases, npm publish

<!-- END LEGACY_CLAUDE_IMPORT -->
