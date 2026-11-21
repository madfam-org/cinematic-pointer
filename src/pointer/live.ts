/**
 * The pointer on a live page
 *
 * Plans the pointer's part in a scroll take and draws it over the live page. While the page is
 * held still, the pointer comes in from outside the view and attends to the most telling thing in
 * view: the headline, else a section heading, else a button. In the last hold long enough for it,
 * the pointer presses the main button in view (visually only: nothing is clicked). While the page
 * scrolls, the pointer is off screen.
 *
 * The layer is built with DOM calls, never from markup, so a page that enforces Trusted Types
 * still gets its pointer. If the page removes the layer, it is put back on the next frame.
 */
import { Page } from 'playwright';

import { TIE } from '../cinema/screenplay';
import { Landmark } from '../cinema/types';
import { ScrollTimeline } from '../recorders/timeline';

import { POINTER_MATH_JS, PointerTrack } from './motion';
import { OUTFIT_IDS, OUTFITS, outfitSvg } from './outfits';
import { perform, ShotTiming, Subject } from './perform';
import { COLOUR, Persona } from './persona';

/** A hold shorter than this is a breath between scrolls, not a moment for the pointer. */
const MIN_HOLD = 1.2;
/** A hold shorter than this is too brief to come in, rest on a button and press it. */
const MIN_PRESS_HOLD = 2;
/** Share of the viewport, top and bottom, where a landmark counts as out of view. */
const MARGIN = 0.12;

export interface LivePlanOptions {
  viewport: { w: number; h: number };
  persona: Persona;
}

const box = (kind: Subject['kind'], m: Landmark): Subject => ({
  kind,
  x: m.x,
  y: m.y,
  w: m.w,
  h: m.h,
});

const sameRow = (a: Landmark, b: Landmark) => a.y < b.y + b.h && b.y < a.y + a.h;
/** `b` reads before `a`: a row higher up, or the same row further left. */
const before = (b: Landmark, a: Landmark) => (sameRow(a, b) ? b.x < a.x : b.y < a.y);

/**
 * The main call to action among those in one view: the one that stands out most. Any within the
 * tie margin of it count as level, and of those the one read first wins (top row, then leftmost).
 * If any was read without a weight the weights are not comparable, and the one read first wins.
 */
export function pickInView(actions: Landmark[]): Landmark | null {
  if (actions.length === 0) return null;
  const weighed = actions.every((m) => typeof m.weight === 'number' && Number.isFinite(m.weight));
  const top = weighed ? Math.max(...actions.map((m) => m.weight as number)) : 0;
  const level = weighed ? actions.filter((m) => (m.weight as number) >= top - TIE - 1e-9) : actions;
  return level.reduce((a, b) => (before(b, a) ? b : a));
}

/** Plan the pointer for a scroll timeline over a page with these landmarks. Pure. */
export function planLivePointer(
  timeline: ScrollTimeline,
  landmarks: Landmark[],
  options: LivePlanOptions,
): PointerTrack {
  const { viewport, persona } = options;
  const holds = timeline.segments.filter((s) => s.from === s.to && s.end - s.start >= MIN_HOLD);
  const inView = (m: Landmark, scroll: number) => {
    const c = m.y + m.h / 2;
    return c >= scroll + viewport.h * MARGIN && c <= scroll + viewport.h * (1 - MARGIN);
  };
  const actionsAt = (scroll: number) =>
    landmarks.filter((m) => m.kind === 'cta' && inView(m, scroll));
  // The press goes to the main button in view during the last hold long enough to show a press,
  // so the take ends on an action the viewer can see. Buttons are compared only with others in the
  // same view: the page's overall primary is often at its foot, where the take rarely lingers.
  let pressHold = -1;
  let primary: Landmark | null = null;
  holds.forEach((h, i) => {
    if (h.end - h.start < MIN_PRESS_HOLD) return;
    const choice = pickInView(actionsAt(h.from));
    if (choice) {
      pressHold = i;
      primary = choice;
    }
  });

  const shots: ShotTiming[] = [];
  const subjects: Record<string, Subject> = {};
  const views: Record<string, { x: number; y: number; w: number; h: number }> = {};
  holds.forEach((h, i) => {
    const name = `hold-${i + 1}`;
    shots.push({ name, start: h.start, duration: h.end - h.start });
    views[name] = { x: 0, y: h.from, w: viewport.w, h: viewport.h };
    const visible = landmarks.filter((m) => inView(m, h.from));
    if (i === pressHold && primary) {
      subjects[name] = box('action', primary as Landmark);
      return;
    }
    const headline = visible.find((m) => m.kind === 'h1');
    const section = visible.find((m) => m.kind === 'h2');
    const action = pickInView(actionsAt(h.from));
    if (headline) subjects[name] = box('headline', headline);
    else if (section) subjects[name] = box('section', section);
    else if (action) subjects[name] = box('place', action);
  });
  return perform(shots, subjects, persona, {
    frameWidth: viewport.w,
    viewWidth: viewport.w,
    views,
  });
}

/** An element of our own SVG markup, as data the page can build with DOM calls. */
export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
}

/**
 * Parse the outfit markup this package writes (elements and quoted attributes, no text) into a
 * tree. Throws on anything else, so a change to the outfits cannot slip markup past the builder.
 */
export function svgTree(markup: string): SvgNode {
  const tag = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g;
  const attr = /([\w:-]+)="([^"]*)"/g;
  const root: SvgNode = { tag: '#root', attrs: {}, children: [] };
  const stack: SvgNode[] = [root];
  let at = 0;
  for (let m = tag.exec(markup); m; m = tag.exec(markup)) {
    if (markup.slice(at, m.index).trim()) throw new Error('Outfit markup has text in it');
    at = m.index + m[0].length;
    const [, closing, name, attrs, selfClosing] = m;
    if (closing) {
      const open = stack.pop();
      if (!open || open.tag !== name) throw new Error(`Outfit markup closes <${name}> unopened`);
      continue;
    }
    const node: SvgNode = { tag: name, attrs: {}, children: [] };
    for (let a = attr.exec(attrs); a; a = attr.exec(attrs)) node.attrs[a[1]] = a[2];
    attr.lastIndex = 0;
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (markup.slice(at).trim() || stack.length !== 1 || root.children.length !== 1) {
    throw new Error('Outfit markup is not one closed element');
  }
  return root.children[0];
}

/** In-page building and drawing of the pointer over the live page. Kept as plain ES5-style text. */
const DRAW_SCRIPT = `
${POINTER_MATH_JS}
var SVG_NS = 'http://www.w3.org/2000/svg';
function cpBuild(node) {
  var el = document.createElementNS(SVG_NS, node.tag);
  for (var k in node.attrs) if (k !== 'xmlns') el.setAttribute(k, node.attrs[k]);
  for (var i = 0; i < node.children.length; i++) el.appendChild(cpBuild(node.children[i]));
  return el;
}
window.__cpMountLive = function () {
  var spec = window.__cpLiveSpec, track = spec.track;
  var host = document.body || document.documentElement;
  if (!host) return null;
  var old = document.getElementById('cp-live-pointer');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var root = document.createElement('div');
  root.id = 'cp-live-pointer';
  root.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;margin:0;padding:0;border:0;' +
    'pointer-events:none;z-index:2147483647';
  root.style.setProperty('--cp-ink', track.ink);
  root.style.setProperty('--cp-fill', track.fill);
  var rings = document.createElement('div');
  rings.className = 'cp-rings';
  rings.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0';
  var hand = document.createElement('div');
  hand.className = 'cp-hand';
  hand.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;filter:' + spec.shadow;
  for (var i = 0; i < spec.outfits.length; i++) {
    var o = spec.outfits[i], worn = document.createElement('div');
    worn.setAttribute('data-outfit', o.id);
    worn.style.cssText = 'position:absolute;left:' + o.left + 'px;top:' + o.top + 'px;display:none';
    worn.appendChild(cpBuild(o.svg));
    hand.appendChild(worn);
  }
  root.appendChild(rings);
  root.appendChild(hand);
  host.appendChild(root);
  return root;
};
window.__cpLivePointer = function (t) {
  var track = window.__cpLiveSpec.track;
  var root = document.getElementById('cp-live-pointer');
  if (!root || !root.isConnected) root = window.__cpMountLive();
  if (!root) return;
  // A transformed <html> or <body> makes the fixed layer scroll with it: draw relative to the layer.
  var origin = root.getBoundingClientRect();
  var ox = window.scrollX + origin.left, oy = window.scrollY + origin.top;
  var pose = pointerAt(track, t);
  var hand = root.querySelector('.cp-hand');
  hand.style.transform = 'translate(' + (pose.x - ox).toFixed(2) + 'px,' + (pose.y - oy).toFixed(2) +
    'px) scale(' + pose.squash.toFixed(4) + ')';
  hand.style.opacity = pose.opacity.toFixed(4);
  var worn = hand.children;
  for (var i = 0; i < worn.length; i++) {
    worn[i].style.display = worn[i].getAttribute('data-outfit') === pose.outfit ? 'block' : 'none';
  }
  var rings = root.querySelector('.cp-rings');
  while (rings.firstChild) rings.removeChild(rings.firstChild);
  for (var r = 0; r < pose.rings.length; r++) {
    var ring = pose.rings[r], grow = 1 - Math.pow(1 - ring.p, 3), d = track.size * 2.6 * grow;
    var el = document.createElement('div');
    el.style.cssText = 'position:absolute;box-sizing:border-box;border-radius:50%;border:3px solid ' +
      track.ring + ';left:' + (ring.x - ox - d / 2).toFixed(2) + 'px;top:' +
      (ring.y - oy - d / 2).toFixed(2) + 'px;width:' + d.toFixed(2) + 'px;height:' +
      d.toFixed(2) + 'px;opacity:' + (1 - ring.p).toFixed(4);
    rings.appendChild(el);
  }
};
`;

/** Put the pointer's layer on the page. Call after the landmarks have been read. */
export async function mountLivePointer(page: Page, track: PointerTrack): Promise<void> {
  for (const colour of [track.ink, track.fill, track.ring]) {
    if (!COLOUR.test(colour)) throw new Error('The pointer has a colour that is not hex or rgb');
  }
  const size = track.size;
  const spec = {
    track,
    shadow: `drop-shadow(0 ${Math.round(size / 8)}px ${Math.round(size / 6)}px rgba(0,0,0,0.45))`,
    outfits: OUTFIT_IDS.map((id) => {
      const hot = OUTFITS[id].hotspot;
      return {
        id,
        left: -Number(((hot.x / 32) * size).toFixed(2)),
        top: -Number(((hot.y / 32) * size).toFixed(2)),
        svg: svgTree(outfitSvg(id, size)),
      };
    }),
  };
  await page.evaluate(
    `(() => { ${DRAW_SCRIPT}; window.__cpLiveSpec = ${JSON.stringify(spec)}; window.__cpMountLive(); })()`,
  );
}

/** Draw the pointer at `seconds` into the take. */
export async function drawLivePointer(page: Page, seconds: number): Promise<void> {
  await page.evaluate(`window.__cpLivePointer(${seconds})`);
}
