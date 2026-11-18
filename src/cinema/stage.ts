/**
 * Cinematic stage
 *
 * Generates a self-contained page that draws a screenplay at any time `t`. It implements the stage
 * contract: `window.__stage.ready` (a promise), `window.__stage.duration` (seconds) and
 * `window.__stage.seek(t)` (draws time `t`, resolves when the frame is painted).
 *
 * The stage is a pure function of time. It reads no clock and uses no unseeded randomness: film
 * grain is drawn from a generator seeded by the frame time, so two renders of the same screenplay
 * give the same frames.
 */
import { PageCapture, Screenplay } from './types';

export interface StageOptions {
  /** Letterbox the frame to this ratio, e.g. 2.39. Omit for a full frame. */
  letterbox?: number;
  /** Film grain strength, 0 to 1. */
  grain?: number;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The script that runs inside the stage. Kept as plain ES5-style text: no bundler, no imports. */
const STAGE_SCRIPT = `
(function () {
  var data = window.__STAGE_DATA;
  var play = data.screenplay, cap = data.capture, opts = data.options;
  var W = play.frame.w, H = play.frame.h;
  var plane = document.getElementById('plane');
  var sheen = document.getElementById('sheen');
  var title = document.getElementById('title');
  var titleText = document.getElementById('title-text');
  var titleSub = document.getElementById('title-sub');
  var fade = document.getElementById('fade');
  var grain = document.getElementById('grain');
  var gctx = grain.getContext('2d');

  function ease(kind, p) {
    if (kind === 'inOut') return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    if (kind === 'out') return 1 - Math.pow(1 - p, 4);
    return p;
  }
  function mix(a, b, p) { return a + (b - a) * p; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // mulberry32: a small seeded generator, so grain depends only on the frame time.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shotAt(t) {
    var shots = play.shots;
    for (var i = 0; i < shots.length; i++) {
      if (t < shots[i].start + shots[i].duration) return shots[i];
    }
    return shots[shots.length - 1];
  }

  function draw(t) {
    var time = Math.min(Math.max(t, 0), play.duration);
    var shot = shotAt(time);
    var local = time - shot.start;
    var p = clamp01(local / shot.duration);
    var e = ease(shot.ease, p);
    var a = shot.from, b = shot.to;
    var cx = mix(a.cx, b.cx, e), cy = mix(a.cy, b.cy, e), s = mix(a.scale, b.scale, e);
    var rx = mix(a.rx, b.rx, e), ry = mix(a.ry, b.ry, e), rz = mix(a.rz, b.rz, e);
    var blur = mix(a.blur, b.blur, e), light = mix(a.light, b.light, e);

    plane.style.transform =
      'translate(' + W / 2 + 'px,' + H / 2 + 'px) rotateX(' + rx + 'deg) rotateY(' + ry +
      'deg) rotateZ(' + rz + 'deg) scale(' + s + ') translate(' + -cx + 'px,' + -cy + 'px)';
    plane.style.filter = 'blur(' + (blur / s).toFixed(3) + 'px) brightness(' + light.toFixed(4) + ')';

    // A band of light that crosses the page once per shot.
    sheen.style.backgroundPosition = (-60 + 220 * p).toFixed(2) + '% 0';

    var fadeIn = shot.fadeIn > 0 ? clamp01(local / shot.fadeIn) : 1;
    var fadeOut = shot.fadeOut > 0 ? clamp01((shot.duration - local) / shot.fadeOut) : 1;
    fade.style.opacity = (1 - Math.min(fadeIn, fadeOut)).toFixed(4);

    if (shot.title) {
      var show = Math.min(clamp01((local - 0.15) / 0.6), clamp01((shot.duration - local) / 0.5));
      title.style.opacity = show.toFixed(4);
      titleText.textContent = shot.title.text;
      titleText.style.letterSpacing = mix(0.62, 0.3, ease('out', p)).toFixed(4) + 'em';
      titleSub.textContent = shot.title.sub || '';
      titleSub.style.opacity = clamp01((local - 0.7) / 0.6).toFixed(4);
    } else {
      title.style.opacity = '0';
    }

    if (opts.grain > 0) {
      var next = rng(Math.round(time * 1000) + 1);
      var img = gctx.createImageData(grain.width, grain.height);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = Math.floor(next() * 255);
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
      }
      gctx.putImageData(img, 0, 0);
    }
  }

  var ready = new Promise(function (resolve, reject) {
    if (plane.complete && plane.naturalWidth > 0) return resolve();
    plane.addEventListener('load', function () { resolve(); });
    plane.addEventListener('error', function () { reject(new Error('The page still failed to load')); });
  }).then(function () { return plane.decode ? plane.decode().catch(function () {}) : undefined; })
    .then(function () { draw(0); });

  window.__stage = {
    ready: ready,
    duration: play.duration,
    seek: function (t) {
      draw(t);
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(function () { resolve(); }); });
      });
    },
  };
})();
`;

/** Build the stage document for a capture and its screenplay. */
export function buildStageHtml(
  capture: PageCapture,
  screenplay: Screenplay,
  options: StageOptions = {},
): string {
  const { w, h } = screenplay.frame;
  const grain = options.grain ?? 0.07;
  const bar = options.letterbox ? Math.max(0, Math.round((h - w / options.letterbox) / 2)) : 0;
  const data = JSON.stringify({ screenplay, capture, options: { grain } }).replace(/</g, '\\u003c');
  const titleSize = Math.round(w * 0.058);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(capture.title)} — stage</title>
<style>
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #000; }
  #world { position: absolute; inset: 0; overflow: hidden; perspective: ${Math.round(w * 1.1)}px;
    perspective-origin: 50% 50%;
    background: radial-gradient(120% 90% at 50% 40%, #16181d 0%, #050506 70%, #000 100%); }
  #rig { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-style: preserve-3d; }
  #plane { position: absolute; left: 0; top: 0; width: ${capture.width}px; height: ${capture.height}px;
    transform-origin: 0 0; background: ${capture.background}; will-change: transform, filter;
    box-shadow: 0 60px 160px rgba(0, 0, 0, 0.75); }
  #sheen { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light; opacity: 0.55;
    background: linear-gradient(105deg, transparent 38%, rgba(255, 255, 255, 0.55) 50%, transparent 62%);
    background-size: 220% 100%; background-repeat: no-repeat; }
  #vignette { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 48%, rgba(0, 0, 0, 0.62) 100%); }
  #grain { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
    opacity: ${grain}; mix-blend-mode: overlay; image-rendering: pixelated; }
  #title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
    justify-content: center; opacity: 0; color: #fff; text-align: center;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; text-transform: uppercase; }
  #title-text { font-size: ${titleSize}px; font-weight: 700; padding-left: 0.3em;
    text-shadow: 0 0 ${Math.round(titleSize * 0.6)}px rgba(255, 255, 255, 0.35); }
  #title-sub { margin-top: ${Math.round(titleSize * 0.5)}px; font-size: ${Math.round(titleSize * 0.3)}px;
    font-weight: 400; letter-spacing: 0.42em; padding-left: 0.42em; opacity: 0; color: rgba(255, 255, 255, 0.82); }
  #fade { position: absolute; inset: 0; background: #000; opacity: 1; pointer-events: none; }
  .bar { position: absolute; left: 0; right: 0; height: ${bar}px; background: #000; }
</style>
</head>
<body>
<div id="world">
  <div id="rig"><img id="plane" src="${escapeHtml(capture.image)}" alt=""></div>
  <div id="sheen"></div>
  <div id="vignette"></div>
  <canvas id="grain" width="${Math.round(w / 3)}" height="${Math.round(h / 3)}"></canvas>
  <div id="title"><div id="title-text"></div><div id="title-sub"></div></div>
  <div id="fade"></div>
  <div class="bar" style="top:0"></div>
  <div class="bar" style="bottom:0"></div>
</div>
<script>window.__STAGE_DATA = ${data};</script>
<script>${STAGE_SCRIPT}</script>
</body>
</html>
`;
}
