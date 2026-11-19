// Mock chalk (ESM module that doesn't work with Jest)
jest.mock('chalk', () => ({
  __esModule: true,
  default: {
    gray: (s: string) => s,
    blue: (s: string) => s,
    cyan: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    white: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
  },
}));

import { exportFileName, exportMatrix, judge } from '../postprod/export-run';

const take = { seconds: 16.4, width: 1280, height: 720, videoCodec: 'h264', audio: true };
const good = { ...take, width: 1920, height: 1080, bytes: 5_000_000 };

describe('export matrix', () => {
  it('is every format with every aspect', () => {
    expect(exportMatrix({ formats: ['mp4', 'webm'], aspects: ['16:9', '9:16'] })).toEqual([
      { format: 'mp4', aspect: '16:9' },
      { format: 'mp4', aspect: '9:16' },
      { format: 'webm', aspect: '16:9' },
      { format: 'webm', aspect: '9:16' },
    ]);
  });

  it('adds each platform preset and drops what is already asked for', () => {
    const targets = exportMatrix({
      formats: ['mp4'],
      aspects: ['16:9'],
      platforms: ['youtube', 'tiktok'],
    });
    expect(targets).toEqual([
      { format: 'mp4', aspect: '16:9' },
      { format: 'mp4', aspect: '9:16', platform: 'tiktok' },
    ]);
  });

  it('refuses unknown names instead of defaulting', () => {
    expect(() => exportMatrix({ formats: ['avi'], aspects: ['16:9'] })).toThrow('Unknown format');
    expect(() => exportMatrix({ formats: ['mp4'], aspects: ['3:2'] })).toThrow('Unknown aspect');
    expect(() => exportMatrix({ platforms: ['myspace'] })).toThrow('Unknown platform');
  });

  it('refuses an empty or half-given request', () => {
    expect(() => exportMatrix({})).toThrow('Nothing to export');
    expect(() => exportMatrix({ formats: ['mp4'] })).toThrow('together');
    expect(() => exportMatrix({ aspects: ['16:9'] })).toThrow('together');
  });
});

describe('judging an output', () => {
  const target = { format: 'mp4', aspect: '16:9' };

  it('passes a file that matches its target and the take', () => {
    expect(judge(target, good, take)).toBeNull();
  });

  it.each([
    [{ bytes: 0 }, 'empty'],
    [{ width: 1280, height: 720 }, 'expected 1920x1080'],
    [{ videoCodec: 'vp9' }, 'expected h264'],
    [{ seconds: 8 }, 'the take lasts 16.40s'],
    [{ audio: false }, 'has sound and this file has none'],
  ])('fails %j', (change, reason) => {
    expect(judge(target, { ...good, ...change }, take)).toContain(reason);
  });

  it('allows the small difference containers make in length', () => {
    expect(judge(target, { ...good, seconds: 16.8 }, take)).toBeNull();
    expect(judge(target, { ...good, seconds: 17.0 }, take)).not.toBeNull();
  });

  it('does not ask a silent format or a silent take for sound', () => {
    const gif = { ...good, videoCodec: 'gif', audio: false };
    expect(judge({ format: 'gif', aspect: '16:9' }, gif, take)).toBeNull();
    expect(judge(target, { ...good, audio: false }, { ...take, audio: false })).toBeNull();
  });

  it('checks the size of the aspect asked for', () => {
    const tall = { ...good, width: 1080, height: 1920 };
    expect(judge({ format: 'mp4', aspect: '9:16' }, tall, take)).toBeNull();
    expect(judge({ format: 'mp4', aspect: '9:16' }, good, take)).toContain('expected 1080x1920');
  });
});

describe('export file names', () => {
  it('keeps formats that share an extension apart', () => {
    const mp4 = exportFileName('take', { format: 'mp4', aspect: '16:9' });
    const hevc = exportFileName('take', { format: 'hevc', aspect: '16:9' });
    expect(mp4).toBe('take_mp4_16x9.mp4');
    expect(hevc).toBe('take_hevc_16x9.mp4');
  });
});
