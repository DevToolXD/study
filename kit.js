'use strict';

/* DOM helper and motion toolkit.
   Everything that moves goes through anim(), so reduced motion is honoured in one place:
   with it on, only fades survive and they are short. The easings are the same springs the
   stylesheet declares (--spring, --spring-soft, --spring-bounce), read back from CSS. */

/* ---------- dom ---------- */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
function icon(name, cls) {
  const s = h('span', { class: 'ico' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
  s.innerHTML = iconSvg(name);   // static markup from icons.js, never user text
  return s;
}
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------- easing ---------- */
const easeCache = {};
function ease(name) {
  if (name in easeCache) return easeCache[name];
  let v = '';
  try { v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); } catch { /* no styles yet */ }
  return (easeCache[name] = v || 'cubic-bezier(.22, 1, .36, 1)');
}

/* ---------- animation ---------- */
const DONE = { finished: Promise.resolve(), cancel() {}, finish() {}, reversed: true };

/* frames: WAAPI keyframes. With reduced motion only opacity is kept, and short. */
function anim(el, frames, { dur = 440, easing = 'spring', delay = 0, fill = 'backwards', ...rest } = {}) {
  if (!el || !el.animate) return DONE;
  let f = frames;
  if (reduceMotion()) {
    f = frames.filter(k => 'opacity' in k).map(k => ({ opacity: k.opacity, ...(k.offset != null ? { offset: k.offset } : {}) }));
    if (f.length < 2) return DONE;
    dur = Math.min(dur, 160); delay = 0;
  }
  const named = !/[(]/.test(easing) && !['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear'].includes(easing);
  const a = el.animate(f, { duration: dur, easing: named ? ease(easing) : easing, delay, fill, ...rest });
  a.finished.catch(() => {});
  return a;
}
const rise = (el, { y = 16, scale = 0.985, delay = 0, dur = 560, easing = 'spring' } = {}) =>
  anim(el, [{ opacity: 0, transform: `translate3d(0, ${y}px, 0) scale(${scale})` }, { opacity: 1, transform: 'none' }], { dur, delay, easing });
const fade = (el, { delay = 0, dur = 280 } = {}) => anim(el, [{ opacity: 0 }, { opacity: 1 }], { dur, delay, easing: 'ease-out' });
const pop = (el, { delay = 0, from = 0.82, dur = 620 } = {}) =>
  anim(el, [{ opacity: 0, transform: `scale(${from})` }, { opacity: 1, transform: 'none' }], { dur, delay, easing: 'spring-bounce' });
const pulse = (el, amount = 1.04) => anim(el, [{ transform: 'scale(1)' }, { transform: `scale(${amount})`, offset: 0.35 }, { transform: 'scale(1)' }], { dur: 520, easing: 'spring-bounce', fill: 'none' });
const shake = el => anim(el, [
  { transform: 'translateX(0)' }, { transform: 'translateX(-9px)', offset: 0.14 }, { transform: 'translateX(8px)', offset: 0.32 },
  { transform: 'translateX(-6px)', offset: 0.5 }, { transform: 'translateX(4px)', offset: 0.7 }, { transform: 'translateX(-2px)', offset: 0.86 }, { transform: 'translateX(0)' }
], { dur: 460, easing: 'ease-out', fill: 'none' });

/* children enter one after another (the first few only, so long lists don't crawl) */
function stagger(parent, { from = 0, step = 38, max = 9, y = 16, selector } = {}) {
  const kids = selector ? [...parent.querySelectorAll(selector)] : [...parent.children];
  kids.slice(from).forEach((k, i) => rise(k, { y, delay: Math.min(i, max) * step }));
}

/* grow from nothing to its natural height (feedback panels, banners) */
function reveal(el, { dur = 520 } = {}) {
  if (reduceMotion()) return fade(el);
  const to = el.getBoundingClientRect().height;
  const prev = el.style.overflow;
  el.style.overflow = 'hidden';
  const a = anim(el, [{ height: '0px', opacity: 0, transform: 'translateY(-8px)' }, { height: to + 'px', opacity: 1, transform: 'none' }], { dur, easing: 'spring-soft', fill: 'none' });
  a.finished.then(() => { el.style.overflow = prev; }).catch(() => { el.style.overflow = prev; });
  return a;
}
function collapse(el, { dur = 320 } = {}) {
  const from = el.getBoundingClientRect().height;
  el.style.overflow = 'hidden';
  const a = anim(el, [{ height: from + 'px', opacity: 1 }, { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }], { dur, easing: 'ease-in-out', fill: 'forwards' });
  return a.finished.then(() => {}, () => {});
}

/* a number that counts up to its value */
function countUp(el, to, { dur = 900, suffix = '', from = 0 } = {}) {
  const set = v => { el.textContent = Math.round(v) + suffix; };
  if (reduceMotion() || !isFinite(to) || to === from) { set(to); return; }
  const t0 = performance.now();
  set(from);
  const tick = now => {
    const t = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - t, 4);
    set(from + (to - from) * e);
    if (t < 1 && el.isConnected) requestAnimationFrame(tick); else set(to);
  };
  requestAnimationFrame(tick);
}

/* a ring or bar that fills: the stylesheet transitions the property, this just sets it after first paint */
function fillLater(apply) {
  if (reduceMotion()) { apply(true); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => apply(false)));
}

/* a burst of small pieces from a point inside host */
function burst(host, { n = 26, x = 0.5, y = 0.45, colors = ['#4C9DFF', '#43C77B', '#FFA24A', '#FF6FA0', '#9C7BFF', '#3CCFD0'] } = {}) {
  if (reduceMotion() || !host) return;
  const r = host.getBoundingClientRect();
  const layer = h('div', { class: 'burst', 'aria-hidden': 'true' });
  host.append(layer);
  for (let i = 0; i < n; i++) {
    const p = h('i', { style: `background:${colors[i % colors.length]};left:${x * r.width}px;top:${y * r.height}px;width:${6 + (i % 3) * 3}px;height:${i % 2 ? 6 + (i % 3) * 3 : 4}px;border-radius:${i % 3 === 0 ? '50%' : '2px'}` });
    layer.append(p);
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5, dist = 70 + Math.random() * 120;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 40, rot = (Math.random() - 0.5) * 540;
    anim(p, [
      { opacity: 1, transform: 'translate3d(0,0,0) rotate(0deg) scale(.4)' },
      { opacity: 1, transform: `translate3d(${dx * 0.7}px, ${dy * 0.7}px, 0) rotate(${rot * 0.6}deg) scale(1)`, offset: 0.45 },
      { opacity: 0, transform: `translate3d(${dx}px, ${dy + 90}px, 0) rotate(${rot}deg) scale(.9)` }
    ], { dur: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards', delay: Math.random() * 90 });
  }
  setTimeout(() => layer.remove(), 1900);
}

/* ---------- touch: a light that follows the finger on glass, and keyboard-only focus rings ---------- */
function initTouchFx() {
  let lit = null;
  const place = (t, e) => {
    const r = t.getBoundingClientRect();
    t.style.setProperty('--lx', clamp(e.clientX - r.left, 0, r.width) + 'px');
    t.style.setProperty('--ly', clamp(e.clientY - r.top, 0, r.height) + 'px');
  };
  document.addEventListener('pointerdown', e => {
    document.documentElement.classList.remove('kbd');
    const t = e.target.closest && e.target.closest('.lit');
    if (!t) return;
    lit = t; place(t, e);
  }, { passive: true });
  document.addEventListener('pointermove', e => { if (lit) place(lit, e); }, { passive: true });
  const end = () => { lit = null; };
  document.addEventListener('pointerup', end, { passive: true });
  document.addEventListener('pointercancel', end, { passive: true });
  document.addEventListener('keydown', e => { if (e.key === 'Tab') document.documentElement.classList.add('kbd'); });
}
