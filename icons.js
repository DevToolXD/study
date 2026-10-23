'use strict';

/* Hand-drawn line icons on a 24px grid. No emoji anywhere in the app. */
const ICONS = {
  /* interface */
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  stack: '<path d="M12 3.5l9 5-9 5-9-5 9-5z"/><path d="M3 12.8l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  bookmark: '<path d="M7 4h10a1 1 0 011 1v15l-6-4-6 4V5a1 1 0 011-1z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  doc: '<path d="M7 3h7l4 4v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v4h4M9.5 12h5M9.5 16h5"/>',
  pencil: '<path d="M4 20l1-4L16.5 4.5a2 2 0 012.8 0l.2.2a2 2 0 010 2.8L8 19z"/><path d="M14 7l3 3"/>',
  trash: '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l.8 12.5h8.4L17 7M10 11v5M14 11v5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  retry: '<path d="M19 12a7 7 0 11-2.1-5M19 4v4.5h-4.5"/>',
  shuffle: '<path d="M4 7h3c4 0 5 10 9 10h4M4 17h3c1.6 0 2.7-1.6 3.8-3.2M16 7h4M20 7l-2.2-2.2M20 7l-2.2 2.2M20 17l-2.2-2.2M20 17l-2.2 2.2"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 01-14.6 5.9L3.5 15.5"/><path d="M3.5 12a8.5 8.5 0 0114.6-5.9l2.4 2.4"/><path d="M3.5 20v-4.500h4.500M20.500 4v4.500h-4.500"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="M7.200 9.500l3 2.500-3 2.500M12.800 15h4.200"/>',
  share: '<path d="M12 3.500v11M8.200 7.300L12 3.500l3.800 3.800"/><path d="M7.500 11H6.800A1.800 1.800 0 005 12.800v6.400A1.800 1.800 0 006.800 21h10.400a1.800 1.800 0 001.800-1.800v-6.400A1.800 1.800 0 0017.200 11h-.7"/>',
  xcircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  checkcircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.500l2.800 2.800L16 9.800"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.500M12 7.600h.01" stroke-width="2.200"/>',
  list: '<path d="M9.500 6h10.500M9.500 12h10.500M9.500 18h10.500"/><circle cx="4.800" cy="6" r="1.100" fill="currentColor" stroke="none"/><circle cx="4.800" cy="12" r="1.100" fill="currentColor" stroke="none"/><circle cx="4.800" cy="18" r="1.100" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M11 3.500l1.900 5.600 5.600 1.900-5.600 1.900L11 18.500l-1.900-5.600L3.500 11l5.600-1.900z"/><path d="M19 15.500l.8 2.200 2.200.8-2.200.8-.8 2.200-.8-2.200-2.200-.8 2.200-.8z"/>',

  /* subject glyphs (picked in the subject sheet) */
  book: '<path d="M12 6.500C10.300 5.200 7.800 4.600 4.500 4.800v12.900c3.300-.2 5.800.4 7.500 1.700"/><path d="M12 6.500c1.700-1.300 4.200-1.900 7.500-1.700v12.900c-3.300-.2-5.800.4-7.500 1.700z"/>',
  type: '<text x="12" y="17.200" text-anchor="middle" font-size="13.500" font-weight="800" fill="currentColor" stroke="none" font-family="-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif">Aa</text>',
  calc: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.500 7.500h7"/><path d="M8.500 12h.01M12 12h.01M15.500 12h.01M8.500 16h.01M12 16h.01M15.500 16h.01" stroke-width="2.600"/>',
  flask: '<path d="M9.500 3.500h5"/><path d="M10.200 3.500v5.600L5 18.200a2 2 0 001.700 3h10.600a2 2 0 001.700-3l-5.200-9.100V3.500"/><path d="M7.400 14.600h9.200"/>',
  atom: '<circle cx="12" cy="12" r="1.600" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="9.200" ry="3.800"/><ellipse cx="12" cy="12" rx="9.200" ry="3.800" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.200" ry="3.800" transform="rotate(120 12 12)"/>',
  leaf: '<path d="M5 19c-.4-8.300 4.200-13.500 14.500-14.500C20.200 14.800 14.800 19.600 5 19z"/><path d="M5 19c2.400-4.200 5.500-7.400 9.500-9.500"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.600 2.400 4 5.500 4 9s-1.400 6.600-4 9c-2.600-2.400-4-5.500-4-9s1.400-6.600 4-9z"/>',
  columns: '<path d="M3 9.500L12 4l9 5.500z"/><path d="M6 12.500v5M10 12.500v5M14 12.500v5M18 12.500v5"/><path d="M3.500 20h17"/>',
  hourglass: '<path d="M6.500 3.500h11M6.500 20.500h11"/><path d="M7.500 3.500c0 4.500 2.500 5.700 4.500 8.500-2 2.800-4.500 4-4.500 8.500M16.500 3.500c0 4.500-2.500 5.700-4.500 8.500 2 2.800 4.500 4 4.500 8.500"/>',
  code: '<path d="M8.500 7.500L4 12l4.500 4.500M15.500 7.500L20 12l-4.500 4.500M13.500 5.500l-3 13"/>',
  music: '<path d="M9 17.500V6l10-2v11.500"/><circle cx="6.500" cy="17.500" r="2.500"/><circle cx="16.500" cy="15.500" r="2.500"/>',
  palette: '<path d="M12 3.500a8.500 8.500 0 100 17c1.500 0 2.200-.9 1.900-2-.3-1.100.4-2.200 1.700-2.200H18a2.700 2.700 0 002.700-2.700C20.700 7 16.900 3.500 12 3.500z"/><path d="M7.600 11h.01M10 7.500h.01M14.500 7.500h.01" stroke-width="2.600"/>',
  bulb: '<path d="M9 18.500h6M10.200 21h3.600"/><path d="M12 3a6 6 0 00-3.600 10.800c.7.600 1.100 1.400 1.100 2.200h5c0-.8.400-1.600 1.100-2.200A6 6 0 0012 3z"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18"/><path d="M5.500 5.800c2.900 3.300 2.900 9.100 0 12.400M18.500 5.800c-2.900 3.300-2.900 9.100 0 12.400"/>',
  chart: '<path d="M5.500 20v-8.500M12 20V4.500M18.500 20v-6" stroke-width="2.600"/>',
  star: '<path d="M12 3.500l2.600 5.400 5.900.8-4.300 4.100 1.100 5.900L12 16.900l-5.300 2.800 1.100-5.900L3.500 9.700l5.900-.8z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.500 8.500l-2 5-5 2 2-5z"/>'
};

/* the glyphs offered for a subject, in picker order */
const SUBJECT_ICONS = ['book', 'type', 'calc', 'flask', 'atom', 'leaf', 'globe', 'columns', 'hourglass', 'code', 'music', 'palette', 'pencil', 'bulb', 'ball', 'chart', 'star', 'compass'];

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.book}</svg>`;
}
