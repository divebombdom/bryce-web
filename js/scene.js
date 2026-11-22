import { generate, applyOp } from './terrain.js';

// Texture kinds used by the ray tracer
export const TEX = { solid: 0, checker: 1, rock: 2, alpine: 3, marble: 4, wood: 5, planet: 6, lava: 7, strata: 8, grid: 9, clouds: 10 };
export const TEX_NAMES = {
  0: 'Solid', 1: 'Checker', 2: 'Rock', 3: 'Alpine', 4: 'Marble', 5: 'Wood', 6: 'Planet', 7: 'Lava', 8: 'Strata', 9: 'Grid', 10: 'Cumulus',
};

const M = (o) => ({ tex: 0, c1: '#c9b59a', c2: '#3a3530', scale: 1, bump: 0, spec: 0.2, refl: 0, transp: 0, ior: 1.5, emit: 0, metal: 0, ...o });

export const MATERIALS = {
  'Simple & Fun': {
    'Clay': M({ c1: '#c9a882', spec: 0.1 }),
    'Red Plastic': M({ c1: '#c21a1f', spec: 0.9, refl: 0.1 }),
    'Blue Plastic': M({ c1: '#1d4fbf', spec: 0.9, refl: 0.1 }),
    'Checkerboard': M({ tex: TEX.checker, c1: '#f1ede2', c2: '#1b1b22', scale: 1, spec: 0.4, refl: 0.18 }),
    'Neon Grid': M({ tex: TEX.grid, c1: '#0d0a1f', c2: '#ff3fb4', scale: 1, emit: 2.2, spec: 0.6, refl: 0.25 }),
  },
  'Metals & Glass': {
    'Chrome': M({ c1: '#eef2f6', spec: 1, refl: 0.92, metal: 1 }),
    'Gold': M({ c1: '#f3b649', spec: 1, refl: 0.82, metal: 1 }),
    'Copper': M({ c1: '#d9774a', spec: 1, refl: 0.7, metal: 1, bump: 0.05, scale: 3 }),
    'Glass': M({ c1: '#f2fbff', spec: 1, refl: 0.04, transp: 0.94, ior: 1.5 }),
    'Ice': M({ c1: '#b6e2f4', spec: 1, refl: 0.12, transp: 0.65, ior: 1.31, bump: 0.15, scale: 2 }),
  },
  'Rocks & Terrain': {
    'Alpine': M({ tex: TEX.alpine, c1: '#4b6a2c', c2: '#7c6d5d', scale: 1, bump: 0.3, spec: 0.05 }),
    'Desert Strata': M({ tex: TEX.strata, c1: '#b5532c', c2: '#efb878', scale: 1, bump: 0.25, spec: 0.03 }),
    'Granite': M({ tex: TEX.rock, c1: '#8e8984', c2: '#46423f', scale: 1.5, bump: 0.5, spec: 0.1 }),
    'Sandstone': M({ tex: TEX.rock, c1: '#d6a26a', c2: '#9a5c33', scale: 0.8, bump: 0.35, spec: 0.05 }),
    'Marble': M({ tex: TEX.marble, c1: '#ece7df', c2: '#585564', scale: 1, spec: 0.8, refl: 0.15 }),
    'Alien Rock': M({ tex: TEX.rock, c1: '#7a3289', c2: '#1b5060', scale: 1.2, bump: 0.5 }),
    'Lava': M({ tex: TEX.lava, c1: '#241713', c2: '#ff5a12', scale: 1, bump: 0.4, emit: 2.2 }),
  },
  'Grounds & Water': {
    'Sandy Ground': M({ tex: TEX.rock, c1: '#cdb38b', c2: '#a28866', scale: 0.25, bump: 0.12, spec: 0.02 }),
    'Grass Field': M({ tex: TEX.rock, c1: '#56742c', c2: '#7d963c', scale: 0.2, bump: 0.08, spec: 0.02 }),
    'Ocean': M({ c1: '#0a3550', spec: 1, refl: 0.7, transp: 0.25, ior: 1.33, bump: 0.35, scale: 0.4 }),
    'Lagoon': M({ c1: '#1c8a85', spec: 1, refl: 0.5, transp: 0.6, ior: 1.33, bump: 0.2, scale: 0.6 }),
    'Wood': M({ tex: TEX.wood, c1: '#8f5c2c', c2: '#5a3414', scale: 1, spec: 0.3 }),
  },
  'Planets & Sky': {
    'Planet': M({ tex: TEX.planet, c1: '#123c76', c2: '#41793a', scale: 1, spec: 0.2 }),
    'Gas Giant': M({ tex: TEX.strata, c1: '#c48b55', c2: '#f3e2c3', scale: 3, spec: 0.05 }),
    'Cumulus': M({ tex: TEX.clouds, c1: '#ffffff', c2: '#8f9bb0', scale: 1 }),
    'Storm Clouds': M({ tex: TEX.clouds, c1: '#b8bcc4', c2: '#3b414c', scale: 1.5 }),
    'Sunset Clouds': M({ tex: TEX.clouds, c1: '#ffcf9e', c2: '#7a4a66', scale: 1 }),
  },
};

export function findMaterial(name) {
  for (const cat of Object.values(MATERIALS)) if (cat[name]) return { ...cat[name], preset: name };
  return { ...MATERIALS['Simple & Fun'].Clay, preset: 'Clay' };
}

export const SKIES = {
  'Clear Day': { sunAz: 215, sunEl: 38, sun: '#fff4e0', sunPower: 1.15, zenith: '#2d63c0', horizon: '#b9d3ee', ambient: '#7489ad', haze: 0.25, hazeColor: '#cddcee', fog: 0.0, fogHeight: 4, fogColor: '#e3e9ef', shadows: 0.9, clouds: 0.4, cloudColor: '#ffffff', cloudHeight: 180, cloudFreq: 1, exposure: 1 },
  'Golden Hour': { sunAz: 250, sunEl: 9, sun: '#ffb46b', sunPower: 1.3, zenith: '#3b5d9e', horizon: '#ffc58f', ambient: '#7a6d84', haze: 0.45, hazeColor: '#f2b98a', fog: 0.15, fogHeight: 3, fogColor: '#e9b48c', shadows: 0.85, clouds: 0.35, cloudColor: '#ffd8b0', cloudHeight: 200, cloudFreq: 1.1, exposure: 1.05 },
  'Romantic Sunset': { sunAz: 270, sunEl: 2.5, sun: '#ff7a3d', sunPower: 1.4, zenith: '#24264f', horizon: '#ff8a5c', ambient: '#5d4b6e', haze: 0.6, hazeColor: '#e17866', fog: 0.25, fogHeight: 4, fogColor: '#b7647a', shadows: 0.7, clouds: 0.5, cloudColor: '#ff9c7a', cloudHeight: 220, cloudFreq: 0.9, exposure: 1.15 },
  'Hazy Morning': { sunAz: 110, sunEl: 16, sun: '#fff0d4', sunPower: 1.0, zenith: '#7f9fc7', horizon: '#e6e9e8', ambient: '#9aa6b6', haze: 0.8, hazeColor: '#e9ece9', fog: 0.6, fogHeight: 5, fogColor: '#f1f1ec', shadows: 0.6, clouds: 0.2, cloudColor: '#ffffff', cloudHeight: 160, cloudFreq: 1, exposure: 1 },
  'Stormy': { sunAz: 190, sunEl: 30, sun: '#c9cfd8', sunPower: 0.7, zenith: '#3f4856', horizon: '#8b939c', ambient: '#606a78', haze: 0.55, hazeColor: '#8d949c', fog: 0.3, fogHeight: 6, fogColor: '#7d858f', shadows: 0.45, clouds: 0.85, cloudColor: '#9aa1ab', cloudHeight: 140, cloudFreq: 1.3, exposure: 1.05 },
  'Alien Dusk': { sunAz: 160, sunEl: 12, sun: '#7dffd0', sunPower: 1.2, zenith: '#2a0d44', horizon: '#c0407a', ambient: '#5a3470', haze: 0.5, hazeColor: '#a0407c', fog: 0.35, fogHeight: 4, fogColor: '#4fbf8f', shadows: 0.85, clouds: 0.3, cloudColor: '#e08cd8', cloudHeight: 210, cloudFreq: 0.8, exposure: 1.1 },
  'Moonlit Night': { sunAz: 140, sunEl: 25, sun: '#9fb4e0', sunPower: 0.45, zenith: '#04081a', horizon: '#1b2a4c', ambient: '#1d2843', haze: 0.2, hazeColor: '#1f2c4a', fog: 0.1, fogHeight: 3, fogColor: '#22304f', shadows: 0.8, clouds: 0.25, cloudColor: '#56688f', cloudHeight: 200, cloudFreq: 1, exposure: 1.2, stars: 1 },
};

let nextId = 1;
export function uid() { return nextId++; }
export function bumpIds(objects) { for (const o of objects) nextId = Math.max(nextId, o.id + 1); }

export const TYPES = {
  water: { label: 'Water Plane', plane: true, mat: 'Ocean' },
  cloud: { label: 'Cloud Plane', plane: true, mat: 'Cumulus' },
  ground: { label: 'Ground Plane', plane: true, mat: 'Sandy Ground' },
  terrain: { label: 'Terrain', mat: 'Alpine' },
  stone: { label: 'Stone', mat: 'Granite' },
  sphere: { label: 'Sphere', mat: 'Chrome' },
  cube: { label: 'Cube', mat: 'Clay' },
  cylinder: { label: 'Cylinder', mat: 'Marble' },
  cone: { label: 'Cone', mat: 'Red Plastic' },
  pyramid: { label: 'Pyramid', mat: 'Sandstone' },
  torus: { label: 'Torus', mat: 'Gold' },
  disk: { label: 'Disk', mat: 'Blue Plastic' },
};

const counters = {};
export function makeObject(type, opts = {}) {
  const T = TYPES[type];
  if (!opts.name) counters[type] = (counters[type] || 0) + 1;
  const o = {
    id: uid(),
    type,
    name: opts.name || `${T.label} ${counters[type]}`,
    pos: opts.pos || [0, type === 'cloud' ? 180 : type === 'water' ? 0 : type === 'ground' ? -0.01 : 2, 0],
    rot: opts.rot || [0, 0, 0],
    scl: opts.scl || (type === 'terrain' ? [30, 10, 30] : type === 'disk' ? [2, 0.08, 2] : T.plane ? [1, 1, 1] : [2, 2, 2]),
    mat: opts.mat ? findMaterial(opts.mat) : findMaterial(T.mat),
    hidden: false,
  };
  if (type === 'terrain') {
    const res = opts.res || 128;
    const data = opts.data || generate(opts.gen || 'fractal', res, opts.seed);
    if (opts.erode) applyOp('erode', data, res);
    o.terrain = { res, data, gen: opts.gen || 'fractal' };
  }
  if (type === 'stone') o.seed = opts.seed ?? Math.floor(Math.random() * 1000);
  return o;
}

export function cloneObject(o) {
  const c = structuredClone(o);
  c.id = uid();
  c.name = o.name.replace(/( copy)?( \d+)?$/, '') + ' copy';
  return c;
}

export function defaultCamera() {
  return { target: [0, 3, -6], dist: 46, yaw: 0, pitch: 0.14, fov: 48 };
}

export const EXAMPLES = {
  'Mountain Lake': () => ({
    sky: { ...SKIES['Clear Day'], sunAz: 230, sunEl: 26, clouds: 0.42 },
    camera: { target: [0, 5, -20], dist: 58, yaw: 0.05, pitch: 0.08, fov: 46 },
    objects: [
      makeObject('ground', { pos: [0, -0.5, 0], mat: 'Grass Field', name: 'Meadow' }),
      makeObject('water', { pos: [0, 1.2, 0], mat: 'Lagoon', name: 'Lake' }),
      makeObject('terrain', { pos: [0, -0.5, -48], scl: [70, 26, 46], gen: 'ridged', seed: 42, erode: true, name: 'Peaks' }),
      makeObject('terrain', { pos: [-46, -0.5, -12], scl: [34, 11, 34], gen: 'fractal', seed: 7, mat: 'Granite', name: 'Left Ridge' }),
      makeObject('sphere', { pos: [6, 4.4, 4], scl: [2.6, 2.6, 2.6], mat: 'Chrome', name: 'Chrome Orb' }),
      makeObject('stone', { pos: [-4, 1.5, 9], scl: [1.8, 1.4, 1.6], mat: 'Granite', seed: 12 }),
    ],
  }),
  'Chrome & Checkers': () => ({
    sky: { ...SKIES['Clear Day'], sunAz: 145, sunEl: 34, haze: 0.35, clouds: 0.3 },
    camera: { target: [0, 2, 0], dist: 24, yaw: -0.35, pitch: 0.2, fov: 46 },
    objects: [
      makeObject('ground', { pos: [0, 0, 0], mat: 'Checkerboard' }),
      makeObject('sphere', { pos: [0, 3, 0], scl: [3, 3, 3], mat: 'Chrome', name: 'Big Chrome' }),
      makeObject('sphere', { pos: [-6, 1.6, 3], scl: [1.6, 1.6, 1.6], mat: 'Glass', name: 'Glass Ball' }),
      makeObject('torus', { pos: [6, 1.2, 2], rot: [70, 20, 0], scl: [2.4, 2.4, 2.4], mat: 'Gold' }),
      makeObject('cube', { pos: [4, 1.2, -6], rot: [0, 30, 0], scl: [1.2, 1.2, 1.2], mat: 'Red Plastic' }),
      makeObject('pyramid', { pos: [-5, 1.5, -6], rot: [0, 15, 0], scl: [1.5, 1.5, 1.5], mat: 'Marble' }),
      makeObject('cone', { pos: [-1, 1, 7], scl: [1, 1, 1], mat: 'Blue Plastic' }),
    ],
  }),
  'Desert Mesa': () => ({
    sky: { ...SKIES['Golden Hour'] },
    camera: { target: [0, 6, -30], dist: 70, yaw: 0.25, pitch: 0.06, fov: 44 },
    objects: [
      makeObject('ground', { pos: [0, 0, 0], mat: 'Sandy Ground' }),
      makeObject('terrain', { pos: [-10, 0, -55], scl: [60, 22, 40], gen: 'mesa', seed: 99, mat: 'Desert Strata', name: 'Mesa' }),
      makeObject('terrain', { pos: [40, 0, -20], scl: [30, 14, 30], gen: 'mesa', seed: 5, mat: 'Desert Strata', name: 'Butte' }),
      makeObject('terrain', { pos: [0, 0, 10], scl: [40, 2.5, 40], gen: 'dunes', seed: 3, mat: 'Sandstone', name: 'Dunes' }),
      makeObject('stone', { pos: [6, 0.8, 12], scl: [2, 1.2, 1.6], mat: 'Sandstone', seed: 3 }),
    ],
  }),
  'Alien World': () => ({
    sky: { ...SKIES['Alien Dusk'], fog: 0.1, haze: 0.35 },
    camera: { target: [0, 8, -20], dist: 52, yaw: -0.2, pitch: 0.1, fov: 50 },
    objects: [
      makeObject('ground', { pos: [0, 0, 0], mat: 'Alien Rock', name: 'Alien Plain' }),
      ((o) => { o.mat = { ...o.mat, scale: 0.3 }; return o; })(makeObject('terrain', { pos: [0, 0, -40], scl: [55, 18, 40], gen: 'volcano', seed: 11, mat: 'Lava', name: 'Volcano' })),
      makeObject('sphere', { pos: [-55, 70, -220], scl: [40, 40, 40], rot: [20, 0, 15], mat: 'Gas Giant', name: 'Gas Giant' }),
      makeObject('sphere', { pos: [8, 6, 0], scl: [2.5, 2.5, 2.5], mat: 'Planet', name: 'Moonlet' }),
      makeObject('torus', { pos: [-8, 4, 2], rot: [90, 0, 0], scl: [4, 4, 4], mat: 'Neon Grid', name: 'Portal' }),
      makeObject('cloud', { pos: [0, 160, 0], mat: 'Sunset Clouds' }),
    ],
  }),
  'Empty World': () => ({
    sky: { ...SKIES['Clear Day'] },
    camera: defaultCamera(),
    objects: [makeObject('ground', { pos: [0, 0, 0], mat: 'Sandy Ground' })],
  }),
};
