// The landing's script: copy controls, the film's two buttons, and lobby cards that play their shot.
// The page reads the same with scripts off: the film keeps the browser's own controls and the cards
// stay stills.
(() => {
  'use strict';
  const CLIP = '/footage/enclii-landing-take.mp4';
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** Swap a control's two labels. */
  const show = (
    /** @type {Element} */ el,
    /** @type {string} */ on,
    /** @type {string} */ off,
    /** @type {boolean} */ state,
  ) => {
    const a = el.querySelector(`[${on}]`);
    const b = el.querySelector(`[${off}]`);
    if (a) a.toggleAttribute('hidden', !state);
    if (b) b.toggleAttribute('hidden', state);
  };

  // Copy controls.
  for (const button of document.querySelectorAll('[data-copy]')) {
    const source = document.getElementById(button.getAttribute('data-copy') ?? '');
    if (!source || !navigator.clipboard) {
      button.setAttribute('hidden', '');
      continue;
    }
    let timer = 0;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.textContent ?? '');
      } catch {
        return; // the command stays selectable by hand
      }
      button.classList.add('is-done');
      show(button, 'data-done', 'data-idle', true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        button.classList.remove('is-done');
        show(button, 'data-done', 'data-idle', false);
      }, 1800);
    });
  }

  // The film in the feature card.
  const film = /** @type {HTMLVideoElement | null} */ (document.getElementById('feature'));
  const reel = document.querySelector('[data-reel]');
  if (film && reel) {
    const play = reel.querySelector('[data-reel-play]');
    const sound = reel.querySelector('[data-reel-sound]');
    film.removeAttribute('controls');
    reel.removeAttribute('hidden');
    const sync = () => {
      if (play) {
        play.setAttribute('aria-pressed', String(!film.paused));
        show(play, 'data-on', 'data-off', !film.paused);
      }
      if (sound) {
        sound.setAttribute('aria-pressed', String(!film.muted));
        show(sound, 'data-on', 'data-off', !film.muted);
      }
    };
    play?.addEventListener('click', () =>
      film.paused ? film.play().catch(() => {}) : film.pause(),
    );
    sound?.addEventListener('click', () => {
      film.muted = !film.muted;
      if (!film.muted && film.paused) film.play().catch(() => {});
      sync();
    });
    for (const name of ['play', 'pause', 'volumechange']) film.addEventListener(name, sync);
    if (!calm.matches) film.play().catch(() => {});
    sync();
  }

  // Lobby cards: choosing one plays that shot inside the card, then it settles back to its still.
  /** @type {{ card: Element, video: HTMLVideoElement, stop: () => void } | null} */
  let showing = null;
  for (const card of document.querySelectorAll('[data-shot]')) {
    const still = card.querySelector('.lobby__still');
    const button = card.querySelector('.lobby__play');
    const from = Number(card.getAttribute('data-from'));
    const to = Number(card.getAttribute('data-to'));
    if (!still || !button || !(to > from)) continue;
    button.removeAttribute('hidden');
    button.addEventListener('click', () => {
      if (showing) {
        const same = showing.card === card;
        showing.stop();
        if (same) return;
      }
      const video = document.createElement('video');
      video.className = 'shotfilm';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.setAttribute('aria-hidden', 'true');
      video.tabIndex = -1;
      video.src = `${CLIP}#t=${from},${to}`;
      const stop = () => {
        video.pause();
        video.remove();
        card.classList.remove('is-playing');
        button.setAttribute('aria-pressed', 'false');
        if (showing && showing.video === video) showing = null;
      };
      video.addEventListener('timeupdate', () => {
        if (video.currentTime >= to - 0.04) stop();
      });
      video.addEventListener('ended', stop);
      video.addEventListener('error', stop);
      video.addEventListener(
        'loadedmetadata',
        () => {
          video.currentTime = from;
          video.play().catch(stop);
        },
        { once: true },
      );
      still.insertBefore(video, button);
      card.classList.add('is-playing');
      button.setAttribute('aria-pressed', 'true');
      showing = { card, video, stop };
    });
  }
})();
