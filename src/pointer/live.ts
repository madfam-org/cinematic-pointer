/**
 * The pointer on a live page
 *
 * Plans the pointer's part in a scroll take and draws it over the live page. While the page is
 * held still, the pointer comes in and attends to the most telling thing in view: the headline,
 * else a section heading, else a button. In the last hold long enough for it, the pointer presses
 * the main button in view (visually only: nothing is clicked). While the page scrolls, the pointer is off screen.
 */
import { Page } from 'playwright';

import { pickAction } from '../cinema/screenplay';
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
  // The press goes to the main button in view during the last hold long enough to show a press,
  // so the take ends on an action the viewer can see. Buttons are compared only with others in the
  // same view: the page's overall primary is often at its foot, where the take rarely lingers.
  let pressHold = -1;
  let primary: Landmark | null = null;
  holds.forEach((h, i) => {
    if (h.end - h.start < MIN_PRESS_HOLD) return;
    const choice = pickAction({
      landmarks: landmarks.filter((m) => m.kind === 'cta' && inView(m, h.from)),
    });
    if (choice) {
      pressHold = i;
      primary = choice;
    }
  });

  const shots: ShotTiming[] = [];
  const subjects: Record<string, Subject> = {};
  holds.forEach((h, i) => {
    const name = `hold-${i + 1}`;
    shots.push({ name, start: h.start, duration: h.end - h.start });
    const visible = landmarks.filter((m) => inView(m, h.from));
    if (i === pressHold && primary) {
      subjects[name] = box('action', primary as Landmark);
      return;
    }
    const headline = visible.find((m) => m.kind === 'h1');
    const section = visible.find((m) => m.kind === 'h2');
    const action = visible.find((m) => m.kind === 'cta');
    if (headline) subjects[name] = box('headline', headline);
    else if (section) subjects[name] = box('section', section);
    else if (action) subjects[name] = box('place', action);
  });
  return perform(shots, subjects, persona, { frameWidth: viewport.w, viewWidth: viewport.w });
}

/** In-page drawing of the pointer over the live page. Kept as plain ES5-style text. */
const DRAW_SCRIPT = `
${POINTER_MATH_JS}
window.__cpLivePointer = function (t) {
  var track = window.__cpLiveTrack;
  var root = document.getElementById('cp-live-pointer');
  if (!root) return;
  var pose = pointerAt(track, t);
  var x = pose.x - window.scrollX, y = pose.y - window.scrollY;
  var hand = root.querySelector('.cp-hand');
  hand.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + pose.squash.toFixed(4) + ')';
  hand.style.opacity = pose.opacity.toFixed(4);
  var worn = hand.children;
  for (var i = 0; i < worn.length; i++) {
    worn[i].style.display = worn[i].getAttribute('data-outfit') === pose.outfit ? 'block' : 'none';
  }
  var html = '';
  for (var r = 0; r < pose.rings.length; r++) {
    var ring = pose.rings[r], grow = 1 - Math.pow(1 - ring.p, 3), d = track.size * 2.6 * grow;
    html += '<div style="position:absolute;box-sizing:border-box;border-radius:50%;border:3px solid ' +
      track.ring + ';left:' + (ring.x - window.scrollX - d / 2).toFixed(2) + 'px;top:' +
      (ring.y - window.scrollY - d / 2).toFixed(2) + 'px;width:' + d.toFixed(2) + 'px;height:' +
      d.toFixed(2) + 'px;opacity:' + (1 - ring.p).toFixed(4) + '"></div>';
  }
  root.querySelector('.cp-rings').innerHTML = html;
};
`;

/** Put the pointer's layer on the page. Call after the landmarks have been read. */
export async function mountLivePointer(page: Page, track: PointerTrack): Promise<void> {
  for (const colour of [track.ink, track.fill, track.ring]) {
    if (!COLOUR.test(colour)) throw new Error('The pointer has a colour that is not hex or rgb');
  }
  const size = track.size;
  const wardrobe = OUTFIT_IDS.map((id) => {
    const hot = OUTFITS[id].hotspot;
    const left = -((hot.x / 32) * size).toFixed(2);
    const top = -((hot.y / 32) * size).toFixed(2);
    return `<div data-outfit="${id}" style="position:absolute;left:${left}px;top:${top}px;display:none">${outfitSvg(id, size)}</div>`;
  }).join('');
  const layer =
    `<div id="cp-live-pointer" style="position:fixed;inset:0;pointer-events:none;z-index:2147483647;` +
    `--cp-ink:${track.ink};--cp-fill:${track.fill}">` +
    `<div class="cp-rings" style="position:absolute;inset:0"></div>` +
    `<div class="cp-hand" style="position:absolute;left:0;top:0;width:0;height:0;transform-origin:0 0;` +
    `filter:drop-shadow(0 ${Math.round(size / 8)}px ${Math.round(size / 6)}px rgba(0,0,0,0.45))">${wardrobe}</div></div>`;
  await page.evaluate(
    `(() => { ${DRAW_SCRIPT}; window.__cpLiveTrack = ${JSON.stringify(track)}; const host = document.createElement('div'); host.innerHTML = ${JSON.stringify(layer)}; document.body.appendChild(host.firstChild); })()`,
  );
}

/** Draw the pointer at `seconds` into the take. */
export async function drawLivePointer(page: Page, seconds: number): Promise<void> {
  await page.evaluate(`window.__cpLivePointer(${seconds})`);
}
