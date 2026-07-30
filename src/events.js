import { state } from './state.js';
import { flyCameraTo } from './camera.js';

/* =========================================================================
   EVENT SYSTEM — the clickable timeline log plus the short-lived toast
   banner used for dramatic moments (captures, supernovae, mergers, ...).
   ========================================================================= */
export function fmtClock(t) {
  const h = String(Math.floor(t / 3600)).padStart(2, '0');
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
  const s = String(Math.floor(t % 60)).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
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
  while (body.children.length > 80) body.removeChild(body.lastChild);
}

export function showBanner(text) {
  const el = document.getElementById('notify-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add('hidden'), 2600);
}
