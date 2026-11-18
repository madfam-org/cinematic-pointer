import { PlaywrightWebDriver } from '../drivers/playwright';

describe('PlaywrightWebDriver options', () => {
  it('keeps recording and overlay when they are requested', () => {
    const driver = new PlaywrightWebDriver({
      recording: { enabled: true, outputDir: 'artifacts' },
      overlay: { enabled: true },
    });
    expect(driver.capabilities()).toEqual({ recording: true, overlay: true });
  });

  it('records and overlays nothing by default', () => {
    expect(new PlaywrightWebDriver().capabilities()).toEqual({ recording: false, overlay: false });
  });
});
