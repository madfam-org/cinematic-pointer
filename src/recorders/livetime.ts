/**
 * Live time
 *
 * Makes a live page's own motion frame-exact. The page's clock starts stopped at a fixed instant,
 * runs a fixed amount of page time while the page settles, and is then advanced by exactly one
 * frame interval per picture, so a three.js scene, a canvas loop or a
 * timer-driven carousel draws the same picture for frame `i` however long the machine takes.
 *
 * Four things are held:
 * - Script time: Playwright's clock replaces `Date`, `performance.now` and timers. It is only ever
 *   paused (never installed running), so every document starts at `performance.now() === 0` and
 *   `Date.now() === EPOCH`, however long the machine took between calls.
 * - Animation frames: `requestAnimationFrame` callbacks run exactly once per frame of the take,
 *   after that frame's timers, with `performance.now()` equal to the frame's time. Playwright's own
 *   frame callbacks only fire on a 16 ms grid, which at 30 fps gives a visible hitch every 12th
 *   frame. Only the top frame is held this way; frames inside iframes keep the 16 ms grid.
 * - CSS and Web Animations: each animation is paused by us and set to its own position, which
 *   advances by elapsed page time times its `playbackRate`. Every animation counts as starting
 *   when it is first seen; the page is looked at before its time starts and after every step, so
 *   an animation made while the page loads starts at 0 and one made later starts within one frame
 *   of when it was made. One the page holds (a CSS `animation-play-state: paused`, or its own
 *   `pause()`) is held. A finite animation is finished once its end is passed, so `finished` and
 *   `onfinish` fire. Scroll-driven animations are left to follow the scroll.
 * - Video: a `<video>` that plays (it was playing or had `autoplay` when first seen, or the page
 *   called `play()`) is paused and sought to its own position on every frame. Any other video,
 *   such as a click-to-play one showing its poster, is left alone.
 *
 * Timers with a delay under 1 ms (none, 0, negative, NaN) are given 1 ms, as browsers clamp them,
 * so an interval of 0 cannot keep the clock from reaching its target. A timer that throws is
 * reported as a warning and the take carries on. A page whose timers never let the clock reach its
 * target in `RUN_LIMIT_MS` of real time stops the take with a clear message.
 *
 * Limits, stated plainly: a page that draws from `Math.random`, from network timing, or from the
 * real GPU frame rate is not made deterministic by this. A video that the page pauses by itself is
 * followed only when it calls `pause()`; a video with a media-fragment start (`#t=`) starts at 0.
 * Pausing a playing video fires its `pause` event, which a custom player may show.
 */
import { Page } from 'playwright';

import { logger } from '../utils/logger';

/**
 * In-page, before any page script: holds animation frames, clamps timer delays and notes what the
 * page asks of its videos and animations. Added after Playwright's clock, so it wraps the clock's
 * timers. Plain ES5-style text.
 */
const SHIM_SCRIPT = `(() => {
  if (window.__cpLiveTime) return;
  var state = window.__cpLiveTime = { seen: new WeakMap(), now: 0, flush: null, orig: {} };

  var clamp = function (name) {
    var inner = window[name];
    window[name] = function (handler, delay) {
      var args = Array.prototype.slice.call(arguments);
      var d = Number(delay);
      args[1] = d >= 1 && d <= 2147483647 ? d : 1;
      return inner.apply(this, args);
    };
  };
  clamp('setTimeout');
  clamp('setInterval');

  if (window === window.top) {
    var queue = [], running = [], nextId = 1;
    window.requestAnimationFrame = function (callback) {
      if (typeof callback !== 'function') {
        throw new TypeError("Failed to execute 'requestAnimationFrame' on 'Window': parameter 1 is not of type 'Function'.");
      }
      var id = nextId++;
      queue.push({ id: id, callback: callback });
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      var lists = [queue, running];
      for (var l = 0; l < lists.length; l++) {
        for (var i = 0; i < lists[l].length; i++) {
          if (lists[l][i].id === id) { lists[l][i].cancelled = true; return; }
        }
      }
    };
    state.flush = function () {
      running = queue; queue = [];
      var now = performance.now(), error = null, count = 0;
      for (var i = 0; i < running.length; i++) {
        if (running[i].cancelled) continue;
        count++;
        try { running[i].callback.call(window, now); }
        catch (e) { if (!error) error = String((e && e.message) || e); }
      }
      running = [];
      return { count: count, error: error };
    };
  }

  // Page time now, in the take's milliseconds (exact inside a timer or a frame callback too).
  var now = function () {
    return state.offset === undefined ? state.now : performance.now() - state.offset;
  };

  var media = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (media) {
    var play = media.play, pause = media.pause;
    state.orig.mediaPause = pause;
    media.play = function () {
      var s = state.seen.get(this), t = now();
      var out = play.apply(this, arguments);
      if (this instanceof HTMLVideoElement) {
        if (s && s.managed) {
          // Already ours: it carries on from its own position.
          s.pos += ((t - s.last) / 1000) * Math.max(0, Number(this.playbackRate) || 0);
          s.last = t;
        } else {
          state.seen.set(this, { managed: true, pos: this.currentTime || 0, last: t });
        }
      }
      return out;
    };
    media.pause = function () {
      if (this instanceof HTMLVideoElement) state.seen.set(this, { managed: false, pos: 0, last: now() });
      return pause.apply(this, arguments);
    };
  }

  var anim = window.Animation && Animation.prototype;
  if (anim) {
    var aplay = anim.play, apause = anim.pause;
    state.orig.animPause = apause;
    anim.play = function () {
      var r = state.seen.get(this), t = now();
      var out = aplay.apply(this, arguments);
      if (r && !r.done) {
        // Already ours: it carries on from its own position (a held one resumes where it stood).
        if (!r.held) r.pos += (t - r.last) * (Number(this.playbackRate) || 0);
        r.last = t; r.held = false; r.api = 'running';
      } else {
        // New, or finished and now restarted: it starts where play() put it.
        r = { pos: Number(this.currentTime) || 0, last: t, api: 'running', held: false, done: false };
        state.seen.set(this, r);
      }
      // Never on the wall clock: held at its position until the next frame sets it.
      try { apause.call(this); this.currentTime = r.pos; } catch (e) { /* cancelled */ }
      return out;
    };
    anim.pause = function () {
      var r = state.seen.get(this), t = now();
      if (r) {
        if (!r.held && !r.done) r.pos += (t - r.last) * (Number(this.playbackRate) || 0);
        r.last = t; r.held = true; r.api = 'paused';
      } else {
        r = { pos: Number(this.currentTime) || 0, last: t, api: 'paused', held: true, done: false };
        state.seen.set(this, r);
      }
      var out = apause.apply(this, arguments);
      try { if (!r.done) this.currentTime = r.pos; } catch (e) { /* cancelled */ }
      return out;
    };
  }
})()`;

/** In-page: pin every time-based animation and video to `ms` milliseconds of page time. */
const SYNC_SCRIPT = `(ms) => {
  var state = window.__cpLiveTime;
  if (!state) return 0;
  state.now = ms;
  state.offset = performance.now() - ms;
  var apause = state.orig.animPause, mpause = state.orig.mediaPause;
  var cssPaused = function (a) {
    if (typeof CSSAnimation === 'undefined' || !(a instanceof CSSAnimation)) return false;
    var target = a.effect && a.effect.target;
    if (!target) return false;
    var cs = getComputedStyle(target, a.effect.pseudoElement || null);
    var names = String(cs.animationName).split(/,\\s*/), states = String(cs.animationPlayState).split(/,\\s*/);
    var i = names.indexOf(a.animationName);
    return i >= 0 && states[i % states.length] === 'paused';
  };
  var anims = document.getAnimations();
  for (var n = 0; n < anims.length; n++) {
    var a = anims[n];
    if (a.timeline && a.timeline !== document.timeline) continue;
    var r = state.seen.get(a);
    var css = cssPaused(a);
    if (!r) {
      // First sight: a running animation starts here. A held one keeps where it stands.
      r = { pos: css ? Number(a.currentTime) || 0 : 0, last: ms, api: null, held: css, done: a.playState === 'finished' };
      state.seen.set(a, r);
    }
    if (r.done) continue;
    var rate = Number(a.playbackRate) || 0;
    // The time since the last look counts as it was then: held or running.
    if (!r.held) r.pos += (ms - r.last) * rate;
    r.last = ms;
    r.held = r.api === 'paused' || (r.api !== 'running' && css);
    try { if (a.playState !== 'paused') apause.call(a); } catch (e) { continue; }
    var end = Infinity;
    try { end = a.effect ? a.effect.getComputedTiming().endTime : Infinity; } catch (e) { /* no effect */ }
    if (!r.held && isFinite(end) && ((rate > 0 && r.pos >= end) || (rate < 0 && r.pos <= 0))) {
      r.done = true;
      try { a.currentTime = rate > 0 ? end : 0; a.finish(); } catch (e) { /* the page cancelled it */ }
      continue;
    }
    try { a.currentTime = r.pos; } catch (e) { /* an animation the page cancelled */ }
  }
  var seeks = [];
  var videos = document.querySelectorAll('video');
  for (var k = 0; k < videos.length; k++) {
    var v = videos[k];
    var s = state.seen.get(v);
    if (!s) {
      // A video paused on purpose (click to play, showing its poster) is never touched.
      s = { managed: !v.paused || v.autoplay, pos: 0, last: ms };
      state.seen.set(v, s);
    }
    if (!s.managed) { s.last = ms; continue; }
    s.pos += ((ms - s.last) / 1000) * Math.max(0, Number(v.playbackRate) || 0);
    s.last = ms;
    if (!v.paused) mpause.call(v);
    var want = s.pos;
    if (v.duration && isFinite(v.duration)) {
      want = v.loop ? want % v.duration : Math.min(want, v.duration);
    }
    if (v.readyState > 0 && Math.abs(v.currentTime - want) > 0.0005) {
      seeks.push(new Promise(function (done) {
        v.addEventListener('seeked', function () { done(); }, { once: true });
      }));
      v.currentTime = want;
    }
  }
  return Promise.all(seeks).then(function () { return seeks.length; });
}`;

/** Real milliseconds a video seek may take before the frame is taken without it. */
const SEEK_LIMIT_MS = 1500;
/** Real milliseconds one step of page time may take before the take is stopped. */
const RUN_LIMIT_MS = 30000;
/** Distinct warnings reported per take; more are counted, not printed. */
const WARNING_LIMIT = 5;

export interface LiveClock {
  /** Advance the page to `seconds` into the take. Never goes backwards. */
  advanceTo(seconds: number): Promise<void>;
}

export interface SettleOptions {
  /** Frames per second of the take. Frame callbacks run once per frame interval. Default 30. */
  fps?: number;
  /** Where a warning goes (a page timer threw). Default: the log. */
  onWarning?: (message: string) => void;
}

/** Page time starts here on every take, so `Date` reads the same in every run. */
export const EPOCH = Date.UTC(2026, 0, 1, 12, 0, 0);
/** Real time allowed after each 100 ms of settling, for the network to deliver what the page asked for. */
const SETTLE_GAP_MS = 40;

/** Turn the error of a page that went away into one that says so. */
export function explainGone(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Execution context was destroyed/i.test(message)) {
    return new Error(
      'The page navigated away by itself (a redirect run by a timer?); a stepped take films one ' +
        `page, so it was stopped. ${message.split('\n')[0]}`,
    );
  }
  return error instanceof Error ? error : new Error(message);
}

/** Mark the document a take films. Call once it has loaded. */
export async function markDocument(page: Page): Promise<void> {
  await page.evaluate('window.__cpTakeDocument = true');
}

/** Throw a clear error when the page has replaced the document marked by `markDocument`. */
export async function checkDocument(page: Page): Promise<void> {
  let same = false;
  try {
    same = (await page.evaluate('window.__cpTakeDocument === true')) === true;
  } catch (error) {
    throw explainGone(error);
  }
  if (!same) {
    throw new Error(
      `The page navigated away by itself while it settled (now at ${page.url()}); a stepped ` +
        'take films one page, so it was stopped',
    );
  }
}

const isGone = (message: string) =>
  /Execution context was destroyed|Target page, context or browser has been closed|Target closed/i.test(
    message,
  );

/** Reject with `what` when `work` takes longer than `ms` of real time. */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => undefined);
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Install before the first navigation. Page time starts stopped, at the same instant on every take,
 * so how long the machine takes to load the page never shifts the page's own animations.
 *
 * Only `pauseAt` is called: `install` followed by `pauseAt` would let the real time between the two
 * calls into `performance.now()` on every new document, and can fail when that time passes `pauseAt`.
 */
export async function installLiveTime(page: Page): Promise<void> {
  await page.clock.pauseAt(EPOCH);
  await page.addInitScript(SHIM_SCRIPT);
  // The current document (a page about to be filled by `setContent`) gets it too.
  await page.evaluate(SHIM_SCRIPT);
}

/**
 * Let the loaded page run for exactly `seconds` of page time, one frame interval at a time with
 * real gaps for the network, then return a clock whose zero is that moment. Every take starts its
 * first frame after the same amount of page time, so the page's own motion starts in the same state.
 */
export async function settle(
  page: Page,
  seconds: number,
  options: SettleOptions = {},
): Promise<LiveClock> {
  const fps = options.fps ?? 30;
  const said = new Set<string>();
  let unsaid = 0;
  const warn = (message: string) => {
    if (said.has(message)) return;
    if (said.size >= WARNING_LIMIT) {
      unsaid++;
      if (unsaid === 1) report('Further page warnings in this take are not shown');
      return;
    }
    said.add(message);
    report(message);
  };
  const report =
    options.onWarning ?? ((m: string) => logger.child({ component: 'live-time' }).warn(m));

  let now = 0;
  const stepTo = async (target: number) => {
    if (target <= now) return;
    await run(page, target - now, warn);
    now = target;
    await flush(page, warn);
  };

  const total = Math.round(seconds * 1000);
  await sync(page, 0);
  for (let frame = 1; now < total; frame++) {
    const before = now;
    await stepTo(Math.min(Math.round((frame * 1000) / fps), total));
    await sync(page, now);
    if (Math.floor(now / 100) > Math.floor(before / 100)) {
      await new Promise((resolve) => setTimeout(resolve, SETTLE_GAP_MS));
    }
  }
  return {
    async advanceTo(at: number) {
      await stepTo(total + Math.round(at * 1000));
      await sync(page, now);
    },
  };
}

/** Run the page's timers for `ms` of page time. A timer that throws is a warning, not a failure. */
async function run(page: Page, ms: number, warn: (message: string) => void): Promise<void> {
  const limit =
    `The page's own timers did not get through ${ms} ms of page time within ` +
    `${RUN_LIMIT_MS / 1000} s of real time, so the take was stopped`;
  try {
    await within(page.clock.runFor(ms), RUN_LIMIT_MS, limit);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === limit) throw error;
    if (isGone(message)) throw explainGone(error);
    // The clock ran to its target before it passed the page's error on.
    warn(`A timer on the page threw; page time carried on: ${message.split('\n')[0]}`);
  }
}

/** Run this frame's animation-frame callbacks once, at the current page time. */
async function flush(page: Page, warn: (message: string) => void): Promise<void> {
  const limit = `The page's animation frame did not finish within ${RUN_LIMIT_MS / 1000} s of real time`;
  let result: { count: number; error: string | null } | null;
  try {
    result = (await within(
      page.evaluate(
        'window.__cpLiveTime && window.__cpLiveTime.flush ? window.__cpLiveTime.flush() : null',
      ),
      RUN_LIMIT_MS,
      limit,
    )) as { count: number; error: string | null } | null;
  } catch (error) {
    throw explainGone(error);
  }
  if (result?.error) warn(`An animation frame on the page threw: ${result.error}`);
}

async function sync(page: Page, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SEEK_LIMIT_MS);
  });
  const work = page.evaluate(`(${SYNC_SCRIPT})(${ms})`);
  work.catch(() => undefined);
  try {
    await Promise.race([work, limit]);
  } catch (error) {
    throw explainGone(error);
  } finally {
    clearTimeout(timer);
  }
}
