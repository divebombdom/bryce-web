// Hand-drawn SVG icons in the spirit of the sculpted 1994 palette.
const wrap = (id, defs, body) => `<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true"><defs>${defs}</defs>${body}</svg>`;
const lin = (id, a, b, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const rad = (id, a, b, cx = 0.35, cy = 0.3) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.75"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
const PLANE = '5,37 17,19 45,19 33,37';
const B1 = '#a9c7ff', B2 = '#163a8c';

export const ICONS = {
  water: () => wrap('w', lin('gw', '#7cc0ea', '#0d4f86'), `<polygon points="${PLANE}" fill="url(#gw)" stroke="#06223d" stroke-width="1"/>
    <ellipse cx="25" cy="28" rx="9" ry="3.2" fill="none" stroke="#d7f0ff" stroke-opacity=".7"/><ellipse cx="25" cy="28" rx="4.5" ry="1.6" fill="none" stroke="#d7f0ff" stroke-opacity=".8"/>`),
  cloud: () => wrap('c', lin('gc', '#f7f9fc', '#8e9bb0'), `<polygon points="${PLANE}" fill="url(#gc)" stroke="#454f60" stroke-width="1"/>
    <ellipse cx="20" cy="26" rx="5" ry="2.5" fill="#fff"/><ellipse cx="29" cy="30" rx="6" ry="2.6" fill="#fff" opacity=".9"/><ellipse cx="35" cy="23" rx="4" ry="2" fill="#fff" opacity=".85"/>`),
  ground: () => wrap('g', lin('gg', '#c9a477', '#6b4a2a'), `<polygon points="${PLANE}" fill="url(#gg)" stroke="#2f1f10" stroke-width="1"/>
    <g fill="#3e2a16" opacity=".5"><circle cx="18" cy="31" r="1"/><circle cx="26" cy="25" r="1.2"/><circle cx="33" cy="30" r=".9"/><circle cx="38" cy="22" r="1"/><circle cx="23" cy="33" r=".8"/></g>`),
  terrain: () => wrap('t', lin('gt', '#9aa07a', '#3f4a2a') + lin('gts', '#ffffff', '#c9d3e0'), `<polygon points="3,41 15,20 21,27 30,9 45,41" fill="url(#gt)" stroke="#1e2414" stroke-width="1"/>
    <polygon points="30,9 34.5,17 31.5,16 29,19 26.8,16" fill="url(#gts)"/><polygon points="15,20 17.6,24.5 15.2,23.6 13.4,23.4" fill="#eef2f8"/>`),
  stone: () => wrap('s', rad('gs', '#d4d0c8', '#4a4642'), `<path d="M10 30 C8 22 14 14 22 13 C30 11 38 15 39 23 C41 31 34 37 25 37 C17 38 11 35 10 30Z" fill="url(#gs)" stroke="#24221f"/>`),
  sphere: () => wrap('sp', rad('gsp', B1, B2), `<circle cx="24" cy="24" r="15" fill="url(#gsp)" stroke="#0b1d48"/>`),
  cube: () => wrap('cu', '', `<polygon points="24,8 39,16 24,24 9,16" fill="#a9c7ff" stroke="#0b1d48"/><polygon points="9,16 24,24 24,41 9,33" fill="#3d6ad1" stroke="#0b1d48"/><polygon points="39,16 24,24 24,41 39,33" fill="#1d3f97" stroke="#0b1d48"/>`),
  cylinder: () => wrap('cy', lin('gcy', '#a9c7ff', '#163a8c', 1, 0), `<path d="M11 13 V35 A13 5 0 0 0 37 35 V13Z" fill="url(#gcy)" stroke="#0b1d48"/><ellipse cx="24" cy="13" rx="13" ry="5" fill="#c9dbff" stroke="#0b1d48"/>`),
  cone: () => wrap('co', lin('gco', '#a9c7ff', '#163a8c', 1, 0), `<path d="M24 6 L37 35 A13 5 0 0 1 11 35Z" fill="url(#gco)" stroke="#0b1d48"/>`),
  pyramid: () => wrap('py', '', `<polygon points="24,7 9,35 24,41" fill="#5b86e6" stroke="#0b1d48"/><polygon points="24,7 39,35 24,41" fill="#1d3f97" stroke="#0b1d48"/>`),
  torus: () => wrap('to', rad('gto', B1, B2, 0.4, 0.2), `<path fill-rule="evenodd" d="M24 13 C37 13 44 18 44 25 C44 32 35 36 24 36 C13 36 4 32 4 25 C4 18 11 13 24 13Z M24 21 C17 21 14 23 14 25 C14 27 18 28.5 24 28.5 C30 28.5 34 27 34 25 C34 23 31 21 24 21Z" fill="url(#gto)" stroke="#0b1d48"/>`),
  disk: () => wrap('di', lin('gdi', '#a9c7ff', '#163a8c'), `<path d="M6 24 V28 A18 7 0 0 0 42 28 V24Z" fill="#1d3f97" stroke="#0b1d48"/><ellipse cx="24" cy="24" rx="18" ry="7" fill="url(#gdi)" stroke="#0b1d48"/>`),

  materials: () => wrap('ma', rad('gma', '#ffe3a8', '#b05a14'), `<circle cx="24" cy="24" r="15" fill="url(#gma)" stroke="#3a1c06"/><path d="M12 30 Q24 18 37 30" fill="none" stroke="#3a1c06" stroke-opacity=".5" stroke-width="2"/><path d="M14 20 Q24 28 35 18" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="2"/>`),
  terrainEd: () => wrap('te', lin('gte', '#ffffff', '#222222'), `<rect x="8" y="8" width="32" height="32" rx="3" fill="url(#gte)" stroke="#111"/><path d="M8 32 L16 22 L22 27 L31 14 L40 30" fill="none" stroke="#f2a541" stroke-width="2.4" stroke-linejoin="round"/>`),
  move: () => wrap('mv', '', `<g fill="#e4ddd0" stroke="#1a1918" stroke-width="1"><path d="M24 5 L30 13 H26.5 V21.5 H35 V18 L43 24 L35 30 V26.5 H26.5 V35 H30 L24 43 L18 35 H21.5 V26.5 H13 V30 L5 24 L13 18 V21.5 H21.5 V13 H18Z"/></g>`),
  rotate: () => wrap('ro', '', `<path d="M36 16 A14 14 0 1 0 38 28" fill="none" stroke="#e4ddd0" stroke-width="4" stroke-linecap="round"/><polygon points="38,7 41,20 29,17" fill="#e4ddd0"/>`),
  scale: () => wrap('sc', '', `<rect x="7" y="21" width="20" height="20" fill="none" stroke="#9c958a" stroke-width="2"/><path d="M19 29 L39 9" stroke="#e4ddd0" stroke-width="3.2" stroke-linecap="round"/><polygon points="41,7 40,19 29,8" fill="#e4ddd0"/>`),
  duplicate: () => wrap('du', '', `<rect x="7" y="15" width="22" height="22" rx="3" fill="#5b5852" stroke="#1a1918"/><rect x="18" y="8" width="22" height="22" rx="3" fill="#e4ddd0" stroke="#1a1918"/><path d="M29 14 V24 M24 19 H34" stroke="#1a1918" stroke-width="2.4"/>`),
  delete: () => wrap('de', '', `<path d="M14 14 L34 34 M34 14 L14 34" stroke="#ff6a52" stroke-width="5" stroke-linecap="round"/>`),
  land: () => wrap('la', lin('gla', '#c9a477', '#6b4a2a'), `<path d="M24 6 V28" stroke="#e4ddd0" stroke-width="3.5" stroke-linecap="round"/><polygon points="16,24 32,24 24,33" fill="#e4ddd0"/><polygon points="4,42 12,35 44,35 36,42" fill="url(#gla)"/>`),
  dice: () => wrap('dc', lin('gdc', '#ffffff', '#b8b0a2'), `<rect x="9" y="9" width="30" height="30" rx="7" fill="url(#gdc)" stroke="#1a1918"/><g fill="#1a1918"><circle cx="17" cy="17" r="2.6"/><circle cx="24" cy="24" r="2.6"/><circle cx="31" cy="31" r="2.6"/><circle cx="31" cy="17" r="2.6"/><circle cx="17" cy="31" r="2.6"/></g>`),
  eye: () => wrap('ey', '', `<path d="M4 24 Q24 6 44 24 Q24 42 4 24Z" fill="none" stroke="#e4ddd0" stroke-width="3"/><circle cx="24" cy="24" r="6" fill="#e4ddd0"/>`),
};
