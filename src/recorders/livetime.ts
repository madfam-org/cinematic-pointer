/**
 * Live time
 *
 * Makes a live page's own motion frame-exact. The page's clock starts stopped at a fixed instant,
 * runs a fixed amount of page time while the page settles, and is then advanced by exactly one
 * frame interval per picture, so a three.js scene, a canvas loop or a
 * timer-driven carousel draws the same picture for frame `i` however long the machine takes.
 *
 * Three clocks are held:
 * - Script time: Playwright's clock replaces `Date`, `performance.now`, timers and
 *   `requestAnimationFrame`. Advancing it runs the page's frame callbacks for that interval.
 * - CSS and Web Animations: each animation is paused when first seen and set to its own start
 *   plus the take's elapsed time. Scroll-driven animations are left to follow the scroll.
 * - Video: each `<video>` is paused when first seen and sought to its start plus elapsed time.
 *
 * Limits, stated plainly: a page that draws from `Math.random`, from network timing, or from the
 * real GPU frame rate is not made deterministic by this. Load-time motion (before the clock stops)
 * runs on the wall clock.
 */
import { Page } from 'playwright';

/** In-page: pin every time-based animation and video to `ms` milliseconds into the take. */
const SYNC_SCRIPT = `(ms) => {
  const state = window.__cpLiveTime || (window.__cpLiveTime = { seen: new WeakMap() });
  for (const a of document.getAnimations()) {
    if (a.timeline && a.timeline !== document.timeline) continue;
    if (!state.seen.has(a)) {
      state.seen.set(a, { base: Number(a.currentTime) || 0, at: ms });
      a.pause();
    }
    const r = state.seen.get(a);
    try { a.currentTime = r.base + (ms - r.at); } catch (e) { /* an animation the page cancelled */ }
  }
  const seeks = [];
  for (const v of document.querySelectorAll('video')) {
    if (!state.seen.has(v)) {
      state.seen.set(v, { base: v.currentTime || 0, at: ms });
      v.pause();
    }
    const r = state.seen.get(v);
    let want = r.base + (ms - r.at) / 1000;
    if (v.duration && isFinite(v.duration)) {
      want = v.loop ? want % v.duration : Math.min(want, v.duration);
    }
    if (Math.abs(v.currentTime - want) > 0.0005 && v.readyState > 0) {
      seeks.push(new Promise((done) => {
        v.addEventListener('seeked', () => done(), { once: true });
        v.currentTime = want;
      }));
    }
  }
  return Promise.all(seeks).then(() => seeks.length);
}`;

/** Real milliseconds a video seek may take before the frame is taken without it. */
const SEEK_LIMIT_MS = 1500;

export interface LiveClock {
  /** Advance the page to `seconds` into the take. Never goes backwards. */
  advanceTo(seconds: number): Promise<void>;
}

/** Page time starts here on every take, so `Date` reads the same in every run. */
const EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0);
/** Page time is advanced in steps this long while the page settles. */
const SETTLE_STEP_MS = 100;
/** Real time allowed between settle steps, for the network to deliver what the page asked for. */
const SETTLE_GAP_MS = 40;

/**
 * Install before the first navigation. Page time starts stopped, at the same instant on every take,
 * so how long the machine takes to load the page never shifts the page's own animations.
 */
export async function installLiveTime(page: Page): Promise<void> {
  await page.clock.install({ time: EPOCH });
  await page.clock.pauseAt(EPOCH + 1);
}

/**
 * Let the loaded page run for exactly `seconds` of page time, in small steps with real gaps for the
 * network, then return a clock whose zero is that moment. Every take starts its first frame after
 * the same amount of page time, so the page's own motion starts in the same state.
 */
export async function settle(page: Page, seconds: number): Promise<LiveClock> {
  const total = Math.round(seconds * 1000);
  for (let run = 0; run < total; run += SETTLE_STEP_MS) {
    await page.clock.runFor(Math.min(SETTLE_STEP_MS, total - run));
    await new Promise((resolve) => setTimeout(resolve, SETTLE_GAP_MS));
  }
  let elapsed = 0;
  await sync(page, 0);
  return {
    async advanceTo(at: number) {
      const target = Math.round(at * 1000);
      if (target > elapsed) {
        await page.clock.runFor(target - elapsed);
        elapsed = target;
      }
      await sync(page, elapsed);
    },
  };
}

async function sync(page: Page, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SEEK_LIMIT_MS);
  });
  try {
    await Promise.race([page.evaluate(`(${SYNC_SCRIPT})(${ms})`), limit]);
  } finally {
    clearTimeout(timer);
  }
}
