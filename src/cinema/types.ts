/**
 * Cinematic stage types.
 *
 * A capture is a still of the whole page plus the places worth looking at. A screenplay is a list of
 * shots over that still. Both are plain data, so a trailer is reproducible from its inputs.
 */

import { PointerTrack } from '../pointer/motion';

export type LandmarkKind = 'h1' | 'h2' | 'cta';

export interface Landmark {
  kind: LandmarkKind;
  text: string;
  /** Page pixels, from the top-left of the capture. */
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * For a call to action: how much it stands out from what is behind it, 0 to 1. A solid button in
   * the brand colour is high; a faint outline button is near zero. Absent in older captures.
   */
  weight?: number;
}

export interface PageCapture {
  url: string;
  title: string;
  /** Size of the still in page pixels. */
  width: number;
  height: number;
  /** File name of the still, relative to the stage document. */
  image: string;
  /** The page's own background colour, as CSS. */
  background: string;
  landmarks: Landmark[];
}

/** Where the camera is: which page point sits at the centre of the frame, how close, how tilted. */
export interface Camera {
  cx: number;
  cy: number;
  /** Frame pixels per page pixel. */
  scale: number;
  /** Degrees. */
  rx: number;
  ry: number;
  rz: number;
  /** Lens blur in frame pixels, for title cards and rack focus. */
  blur: number;
  /** 0 is black, 1 is the page as captured. */
  light: number;
}

export type Ease = 'linear' | 'inOut' | 'out';

export interface TitleCard {
  text: string;
  sub?: string;
}

export interface Shot {
  name: string;
  /** Seconds from the start of the trailer. */
  start: number;
  duration: number;
  from: Camera;
  to: Camera;
  ease: Ease;
  title?: TitleCard;
  /** Seconds of fade from black at the head of the shot, and to black at its tail. */
  fadeIn: number;
  fadeOut: number;
}

export interface Screenplay {
  /** Output frame, in pixels. */
  frame: { w: number; h: number };
  duration: number;
  shots: Shot[];
  /** The pointer's part, when the trailer has a protagonist. */
  pointer?: PointerTrack;
}
