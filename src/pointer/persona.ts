/**
 * Personas
 *
 * A persona is the user whose hand the pointer stands for. It decides how the pointer moves (how
 * fast, how directly, how long it thinks before it acts) and what it wears in each state. Plain
 * data: a product can ship its own persona as a JSON file.
 */
import { readFile } from 'fs/promises';

import { OUTFITS, OutfitId } from './outfits';

/** What the pointer is doing; the persona's wardrobe maps each to an outfit. */
export type PointerState = 'travel' | 'hover' | 'press' | 'read' | 'wait' | 'drag' | 'inspect';

export const POINTER_STATES: PointerState[] = [
  'travel',
  'hover',
  'press',
  'read',
  'wait',
  'drag',
  'inspect',
];

export interface Persona {
  id: string;
  /** Who this is, in a few words. */
  spirit: string;
  /** Speed of travel. 1 is unhurried and sure; above 1 is quicker. 0.5 to 2. */
  pace: number;
  /** How far a move bows away from the straight line, as a share of its length. -0.4 to 0.4. */
  bow: number;
  /** Seconds the pointer rests on a control before pressing it. 0 to 1.5. */
  hesitation: number;
  /** Whether the pointer follows a heading as if reading it, or only looks at it. */
  reads: boolean;
  /** Width of the pointer in frame pixels, on a 1280-wide frame; it scales with the frame. */
  size: number;
  ink: string;
  fill: string;
  /** Colour of the ring a press leaves behind. */
  ring: string;
  wardrobe: Record<PointerState, OutfitId>;
}

const WARDROBE: Record<PointerState, OutfitId> = {
  travel: 'arrow',
  hover: 'point',
  press: 'press',
  read: 'text',
  wait: 'wait',
  drag: 'move',
  inspect: 'inspect',
};

const base: Omit<Persona, 'id' | 'spirit'> = {
  pace: 1,
  bow: 0.12,
  hesitation: 0.35,
  reads: true,
  size: 64,
  ink: '#0b0d12',
  fill: '#ffffff',
  ring: 'rgba(255, 255, 255, 0.9)',
  wardrobe: WARDROBE,
};

export const PERSONAS: Record<string, Persona> = {
  guide: { ...base, id: 'guide', spirit: 'Someone showing a friend around: calm and clear.' },
  operator: {
    ...base,
    id: 'operator',
    spirit: 'Runs the floor and knows the screen: fast, straight, no second thoughts.',
    pace: 1.5,
    bow: 0.03,
    hesitation: 0.08,
    reads: false,
    size: 74,
    fill: '#ffd23f',
    ring: 'rgba(255, 210, 63, 0.95)',
  },
  analyst: {
    ...base,
    id: 'analyst',
    spirit: 'Answers for the numbers: reads first, checks, then commits.',
    pace: 0.8,
    bow: 0.06,
    hesitation: 0.9,
    size: 58,
    fill: '#e9f2ff',
    ring: 'rgba(120, 180, 255, 0.95)',
    wardrobe: { ...WARDROBE, travel: 'inspect' },
  },
  explorer: {
    ...base,
    id: 'explorer',
    spirit: 'New here and curious: wanders in wide arcs and lingers.',
    pace: 0.9,
    bow: 0.3,
    hesitation: 0.6,
    fill: '#b8ffe6',
    ring: 'rgba(0, 224, 164, 0.95)',
  },
  maker: {
    ...base,
    id: 'maker',
    spirit: 'Designs and builds: precise, frames the thing before touching it.',
    pace: 1.1,
    bow: 0.08,
    hesitation: 0.25,
    reads: false,
    fill: '#ffe3d1',
    ring: 'rgba(255, 140, 80, 0.95)',
    wardrobe: { ...WARDROBE, travel: 'frame', inspect: 'frame' },
  },
};

const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\))$/;

function inRange(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Persona ${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

/** Check a persona read from a file. Fields left out take the guide's values. */
export function parsePersona(raw: unknown): Persona {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('A persona is a JSON object');
  }
  const input = raw as Record<string, unknown>;
  const merged = { ...base, ...input } as Record<string, unknown>;
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(input.id)) {
    throw new Error('Persona id must be lowercase letters, digits and dashes');
  }
  for (const key of ['ink', 'fill', 'ring']) {
    if (typeof merged[key] !== 'string' || !COLOUR.test(merged[key] as string)) {
      throw new Error(`Persona ${key} must be a hex or rgb colour`);
    }
  }
  const wardrobe = { ...WARDROBE };
  const given = input.wardrobe;
  if (given !== undefined) {
    if (typeof given !== 'object' || given === null)
      throw new Error('Persona wardrobe is an object');
    for (const [state, outfit] of Object.entries(given as Record<string, unknown>)) {
      if (!POINTER_STATES.includes(state as PointerState)) {
        throw new Error(`Persona wardrobe has no state "${state}"`);
      }
      if (typeof outfit !== 'string' || !(outfit in OUTFITS)) {
        throw new Error(`Persona wardrobe names an unknown outfit for "${state}"`);
      }
      wardrobe[state as PointerState] = outfit as OutfitId;
    }
  }
  return {
    id: input.id,
    spirit: typeof input.spirit === 'string' ? input.spirit.slice(0, 200) : '',
    pace: inRange('pace', merged.pace, 0.5, 2),
    bow: inRange('bow', merged.bow, -0.4, 0.4),
    hesitation: inRange('hesitation', merged.hesitation, 0, 1.5),
    reads: merged.reads === true,
    size: inRange('size', merged.size, 16, 120),
    ink: merged.ink as string,
    fill: merged.fill as string,
    ring: merged.ring as string,
    wardrobe,
  };
}

/** A built-in persona by name, or one read from a `.json` file. */
export async function loadPersona(nameOrPath: string): Promise<Persona> {
  if (nameOrPath in PERSONAS) return PERSONAS[nameOrPath];
  if (!nameOrPath.endsWith('.json')) {
    throw new Error(
      `Unknown persona "${nameOrPath}". Use ${Object.keys(PERSONAS).join(', ')}, or a .json file.`,
    );
  }
  return parsePersona(JSON.parse(await readFile(nameOrPath, 'utf8')));
}
