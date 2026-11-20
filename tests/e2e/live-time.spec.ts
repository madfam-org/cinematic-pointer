/**
 * Live time: a page's own motion is frame-exact once its clock is frozen.
 *
 * The page below has three clocks: a requestAnimationFrame loop that writes how long it has run, a
 * CSS animation, and a timer. After freezing, advancing to a time must leave all three exactly
 * there, however long the test machine takes between steps.
 */
import { expect, test } from '@playwright/test';

import { installLiveTime, settle } from '../../src/recorders/livetime';

const PAGE = `<!doctype html><html><body>
<div id="raf">0</div><div id="timer">0</div>
<div id="box" style="width:10px;height:10px;background:red;animation:slide 4s linear infinite"></div>
<style>@keyframes slide { from { margin-left: 0px } to { margin-left: 400px } }</style>
<script>
  var start = performance.now();
  function tick(now) { document.getElementById('raf').textContent = String(Math.round(now - start)); requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  var count = 0;
  setInterval(function () { document.getElementById('timer').textContent = String(++count); }, 100);
</script></body></html>`;

test.describe('live time', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'one engine is enough for timing');

  test('script time, CSS animation and timers stop and advance exactly', async ({ page }) => {
    await installLiveTime(page);
    await page.setContent(PAGE);
    const clock = await settle(page, 0.5);
    const raf0 = Number(await page.textContent('#raf'));
    const timer0 = Number(await page.textContent('#timer'));
    const left0 = await page.$eval('#box', (el) => parseFloat(getComputedStyle(el).marginLeft));

    // Real time passes; nothing on the page may move.
    await page.waitForTimeout(400);
    expect(Number(await page.textContent('#raf'))).toBe(raf0);
    expect(await page.$eval('#box', (el) => parseFloat(getComputedStyle(el).marginLeft))).toBe(
      left0,
    );

    await clock.advanceTo(1);
    const raf1 = Number(await page.textContent('#raf'));
    expect(raf1 - raf0).toBeGreaterThanOrEqual(984);
    expect(raf1 - raf0).toBeLessThanOrEqual(1000);
    expect(Number(await page.textContent('#timer')) - timer0).toBe(10);
    const left1 = await page.$eval('#box', (el) => parseFloat(getComputedStyle(el).marginLeft));
    // 1 s of a 400 px, 4 s linear slide is 100 px, modulo the loop.
    expect(((left1 - left0 + 400) % 400).toFixed(3)).toBe('100.000');
  });

  test('two takes of the same page draw the same picture, however slowly they load', async ({
    browser,
  }) => {
    const shots: Buffer[] = [];
    for (let run = 0; run < 2; run++) {
      const page = await browser.newPage();
      await installLiveTime(page);
      // The second take loads slowly in real time; page time must not notice.
      if (run === 1) await page.route('**/*', async (r) => r.continue());
      await page.setContent(
        `<canvas id="c" width="200" height="200"></canvas><script>
          var ctx = document.getElementById('c').getContext('2d'), t0 = performance.now();
          function draw(now) { var t = (now - t0) / 1000; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 200, 200);
            ctx.fillStyle = '#000'; ctx.fillRect(100 + 80 * Math.cos(t * 3), 100 + 80 * Math.sin(t * 3), 12, 12);
            requestAnimationFrame(draw); }
          requestAnimationFrame(draw);</script>`,
      );
      if (run === 1) await page.waitForTimeout(700);
      const clock = await settle(page, 0.3);
      if (run === 1) await page.waitForTimeout(500);
      await clock.advanceTo(1.5);
      shots.push(await page.locator('#c').screenshot());
      await page.close();
    }
    expect(shots[0].equals(shots[1])).toBe(true);
  });

  test('page time does not run while the page loads', async ({ page }) => {
    await installLiveTime(page);
    await page.setContent(
      '<div id="t"></div><script>document.getElementById("t").textContent = String(Date.now());</script>',
    );
    await page.waitForTimeout(300);
    expect(Number(await page.evaluate('Date.now()'))).toBe(Number(await page.textContent('#t')));
  });
});
