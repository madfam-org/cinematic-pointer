/**
 * Estate tour: layout and camera path
 *
 * A drone flight through the products: each product's captured page stands in space as a tall
 * panel, panels are grouped in rows by the registry's stack layer, and the camera flies to each
 * one, glides down it and moves on.
 *
 * Everything here is plain data computed ahead of time. The stage in the browser only draws what
 * it is given: it holds no direction of its own, so a tour is reproducible from its inputs and the
 * direction is testable without a browser.
 */

export const LAYER_ORDER = ['soil', 'roots', 'stem', 'fruit'] as const;
export type Layer = (typeof LAYER_ORDER)[number];

export interface TourInput {
  slug: string;
  name: string;
  layer?: Layer;
  /** Size of the captured page in page pixels. */
  width: number;
  height: number;
  /** The capture's tiles, in page pixels. Files are relative to the stage document. */
  tiles: { file: string; x: number; y: number; w: number; h: number }[];
  background: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Panel {
  slug: string;
  name: string;
  layer: Layer | 'other';
  /** Centre of the panel's top edge, in scene units. The panel hangs down from here. */
  top: Vec3;
  /** Scene units. */
  width: number;
  height: number;
  /** True when the page was taller than a panel may be and its end is not shown. */
  cropped: boolean;
  background: string;
  /** Each tile's rectangle on the panel: offsets from the panel's top-left, in scene units. */
  tiles: { file: string; left: number; down: number; width: number; height: number }[];
}

export interface Shot {
  kind: 'establish' | 'approach' | 'descend' | 'depart';
  slug?: string;
  start: number;
  end: number;
}

export interface CameraSample {
  position: Vec3;
  target: Vec3;
}

export interface Tour {
  panels: Panel[];
  shots: Shot[];
  duration: number;
  /** Camera samples at `sampleRate` per second, from 0 to `duration`. */
  sampleRate: number;
  samples: CameraSample[];
  /** Field of view, degrees. */
  fov: number;
}

export interface TourOptions {
  /** Width of every panel, scene units. */
  panelWidth?: number;
  /** A panel is at most this many times taller than wide. */
  maxAspect?: number;
  /** Gap between panels in a row, and between rows. */
  gap?: number;
  /** Width over height of the frame, used to stand the camera at the right distance. */
  frameAspect?: number;
  fov?: number;
  sampleRate?: number;
  /** Seconds the camera takes to glide down one panel-width of page. */
  secondsPerScreen?: number;
}

const DEFAULTS = {
  panelWidth: 4,
  maxAspect: 4,
  gap: 1.6,
  frameAspect: 16 / 9,
  fov: 38,
  sampleRate: 60,
  secondsPerScreen: 1.6,
};

/** Place the panels: one row per layer, soil nearest the ground, each row centred. */
export function layoutPanels(inputs: TourInput[], options: TourOptions = {}): Panel[] {
  const o = { ...DEFAULTS, ...options };
  const rows: (Layer | 'other')[] = [...LAYER_ORDER, 'other'];
  const byRow = new Map<string, TourInput[]>();
  for (const input of inputs) {
    if (!(input.width > 0) || !(input.height > 0)) {
      throw new Error(`${input.slug}: a capture needs a size`);
    }
    const row = input.layer ?? 'other';
    byRow.set(row, [...(byRow.get(row) ?? []), input]);
  }

  const used = rows.filter((row) => byRow.has(row));
  const rowHeight = o.panelWidth * o.maxAspect + o.gap * 2;
  const panels: Panel[] = [];
  used.forEach((row, rowIndex) => {
    // Sorted by slug so the same inputs always give the same tour.
    const members = [...(byRow.get(row) ?? [])].sort((a, b) => a.slug.localeCompare(b.slug));
    const span = members.length * o.panelWidth + (members.length - 1) * o.gap;
    members.forEach((input, index) => {
      const scale = o.panelWidth / input.width;
      const full = input.height * scale;
      const height = Math.min(full, o.panelWidth * o.maxAspect);
      const top: Vec3 = {
        x: -span / 2 + o.panelWidth / 2 + index * (o.panelWidth + o.gap),
        // Rows stack upward: the first layer present is the lowest.
        y: rowIndex * rowHeight + o.panelWidth * o.maxAspect,
        z: 0,
      };
      const tiles = input.tiles
        .map((tile) => ({
          file: tile.file,
          left: tile.x * scale,
          down: tile.y * scale,
          width: tile.w * scale,
          height: tile.h * scale,
        }))
        // A tile wholly below the cut is not drawn; one that crosses it is clipped by the stage.
        .filter((tile) => tile.down < height);
      panels.push({
        slug: input.slug,
        name: input.name,
        layer: row,
        top,
        width: o.panelWidth,
        height,
        cropped: full > height + 1e-9,
        background: input.background,
        tiles,
      });
    });
  });
  return panels;
}

/** Where the camera stands to see a rectangle `width` wide head on, filling most of the frame. */
function standOff(width: number, fovDegrees: number, frameAspect: number): number {
  const vertical = (fovDegrees * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * frameAspect);
  return (width * 1.18) / (2 * Math.tan(horizontal / 2));
}

interface Key extends CameraSample {
  t: number;
}

function bounds(panels: Panel[]): { min: Vec3; max: Vec3 } {
  const xs = panels.flatMap((p) => [p.top.x - p.width / 2, p.top.x + p.width / 2]);
  const ys = panels.flatMap((p) => [p.top.y, p.top.y - p.height]);
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys), z: 0 },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: 0 },
  };
}

/** Catmull-Rom through four values, at `u` between the middle two. */
function spline(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => u * u * (3 - 2 * u);

/** The camera at time `t`, on a smooth curve through the keys. Exported for tests. */
export function cameraAt(keys: Key[], t: number): CameraSample {
  if (keys.length === 0) throw new Error('A camera path needs keys');
  if (t <= keys[0].t) return { position: keys[0].position, target: keys[0].target };
  const last = keys[keys.length - 1];
  if (t >= last.t) return { position: last.position, target: last.target };
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = (t - k1.t) / (k2.t - k1.t);
  const curve = (pick: (k: Key) => number) => spline(pick(k0), pick(k1), pick(k2), pick(k3), u);
  return {
    // The position follows a curve, so the flight has no corners.
    position: {
      x: curve((k) => k.position.x),
      y: curve((k) => k.position.y),
      z: curve((k) => k.position.z),
    },
    // The target moves in straight eased steps: a curve here would swing the view past its mark.
    target: {
      x: lerp(k1.target.x, k2.target.x, ease(u)),
      y: lerp(k1.target.y, k2.target.y, ease(u)),
      z: lerp(k1.target.z, k2.target.z, ease(u)),
    },
  };
}

/** Lay out the panels and fly the camera past every one of them. */
export function buildTour(inputs: TourInput[], options: TourOptions = {}): Tour {
  if (inputs.length === 0) throw new Error('A tour needs at least one capture');
  const o = { ...DEFAULTS, ...options };
  const panels = layoutPanels(inputs, o);
  const box = bounds(panels);
  const centre: Vec3 = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: 0 };
  const spanX = box.max.x - box.min.x;
  const spanY = box.max.y - box.min.y;
  // Far enough back to hold the whole estate, whichever way it is longer.
  const wide = Math.max(
    standOff(spanX, o.fov, o.frameAspect),
    standOff(spanY * o.frameAspect, o.fov, o.frameAspect),
  );
  const near = standOff(o.panelWidth, o.fov, o.frameAspect);
  const screen = o.panelWidth / o.frameAspect;

  const keys: Key[] = [];
  const shots: Shot[] = [];
  let t = 0;
  const key = (position: Vec3, target: Vec3) => keys.push({ t, position, target });

  // Establishing: the whole estate, drifting in.
  key({ x: centre.x - spanX * 0.08, y: centre.y + spanY * 0.05, z: wide * 1.12 }, centre);
  t += 3;
  key({ x: centre.x, y: centre.y, z: wide }, centre);
  shots.push({ kind: 'establish', start: 0, end: t });

  for (const panel of panels) {
    const topView: Vec3 = { x: panel.top.x, y: panel.top.y - screen / 2, z: 0 };
    const travel = Math.min(
      2.6,
      1.2 +
        Math.hypot(
          panel.top.x - keys[keys.length - 1].position.x,
          panel.top.y - keys[keys.length - 1].position.y,
        ) *
          0.035,
    );
    const from = t;
    t += travel;
    key({ ...topView, z: near }, topView);
    shots.push({ kind: 'approach', slug: panel.slug, start: from, end: t });

    const drop = Math.max(0, panel.height - screen);
    if (drop > 1e-6) {
      const bottomView: Vec3 = { x: panel.top.x, y: panel.top.y - panel.height + screen / 2, z: 0 };
      const start = t;
      t += Math.max(1.2, (drop / screen) * o.secondsPerScreen);
      key({ ...bottomView, z: near }, bottomView);
      shots.push({ kind: 'descend', slug: panel.slug, start, end: t });
    } else {
      const start = t;
      t += 1.2;
      key({ ...topView, z: near * 0.96 }, topView);
      shots.push({ kind: 'descend', slug: panel.slug, start, end: t });
    }
  }

  const start = t;
  t += 3;
  key({ x: centre.x + spanX * 0.06, y: centre.y, z: wide * 1.08 }, centre);
  shots.push({ kind: 'depart', start, end: t });

  const duration = t;
  const count = Math.round(duration * o.sampleRate) + 1;
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  const samples: CameraSample[] = [];
  for (let i = 0; i < count; i++) {
    const s = cameraAt(keys, Math.min(duration, i / o.sampleRate));
    samples.push({
      position: { x: round(s.position.x), y: round(s.position.y), z: round(s.position.z) },
      target: { x: round(s.target.x), y: round(s.target.y), z: round(s.target.z) },
    });
  }
  return { panels, shots, duration, sampleRate: o.sampleRate, samples, fov: o.fov };
}
