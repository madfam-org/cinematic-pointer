/**
 * Estate tour stage
 *
 * A self-contained page that draws a tour at time `t` with three.js and implements the stage
 * contract (`window.__stage.ready`, `.duration`, `.seek(t)`), so the frame-stepped recorder can
 * film it. The page holds no direction: the panels and the camera path arrive as data from
 * `layout.ts`, and `seek` only looks the camera up and draws one frame. It reads no clock and uses
 * no randomness.
 *
 * three.js is bundled into the page, so the stage needs no network.
 */
import { build } from 'esbuild';

import { Tour } from './layout';

/** Browser code. Kept as text so it is bundled with three.js, not compiled with the CLI. */
const RUNTIME = String.raw`
import * as THREE from 'three';

const tour = window.__tour;
const canvas = document.getElementById('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
} catch (error) {
  // Without this the recorder would only see an undefined stage. Say what is missing.
  const failed = Promise.reject(
    new Error('The tour stage could not start WebGL here. On a machine without a GPU, pass --software.'),
  );
  window.__stage = { duration: tour.duration, info: { renderer: 'none' }, ready: failed, seek: () => failed };
  throw error;
}
let lost = false;
canvas.addEventListener('webglcontextlost', () => {
  lost = true;
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060d);
const camera = new THREE.PerspectiveCamera(tour.fov, window.innerWidth / window.innerHeight, 0.1, 4000);

const gl = renderer.getContext();
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const info = {
  renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unknown',
  maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  panels: tour.panels.length,
  textures: 0,
};

function label(text) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = '600 76px system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), 8, 68, 1008);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadTexture(file) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      file,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        info.textures += 1;
        resolve(texture);
      },
      undefined,
      () => reject(new Error('The stage could not load ' + file)),
    );
  });
}

async function buildScene() {
  for (const panel of tour.panels) {
    const group = new THREE.Group();
    group.position.set(panel.top.x - panel.width / 2, panel.top.y, panel.top.z);
    scene.add(group);

    // The page's own colour behind the tiles, so a tile that is still loading is never a hole.
    const backing = new THREE.Mesh(
      new THREE.PlaneGeometry(panel.width, panel.height),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(panel.background) }),
    );
    backing.position.set(panel.width / 2, -panel.height / 2, -0.01);
    group.add(backing);

    for (const tile of panel.tiles) {
      const texture = await loadTexture(tile.file);
      // A tile that crosses the panel's cut is drawn only down to it.
      const shown = Math.min(tile.height, panel.height - tile.down);
      const part = shown / tile.height;
      texture.repeat.set(1, part);
      texture.offset.set(0, 1 - part);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(tile.width, shown),
        new THREE.MeshBasicMaterial({ map: texture }),
      );
      mesh.position.set(tile.left + tile.width / 2, -(tile.down + shown / 2), 0);
      group.add(mesh);
    }

    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(panel.width, panel.width / 8),
      new THREE.MeshBasicMaterial({ map: label(panel.name), transparent: true }),
    );
    name.position.set(panel.width / 2, panel.width / 8, 0);
    group.add(name);
  }
}

function sampleAt(t) {
  const clamped = Math.max(0, Math.min(tour.duration, t));
  const at = clamped * tour.sampleRate;
  const i = Math.min(tour.samples.length - 1, Math.floor(at));
  const j = Math.min(tour.samples.length - 1, i + 1);
  const u = at - i;
  const a = tour.samples[i];
  const b = tour.samples[j];
  const mix = (p, q) => p + (q - p) * u;
  return {
    position: [mix(a.position.x, b.position.x), mix(a.position.y, b.position.y), mix(a.position.z, b.position.z)],
    target: [mix(a.target.x, b.target.x), mix(a.target.y, b.target.y), mix(a.target.z, b.target.z)],
  };
}

function draw(t) {
  const s = sampleAt(t);
  camera.position.set(s.position[0], s.position[1], s.position[2]);
  camera.lookAt(s.target[0], s.target[1], s.target[2]);
  renderer.render(scene, camera);
  // The frame is on screen once the GPU, or the software rasteriser, has finished it.
  gl.finish();
}

window.__stage = {
  duration: tour.duration,
  info,
  ready: buildScene().then(() => draw(0)),
  seek: (t) => {
    // A lost context draws black. That must fail the take, not be filmed.
    if (lost) return Promise.reject(new Error('The tour stage lost its WebGL context'));
    draw(t);
    return Promise.resolve();
  },
};
`;

/** The stage's own code, before three.js is bundled in. Exported so a test can read it. */
export const RUNTIME_SOURCE = RUNTIME;

let bundled: Promise<string> | undefined;

/** The runtime with three.js inside it, as one script. Built once per process. */
function runtimeBundle(): Promise<string> {
  bundled ??= build({
    stdin: { contents: RUNTIME, resolveDir: __dirname, loader: 'js' },
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    logLevel: 'silent',
    target: 'chrome120',
  }).then((result) => result.outputFiles[0].text);
  return bundled;
}

/** Text placed inside a script element must not be able to close it. */
function inScript(text: string): string {
  return text.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

export async function buildTourStageHtml(tour: Tour): Promise<string> {
  const runtime = await runtimeBundle();
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Estate tour</title>
<style>
  html, body { margin: 0; height: 100%; background: #05060d; overflow: hidden; }
  canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="stage"></canvas>
<script>window.__tour = ${JSON.stringify(tour).replace(/</g, '\\u003c')};</script>
<script>${inScript(runtime)}</script>
</body>
</html>
`;
}
