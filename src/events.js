/**
 * @file events.js
 * @description Astronomical event logging, formatted timestamp generation, and toast banners.
 *
 * Provides functions for appending timeline event records with interactive spatial coordinates,
 * formatting elapsed simulation clocks, and displaying temporary on-screen notification banners.
 */

import { state } from './state.js';
import { flyCameraTo } from './camera.js';

/* ============================================================================
   FORMATTING AND EVENT LOGGING
   ============================================================================ */

/**
 * Formats a raw simulation time in seconds into a digital HH:MM:SS clock string.
 *
 * @param {number} t - Time in simulation seconds.
 * @returns {string} Zero-padded formatted string (e.g. "01:24:08").
 */
export function fmtClock(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Appends a classified event message to the observatory log panel.
 * When spatial coordinates are provided, attaches an interactive click listener
 * that moves the camera to focus on the event location.
 *
 * @param {string} text - Human-readable description of the astronomical event.
 * @param {'info'|'critical'} [level='info'] - Severity classification for UI styling.
 * @param {THREE.Vector3|null} [position=null] - World-space origin of the event.
 */
export function logEvent(text, level = 'info', position = null) {
  const body = document.getElementById('log-body');
  const div = document.createElement('div');
  div.className = 'log-entry event-' + level + (position ? ' clickable' : '');
  const yearLabel = 'YEAR ' + Math.max(0, Math.floor(state.simYears)).toLocaleString();
  div.innerHTML = `<span class="log-time">${yearLabel}${position ? ' \u2197' : ''}</span>${text}`;
  if (position) {
    const p = position.clone();
    div.title = 'Click to jump to this location';
    div.addEventListener('click', () => flyCameraTo(p, 55, 1200));
  }
  body.prepend(div);
  // Cap the DOM list length to maintain render performance
  while (body.children.length > 80) body.removeChild(body.lastChild);
}

/**
 * Displays a high-visibility notification banner in the center overlay.
 * Automatically clears previous timeout handles to support rapid event sequences.
 *
 * @param {string} text - Banner headline text.
 */
export function showBanner(text) {
  const el = document.getElementById('notify-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add('hidden'), 2600);
}
