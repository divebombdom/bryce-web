import * as THREE from 'three';
import { MATERIALS, SKIES, TYPES, TEX_NAMES, EXAMPLES, makeObject, cloneObject, findMaterial, bumpIds, defaultCamera } from './scene.js';
import { Raytracer } from './raytracer.js';
import { Editor } from './editor.js';
import { ICONS } from './icons.js';
import * as TER from './terrain.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } if (html) e.innerHTML = html; return e; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DEFAULT_HINT = 'Drag empty space to orbit · right-drag to pan · wheel to zoom · click a wireframe to select it';
const TYPE_DOT = { water: '#6fa3c9', cloud: '#e8ecf2', ground: '#a88a64', terrain: '#8fa36a', stone: '#9a958e', sphere: '#7fa7ff', cube: '#7fa7ff', cylinder: '#7fa7ff', cone: '#7fa7ff', pyramid: '#7fa7ff', torus: '#7fa7ff', disk: '#7fa7ff' };

// ---------------------------------------------------------------- state
const app = {
  state: { objects: [], sky: { ...SKIES['Clear Day'] }, camera: defaultCamera(), selected: null },
  undo: [], redo: [],
  mode: 'wire',
  camMem: [null, null, null, null],
};
window.__bryce = app;

// ---------------------------------------------------------------- renderers
const viewCanvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas: viewCanvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const nanoCanvas = $('#nano');
const nanoRenderer = new THREE.WebGLRenderer({ canvas: nanoCanvas, antialias: false });
nanoRenderer.setPixelRatio(1);
nanoRenderer.setSize(200, 140, false);

const rt = new Raytracer(renderer);
rt.settings = { bounces: 5, steps: 260, ao: 1, skyOnly: 0 };
const nrt = new Raytracer(nanoRenderer);
nrt.settings = { bounces: 3, steps: 140, ao: 0, skyOnly: 0 };
const trt = new Raytracer(nanoRenderer);
trt.settings = { bounces: 3, steps: 120, ao: 1, skyOnly: 0 };

const editor = new Editor(renderer, viewCanvas, app);

// ---------------------------------------------------------------- history
function snapshot() { return structuredClone({ objects: app.state.objects, sky: app.state.sky, camera: app.state.camera, selected: app.state.selected }); }
app.beginChange = () => { app.undo.push(snapshot()); if (app.undo.length > 60) app.undo.shift(); app.redo.length = 0; };
app.endChange = () => { renderAttrs(); renderChips(); };
function restore(s) {
  app.state.objects = s.objects; app.state.sky = s.sky; app.state.camera = s.camera; app.state.selected = s.selected;
  for (const o of app.state.objects) if (o.terrain) o.terrain.version = (o.terrain.version || 0) + 1000 + Math.random();
  editor.rebuildAll(); editor.updateCamera();
  renderAll();
}
function doUndo() { if (!app.undo.length) return toast('Nothing to undo'); app.redo.push(snapshot()); restore(app.undo.pop()); toast('Undo'); }
function doRedo() { if (!app.redo.length) return toast('Nothing to redo'); app.undo.push(snapshot()); restore(app.redo.pop()); toast('Redo'); }

// ---------------------------------------------------------------- change hooks
let nanoDirty = true;
let lastNanoStart = 0;
let bgValid = false;
function markDirty() { nanoDirty = true; }

app.select = (id) => {
  app.state.selected = id;
  editor.refreshSelection();
  renderAttrs(); renderChips();
  if (currentTab === 'edit') renderPalette();
};
app.objectChanged = (o, opts = {}) => {
  if (!opts.live) editor.syncItem(o);
  updateAttrValues();
  markDirty();
};
app.cameraWillMove = () => { if (app.mode === 'render') stopRender(true); };
app.cameraMoved = () => { bgValid = false; markDirty(); };
app.cameraDone = () => { markDirty(); };
app.skyChanged = () => { markDirty(); };

function selectedObj() { return app.state.objects.find(o => o.id === app.state.selected) || null; }

function groundLevel() {
  const g = app.state.objects.filter(o => o.type === 'ground' && !o.hidden);
  return g.length ? Math.max(...g.map(o => o.pos[1])) : 0;
}

function addObject(type) {
  app.beginChange();
  const c = app.state.camera;
  const gy = groundLevel();
  const jitter = () => (Math.random() - 0.5) * 4;
  const o = makeObject(type);
  if (!TYPES[type].plane) {
    o.pos = [c.target[0] + jitter(), 0, c.target[2] + jitter()];
    if (type === 'terrain') o.pos[1] = gy;
    else if (type === 'stone') o.pos[1] = gy + o.scl[1] * 0.55;
    else o.pos[1] = gy + (type === 'torus' ? o.scl[1] * 0.28 : o.scl[1]);
  } else if (type === 'water') o.pos[1] = gy + 0.8;
  else if (type === 'ground') o.pos[1] = 0;
  app.state.objects.push(o);
  editor.addItem(o);
  app.select(o.id);
  markDirty();
  setHint(`Created ${o.name}. Drag the gizmo to place it, or open the Edit palette.`);
}

function deleteSelected() {
  const o = selectedObj(); if (!o) return;
  app.beginChange();
  editor.removeItem(o.id);
  app.state.objects = app.state.objects.filter(x => x !== o);
  app.select(null);
  markDirty();
  toast(`Deleted ${o.name}`);
}

function duplicateSelected() {
  const o = selectedObj(); if (!o) return;
  app.beginChange();
  const c = cloneObject(o);
  if (!TYPES[o.type].plane) { c.pos[0] += Math.max(1, o.scl[0] * 1.2); }
  else c.pos[1] += 2;
  app.state.objects.push(c);
  editor.addItem(c);
  app.select(c.id);
  markDirty();
}

function landSelected() {
  const o = selectedObj(); if (!o || TYPES[o.type].plane) return;
  app.beginChange();
  const it = editor.items.get(o.id);
  it.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(it.pick);
  const ray = new THREE.Raycaster(new THREE.Vector3(o.pos[0], 5000, o.pos[2]), new THREE.Vector3(0, -1, 0));
  const targets = [...editor.items.values()].filter(i => i.o.id !== o.id && !i.o.hidden && (i.o.type === 'terrain' || i.o.type === 'ground' || (!i.isPlane && i.o.type !== 'cloud'))).map(i => i.pick);
  const hits = ray.intersectObjects(targets, false);
  const y = hits.length ? hits[0].point.y : 0;
  o.pos[1] = +(o.pos[1] + (y - box.min.y)).toFixed(3);
  app.objectChanged(o);
  editor.updateSelBox();
  renderAttrs();
}

function randomizeSelected() {
  const o = selectedObj(); if (!o) return;
  app.beginChange();
  if (o.type === 'terrain') {
    const kinds = Object.keys(TER.GENERATORS);
    o.terrain.data = TER.generate(o.terrain.gen || kinds[Math.floor(Math.random() * kinds.length)], o.terrain.res);
    o.terrain.version = (o.terrain.version || 0) + 1;
    editor.refreshGeometry(o);
  } else if (o.type === 'stone') {
    o.seed = Math.floor(Math.random() * 1000);
    editor.refreshGeometry(o);
  } else {
    const names = Object.values(MATERIALS).flatMap(c => Object.keys(c));
    o.mat = findMaterial(names[Math.floor(Math.random() * names.length)]);
  }
  app.objectChanged(o);
  renderAttrs();
}

function toggleHidden() {
  const o = selectedObj(); if (!o) return;
  app.beginChange();
  o.hidden = !o.hidden;
  editor.syncItem(o);
  editor.refreshSelection();
  markDirty(); renderChips(); renderAttrs();
}

function loadScene(def) {
  app.state.objects = def.objects;
  app.state.sky = { ...SKIES['Clear Day'], ...def.sky };
  app.state.camera = def.camera;
  app.state.selected = null;
  bumpIds(app.state.objects);
  editor.setView('camera');
  setViewButtons('camera');
  editor.rebuildAll();
  editor.updateCamera();
  bgValid = false;
  if (app.mode === 'render') stopRender(true);
  renderAll();
}

function renderAll() { renderAttrs(); renderChips(); renderPalette(); markDirty(); }

// ---------------------------------------------------------------- render control
let renderStart = 0;
let budget = 30000;
let renderScale = 1;
function startRender() {
  if (editor.view !== 'camera') { editor.setView('camera'); setViewButtons('camera'); }
  const w = Math.max(32, Math.round(viewCanvas.clientWidth * renderScale));
  const h = Math.max(32, Math.round(viewCanvas.clientHeight * renderScale));
  rt.sync(app.state, editor.persp);
  rt.start(w, h, { aa: $('#aaOn').checked ? 5 : 1 });
  app.mode = 'render';
  renderStart = performance.now();
  $('#renderBtn').classList.add('busy');
  $('#renderHud').hidden = false;
  $('#viewBadge').textContent = 'Rendering';
  setHint('Rendering… the image sharpens pass by pass. Click the picture to return to the wireframe.');
}
function stopRender(toWire) {
  if (!rt.done) { rt.done = true; $('#renderStatus').textContent = 'Stopped'; }
  $('#renderBtn').classList.remove('busy');
  if (toWire) {
    app.mode = 'wire';
    $('#renderHud').hidden = true;
    $('#viewBadge').textContent = viewLabel(editor.view);
  }
}
function viewLabel(v) { return { camera: 'Camera View', top: 'Top View', front: 'Front View', side: 'Side View' }[v]; }

function saveImage() {
  const f = rt.readFinal();
  if (!f) return toast('Render something first');
  const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(f.w, f.h);
  for (let y = 0; y < f.h; y++) img.data.set(f.buf.subarray((f.h - 1 - y) * f.w * 4, (f.h - y) * f.w * 4), y * f.w * 4);
  ctx.putImageData(img, 0, 0);
  c.toBlob((b) => download(b, 'bryce-render.png'), 'image/png');
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`Saved ${name}`);
}

// ---------------------------------------------------------------- thumbnails
const thumbCam = new THREE.PerspectiveCamera(36, 1, 0.1, 1000);
const thumbSky = { ...SKIES['Clear Day'], clouds: 0, haze: 0.15, sunAz: 35, sunEl: 38, shadows: 0.8 };
const thumbGround = makeObject('ground', { pos: [0, 0, 0], mat: 'Checkerboard', name: 'thumb' });
thumbGround.mat = { ...thumbGround.mat, c1: '#5b5852', c2: '#2b2a27', scale: 1.6, refl: 0.05 };
const thumbSphere = makeObject('sphere', { pos: [0, 1, 0], scl: [1, 1, 1] });
const thumbCache = new Map();
function thumbPixels(mat, w, h, sky = thumbSky, cam = 'mat') {
  thumbSphere.mat = mat;
  if (cam === 'mat') { thumbCam.position.set(0, 1.55, 3.7); thumbCam.lookAt(0, 0.95, 0); thumbCam.fov = 36; }
  else { thumbCam.position.set(0, 1.2, 8); thumbCam.lookAt(0, 3.2, 0); thumbCam.fov = 60; }
  thumbCam.aspect = w / h; thumbCam.updateProjectionMatrix(); thumbCam.updateMatrixWorld();
  const state = { objects: cam === 'mat' ? [thumbGround, thumbSphere] : [thumbGround, { ...thumbSphere, mat: findMaterial('Chrome'), pos: [0, 0.8, 0], scl: [0.8, 0.8, 0.8] }], sky };
  trt.sync(state, thumbCam);
  return trt.renderPixels(w, h);
}
function paintPixels(canvas, buf, w, h) {
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  ctx.putImageData(img, 0, 0);
}
function matThumb(canvas, mat, size = 72) {
  const key = JSON.stringify(mat) + size;
  let buf = thumbCache.get(key);
  if (!buf) { buf = thumbPixels(mat, size, size); thumbCache.set(key, buf); }
  paintPixels(canvas, buf, size, size);
}
function skyThumb(canvas, sky) {
  const key = 'sky' + JSON.stringify(sky);
  let buf = thumbCache.get(key);
  if (!buf) { buf = thumbPixels(findMaterial('Chrome'), 104, 52, sky, 'sky'); thumbCache.set(key, buf); }
  paintPixels(canvas, buf, 104, 52);
}
// queue thumbnails so the UI never stalls
const thumbQueue = [];
function queueThumb(fn) { thumbQueue.push(fn); }
function pumpThumbs() { const t0 = performance.now(); while (thumbQueue.length && performance.now() - t0 < 10) thumbQueue.shift()(); }

// ---------------------------------------------------------------- scrub control
function scrub({ label, min, max, step = 0.01, get, set, fmt = (v) => v.toFixed(2), hint, color, sens = 160 }) {
  const root = el('div', { class: 'scrub', 'data-hint': hint || label });
  root.innerHTML = `<div class="thumb"><div class="fill"></div><div class="val"></div></div><div class="lab">${label}</div>`;
  const fill = $('.fill', root), val = $('.val', root), thumb = $('.thumb', root);
  if (color) {
    const sw = el('input', { type: 'color', class: 'swatch', 'data-hint': `${label} color` });
    sw.value = color.get();
    sw.addEventListener('pointerdown', (e) => e.stopPropagation());
    sw.addEventListener('focus', () => app.beginChange());
    sw.addEventListener('input', () => { color.set(sw.value); app.skyChanged(); });
    thumb.appendChild(sw);
    root._sw = sw;
  }
  const refresh = () => { const v = get(); fill.style.width = `${clamp((v - min) / (max - min), 0, 1) * 100}%`; val.textContent = fmt(v); if (root._sw && color) root._sw.value = color.get(); };
  refresh();
  let start = null;
  thumb.addEventListener('pointerdown', (e) => { if (e.target.classList.contains('swatch')) return; app.beginChange(); start = { x: e.clientX, v: get() }; thumb.setPointerCapture(e.pointerId); });
  thumb.addEventListener('pointermove', (e) => {
    if (!start) return;
    let v = start.v + (e.clientX - start.x) / sens * (max - min) * (e.shiftKey ? 0.2 : 1);
    v = clamp(Math.round(v / step) * step, min, max);
    set(v); refresh();
  });
  thumb.addEventListener('pointerup', () => { start = null; renderAttrs(); });
  thumb.addEventListener('wheel', (e) => { e.preventDefault(); set(clamp(get() - Math.sign(e.deltaY) * step * 5, min, max)); refresh(); }, { passive: false });
  root.refresh = refresh;
  return root;
}

// ---------------------------------------------------------------- palettes
let currentTab = 'create';
const palette = $('#palette');
function palBtn(icon, label, hint, onclick, opts = {}) {
  const b = el('button', { class: 'pal-btn' + (opts.on ? ' on' : ''), 'data-hint': hint, 'aria-label': label });
  b.innerHTML = ICONS[icon]() + `<span>${label}</span>`;
  if (opts.disabled) b.disabled = true;
  b.addEventListener('click', onclick);
  return b;
}
function group(...children) { const g = el('div', { class: 'group' }); children.forEach(c => g.appendChild(c)); return g; }

function renderPalette() {
  palette.innerHTML = '';
  if (currentTab === 'create') {
    const c = (t, hint) => palBtn(t, TYPES[t].label.replace(' Plane', ''), hint, () => addObject(t));
    palette.append(
      group(c('water', 'Create an infinite water plane'), c('cloud', 'Create an infinite cloud plane'), c('ground', 'Create an infinite ground plane')),
      group(c('terrain', 'Create a fractal terrain — edit it in the Terrain Editor'), c('stone', 'Create a stone')),
      group(c('sphere', 'Create a sphere'), c('cube', 'Create a cube'), c('cylinder', 'Create a cylinder'), c('cone', 'Create a cone'), c('pyramid', 'Create a pyramid'), c('torus', 'Create a torus'), c('disk', 'Create a disk')),
    );
  } else if (currentTab === 'edit') {
    const o = selectedObj();
    const none = !o;
    const plane = o && TYPES[o.type].plane;
    const m = editor.mode || 'translate';
    palette.append(
      group(palBtn('materials', 'Materials', 'Open the Materials Lab for the selected object', () => openMatLab(), { disabled: none }),
        palBtn('terrainEd', 'Terrain', 'Open the Terrain Editor (select a terrain first)', () => openTerrLab(), { disabled: !o || o.type !== 'terrain' })),
      group(palBtn('move', 'Move', 'Reposition: drag the arrows in the working window (W)', () => setMode('translate'), { on: m === 'translate' }),
        palBtn('rotate', 'Rotate', 'Rotate: drag the rings (E)', () => setMode('rotate'), { on: m === 'rotate', disabled: plane }),
        palBtn('scale', 'Resize', 'Resize: drag the handles (R)', () => setMode('scale'), { on: m === 'scale', disabled: plane })),
      group(palBtn('duplicate', 'Duplicate', 'Duplicate the selection (Ctrl+D)', duplicateSelected, { disabled: none }),
        palBtn('land', 'Land', 'Drop the object onto the surface below it', landSelected, { disabled: none || plane }),
        palBtn('dice', 'Randomize', 'Randomize: new terrain, new stone shape, or a surprise material', randomizeSelected, { disabled: none }),
        palBtn('eye', o && o.hidden ? 'Show' : 'Hide', 'Hide or show the selected object', toggleHidden, { disabled: none }),
        palBtn('delete', 'Delete', 'Delete the selection (Del)', deleteSelected, { disabled: none })),
    );
    if (none) setHint('Select an object in the working window or in the list below to edit it.');
  } else {
    const s = app.state.sky;
    // presets
    const pres = el('div', { class: 'sky-presets' });
    for (const [name, sky] of Object.entries(SKIES)) {
      const b = el('button', { class: 'sky-chip', 'data-hint': `Sky memory: ${name}`, 'aria-label': name });
      const cv = el('canvas');
      b.appendChild(cv);
      queueThumb(() => skyThumb(cv, sky));
      b.addEventListener('click', () => { app.beginChange(); app.state.sky = { ...sky }; app.skyChanged(); renderPalette(); toast(name); });
      pres.appendChild(b);
    }
    // sun ball
    const ball = el('div', { class: 'sunball', 'data-hint': 'Sun position: drag the sun. Centre is overhead, the rim is the horizon. Outside the dashed ring the sun sets.' });
    ball.innerHTML = '<div class="horizon"></div><div class="sun"></div>';
    const sunDot = $('.sun', ball);
    const placeSun = () => {
      const r = (90 - s.sunEl) / 90 * 0.5 * 0.92; // 0..0.46 (horizon), beyond for below
      const a = s.sunAz * Math.PI / 180;
      sunDot.style.left = `${50 + Math.sin(a) * r * 100}%`;
      sunDot.style.top = `${50 + Math.cos(a) * r * 100}%`;
    };
    placeSun();
    let dragging = false;
    const moveSun = (e) => {
      const rc = ball.getBoundingClientRect();
      const x = (e.clientX - rc.left) / rc.width - 0.5, y = (e.clientY - rc.top) / rc.height - 0.5;
      const r = Math.min(0.56, Math.hypot(x, y));
      s.sunAz = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
      s.sunEl = clamp(90 - r / 0.46 * 90, -12, 90);
      placeSun(); app.skyChanged();
      setHint(`Sun azimuth ${s.sunAz.toFixed(0)}°, altitude ${s.sunEl.toFixed(1)}°`);
    };
    ball.addEventListener('pointerdown', (e) => { app.beginChange(); dragging = true; ball.setPointerCapture(e.pointerId); moveSun(e); });
    ball.addEventListener('pointermove', (e) => dragging && moveSun(e));
    ball.addEventListener('pointerup', () => { dragging = false; });
    const sunWrap = el('div', { class: 'group' }); sunWrap.appendChild(ball);

    const sc = (o) => scrub({ ...o, set: (v) => { o.set(v); app.skyChanged(); } });
    const scr = group(
      sc({ label: 'Shadows', min: 0, max: 1, get: () => s.shadows, set: v => s.shadows = v, hint: 'Shadow strength', fmt: v => Math.round(v * 100) }),
      sc({ label: 'Fog', min: 0, max: 2, get: () => s.fog, set: v => s.fog = v, hint: 'Ground fog density', fmt: v => Math.round(v * 50), color: { get: () => s.fogColor, set: v => s.fogColor = v } }),
      sc({ label: 'Fog height', min: -5, max: 40, step: 0.5, get: () => s.fogHeight, set: v => s.fogHeight = v, hint: 'How high the fog reaches', fmt: v => v.toFixed(1) }),
      sc({ label: 'Haze', min: 0, max: 1.5, get: () => s.haze, set: v => s.haze = v, hint: 'Atmospheric haze toward the horizon', fmt: v => Math.round(v * 66), color: { get: () => s.hazeColor, set: v => s.hazeColor = v } }),
      sc({ label: 'Clouds', min: 0, max: 1, get: () => s.clouds, set: v => s.clouds = v, hint: 'Cloud cover', fmt: v => Math.round(v * 100), color: { get: () => s.cloudColor, set: v => s.cloudColor = v } }),
      sc({ label: 'Cloud height', min: 40, max: 600, step: 5, get: () => s.cloudHeight, set: v => s.cloudHeight = v, hint: 'Altitude of the cloud layer', fmt: v => v.toFixed(0) }),
      sc({ label: 'Cloud size', min: 0.3, max: 3, get: () => s.cloudFreq, set: v => s.cloudFreq = v, hint: 'Cloud frequency: higher means smaller, busier clouds', fmt: v => v.toFixed(1) }),
      sc({ label: 'Sun', min: 0, max: 2.5, get: () => s.sunPower, set: v => s.sunPower = v, hint: 'Sunlight strength', fmt: v => v.toFixed(2), color: { get: () => s.sun, set: v => s.sun = v } }),
      sc({ label: 'Exposure', min: 0.3, max: 2.5, get: () => s.exposure, set: v => s.exposure = v, hint: 'Overall brightness', fmt: v => v.toFixed(2) }),
    );
    const colors = el('div', { class: 'color-stack' });
    for (const [k, lab, hint] of [['zenith', 'Sky', 'Sky colour overhead'], ['horizon', 'Horizon', 'Sky colour at the horizon'], ['ambient', 'Ambient', 'Ambient light colour (fills shadows)'], ['stars', 'Stars', 'Show stars']]) {
      const l = el('label', { 'data-hint': hint });
      if (k === 'stars') { const cb = el('input', { type: 'checkbox' }); cb.checked = !!s.stars; cb.addEventListener('change', () => { app.beginChange(); s.stars = cb.checked ? 1 : 0; app.skyChanged(); }); l.append(cb, lab); }
      else { const ci = el('input', { type: 'color' }); ci.value = s[k]; ci.addEventListener('focus', () => app.beginChange()); ci.addEventListener('input', () => { s[k] = ci.value; app.skyChanged(); }); l.append(ci, lab); }
      colors.appendChild(l);
    }
    const dice = palBtn('dice', 'Random', 'Roll a random sky', randomSky);
    palette.append(group(pres), sunWrap, scr, group(colors), group(dice));
  }
}

function randomSky() {
  app.beginChange();
  const keys = Object.keys(SKIES);
  const a = SKIES[keys[Math.floor(Math.random() * keys.length)]], b = SKIES[keys[Math.floor(Math.random() * keys.length)]];
  const mixHex = (x, y, t) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
  const t = Math.random();
  const s = {};
  for (const k of Object.keys(a)) s[k] = typeof a[k] === 'number' ? a[k] + ((b[k] ?? a[k]) - a[k]) * t : (typeof a[k] === 'string' ? mixHex(a[k], b[k] || a[k], t) : a[k]);
  s.sunAz = Math.random() * 360; s.sunEl = 4 + Math.random() * 50;
  s.clouds = Math.random() * 0.8; s.stars = 0;
  app.state.sky = s;
  app.skyChanged(); renderPalette();
}

function setMode(m) { editor.setMode(m); if (currentTab === 'edit') renderPalette(); }

$$('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
function setTab(t) {
  currentTab = t;
  $$('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  renderPalette();
}

// ---------------------------------------------------------------- attributes panel
const attrs = $('#attrs');
function renderAttrs() {
  const o = selectedObj();
  attrs.innerHTML = '';
  const wrap = el('div', { class: 'attr' });
  if (!o) {
    const n = app.state.objects.length;
    wrap.innerHTML = `<h3>World</h3><div class="type">${n} object${n === 1 ? '' : 's'}</div>
      <div class="empty">Click a wireframe to select it. Selected objects turn <b style="color:var(--sel)">red</b>.<br><br>
      Use the <b>Create</b> palette to add terrains, planes, stones and primitives. Switch to <b>Sky &amp; Fog</b> to set the sun and atmosphere, then press <b>Render</b>.</div>
      <div class="sect"><div class="block-title">Scene</div>
      <div class="stat"><span>Sun</span><b>${app.state.sky.sunAz.toFixed(0)}° / ${app.state.sky.sunEl.toFixed(1)}°</b></div>
      <div class="stat"><span>Terrains</span><b>${app.state.objects.filter(x => x.type === 'terrain').length}</b></div>
      <div class="stat"><span>Primitives</span><b>${app.state.objects.filter(x => !TYPES[x.type].plane && x.type !== 'terrain').length}</b></div>
      <div class="stat"><span>Infinite planes</span><b>${app.state.objects.filter(x => TYPES[x.type].plane).length}</b></div></div>`;
    attrs.appendChild(wrap);
    return;
  }
  const plane = TYPES[o.type].plane;
  wrap.innerHTML = `<h3>${escapeHtml(o.name)}</h3><div class="type">${TYPES[o.type].label}${o.hidden ? ' · hidden' : ''}</div>`;
  const name = el('input', { class: 'name', value: o.name, 'aria-label': 'Object name' });
  name.addEventListener('change', () => { app.beginChange(); o.name = name.value || o.name; renderAttrs(); renderChips(); });
  wrap.appendChild(name);
  const vec = (label, key, idxs, stepv) => {
    const row = el('div', { class: 'vec' });
    row.appendChild(el('span', {}, label));
    idxs.forEach((i) => {
      const inp = el('input', { type: 'number', step: stepv, 'data-key': key, 'data-i': i, 'aria-label': `${label} ${'xyz'[i]}` });
      inp.value = (+o[key][i]).toFixed(2);
      inp.addEventListener('focus', () => app.beginChange());
      inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (Number.isFinite(v)) { o[key][i] = key === 'scl' ? Math.max(0.01, v) : v; editor.syncItem(o); editor.updateSelBox(); markDirty(); } });
      row.appendChild(inp);
    });
    if (idxs.length < 3) for (let k = idxs.length; k < 3; k++) row.appendChild(el('div'));
    return row;
  };
  const tr = el('div', { class: 'sect' });
  tr.appendChild(el('div', { class: 'block-title' }, 'Transform'));
  if (plane) tr.appendChild(vec('Height', 'pos', [1], 0.1));
  else { tr.appendChild(vec('Pos', 'pos', [0, 1, 2], 0.1)); tr.appendChild(vec('Rot', 'rot', [0, 1, 2], 1)); tr.appendChild(vec('Size', 'scl', [0, 1, 2], 0.1)); }
  wrap.appendChild(tr);

  const ms = el('div', { class: 'sect' });
  ms.appendChild(el('div', { class: 'block-title' }, 'Material'));
  const card = el('div', { class: 'mat-card' });
  const cv = el('canvas');
  card.append(cv, el('div', {}, `<div class="mn">${escapeHtml(o.mat.preset || 'Custom')}</div><div class="ms">${TEX_NAMES[o.mat.tex]}${o.mat.refl > 0.3 ? ' · reflective' : ''}${o.mat.transp > 0.3 ? ' · transparent' : ''}</div>`));
  queueThumb(() => matThumb(cv, o.mat, 56));
  ms.appendChild(card);
  const btns = el('div', { class: 'btns' });
  btns.appendChild(el('button', { class: 'btn', onclick: () => openMatLab(), 'data-hint': 'Open the Materials Lab' }, 'Materials Lab…'));
  if (o.type === 'terrain') btns.appendChild(el('button', { class: 'btn', onclick: () => openTerrLab(), 'data-hint': 'Open the Terrain Editor' }, 'Terrain Editor…'));
  btns.appendChild(el('button', { class: 'btn', onclick: duplicateSelected }, 'Duplicate'));
  if (!plane) btns.appendChild(el('button', { class: 'btn', onclick: landSelected }, 'Land on surface'));
  btns.appendChild(el('button', { class: 'btn', onclick: deleteSelected }, 'Delete'));
  ms.appendChild(btns);
  wrap.appendChild(ms);
  attrs.appendChild(wrap);
}
function updateAttrValues() {
  const o = selectedObj(); if (!o) return;
  $$('.attr .vec input').forEach((inp) => { if (document.activeElement === inp) return; inp.value = (+o[inp.dataset.key][+inp.dataset.i]).toFixed(2); });
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderChips() {
  const s = $('#selection');
  s.innerHTML = '';
  for (const o of app.state.objects) {
    const b = el('button', { class: 'chip' + (o.id === app.state.selected ? ' on' : '') + (o.hidden ? ' hid' : ''), 'data-hint': `Select ${o.name}` });
    b.innerHTML = `<i style="background:${TYPE_DOT[o.type]}"></i>${escapeHtml(o.name)}`;
    b.addEventListener('click', () => app.select(o.id));
    s.appendChild(b);
  }
}

// ---------------------------------------------------------------- Materials Lab
let labState = null;
function openMatLab() {
  const o = selectedObj(); if (!o) return toast('Select an object first');
  app.beginChange();
  labState = { o, orig: structuredClone(o.mat), cat: Object.keys(MATERIALS).find(c => MATERIALS[c][o.mat.preset]) || 'Simple & Fun' };
  $('#matTarget').textContent = `for ${o.name}`;
  $('#matLab').hidden = false;
  renderLabCats(); renderLabGrid(); renderLabParams(); labPreview();
}
function renderLabCats() {
  const c = $('#matCats'); c.innerHTML = '';
  for (const cat of Object.keys(MATERIALS)) {
    const b = el('button', { class: cat === labState.cat ? 'on' : '' }, cat);
    b.addEventListener('click', () => { labState.cat = cat; renderLabCats(); renderLabGrid(); });
    c.appendChild(b);
  }
}
function renderLabGrid() {
  const g = $('#matGrid'); g.innerHTML = '';
  for (const [name, m] of Object.entries(MATERIALS[labState.cat])) {
    const b = el('button', { class: 'mat-item' + (labState.o.mat.preset === name ? ' on' : ''), 'data-hint': `Apply ${name}` });
    const cv = el('canvas');
    b.append(cv, el('span', {}, name));
    queueThumb(() => matThumb(cv, { ...m, preset: name }, 72));
    b.addEventListener('click', () => { labState.o.mat = findMaterial(name); applyLab(); renderLabGrid(); renderLabParams(); });
    g.appendChild(b);
  }
}
function renderLabParams() {
  const m = labState.o.mat;
  const p = $('#matParams'); p.innerHTML = '';
  $('#matName').textContent = m.preset || 'Custom';
  const texRow = el('div', { class: 'prow' }, '<span>Texture</span>');
  const sel = el('select', { 'aria-label': 'Texture' });
  for (const [v, n] of Object.entries(TEX_NAMES)) sel.appendChild(el('option', { value: v }, n));
  sel.value = m.tex;
  sel.addEventListener('change', () => { m.tex = +sel.value; m.preset = 'Custom'; applyLab(); });
  texRow.appendChild(sel); p.appendChild(texRow);
  const colRow = el('div', { class: 'prow' }, '<span>Colours</span>');
  const cols = el('div', { class: 'cols' });
  for (const k of ['c1', 'c2']) {
    const ci = el('input', { type: 'color', 'aria-label': k === 'c1' ? 'Primary colour' : 'Secondary colour' }); ci.value = m[k];
    ci.addEventListener('input', () => { m[k] = ci.value; m.preset = 'Custom'; applyLab(); });
    cols.appendChild(ci);
  }
  colRow.appendChild(cols); p.appendChild(colRow);
  const sl = (label, k, min, max, step) => {
    const r = el('div', { class: 'prow' }, `<span>${label}</span>`);
    const i = el('input', { type: 'range', min, max, step, 'aria-label': label }); i.value = m[k];
    const out = el('output', {}, (+m[k]).toFixed(2));
    i.addEventListener('input', () => { m[k] = +i.value; out.textContent = (+i.value).toFixed(2); m.preset = 'Custom'; applyLab(); });
    r.append(i, out); p.appendChild(r);
  };
  sl('Scale', 'scale', 0.05, 6, 0.05); sl('Bump', 'bump', 0, 1, 0.01); sl('Specular', 'spec', 0, 1, 0.01);
  sl('Reflection', 'refl', 0, 1, 0.01); sl('Transparency', 'transp', 0, 1, 0.01); sl('Refraction', 'ior', 1, 2.5, 0.01);
  sl('Glow', 'emit', 0, 4, 0.05); sl('Metallic', 'metal', 0, 1, 0.01);
}
let labT = null;
function applyLab() {
  $('#matName').textContent = labState.o.mat.preset || 'Custom';
  app.objectChanged(labState.o);
  clearTimeout(labT); labT = setTimeout(labPreview, 50);
}
function labPreview() { matThumb($('#matPreview'), labState.o.mat, 220); }
function closeMatLab(cancel) {
  if (!labState) return;
  if (cancel) { labState.o.mat = labState.orig; app.objectChanged(labState.o); app.undo.pop(); }
  labState = null; $('#matLab').hidden = true; renderAttrs();
}

// ---------------------------------------------------------------- Terrain Editor
let terr = null;
const tCanvas = $('#terrCanvas');
const brush = { mode: 'raise', size: 0.08, strength: 0.6 };
function openTerrLab() {
  const o = selectedObj(); if (!o || o.type !== 'terrain') return toast('Select a terrain first');
  app.beginChange();
  terr = { o, orig: { data: new Float32Array(o.terrain.data), res: o.terrain.res }, view: 'shade' };
  $('#terrTarget').textContent = `for ${o.name}`;
  $('#terrLab').hidden = false;
  $$('#terrRes button').forEach(b => b.classList.toggle('on', +b.dataset.res === o.terrain.res));
  drawTerrain();
}
function drawTerrain() {
  const { data, res } = terr.o.terrain;
  const off = document.createElement('canvas'); off.width = res; off.height = res;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(res, res);
  const L = [-0.6, 0.7, -0.4]; const ll = Math.hypot(...L);
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const i = z * res + x, h = data[i];
    let r, g, b;
    if (terr.view === 'gray') { r = g = b = h * 255; }
    else {
      const hx = data[z * res + Math.min(res - 1, x + 1)] - data[z * res + Math.max(0, x - 1)];
      const hz = data[Math.min(res - 1, z + 1) * res + x] - data[Math.max(0, z - 1) * res + x];
      const n = [-hx * res * 0.35, 1, -hz * res * 0.35]; const nl = Math.hypot(...n);
      const sh = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / (nl * ll));
      let base;
      if (terr.view === 'color') base = h < 0.25 ? [60, 110, 60] : h < 0.5 ? [150, 140, 90] : h < 0.75 ? [130, 105, 85] : [235, 235, 240];
      else base = [70 + h * 170, 72 + h * 160, 74 + h * 150];
      const k = 0.35 + sh * 0.85;
      [r, g, b] = base.map(v => v * k);
    }
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const c = tCanvas.getContext('2d');
  c.imageSmoothingEnabled = true;
  c.drawImage(off, 0, 0, tCanvas.width, tCanvas.height);
}
let terrPushT = 0;
function terrCommit(force) {
  const now = performance.now();
  const o = terr.o;
  o.terrain.version = (o.terrain.version || 0) + 1;
  if (force || now - terrPushT > 140) { terrPushT = now; editor.refreshGeometry(o); markDirty(); }
}
function buildTerrUI() {
  const gen = $('#terrGen');
  for (const [k, g] of Object.entries(TER.GENERATORS)) gen.appendChild(el('button', { class: 'btn', 'data-hint': g.hint, onclick: () => { terr.o.terrain.data = TER.generate(k, terr.o.terrain.res); terr.o.terrain.gen = k; drawTerrain(); terrCommit(true); } }, g.label));
  const ops = $('#terrOps');
  for (const [k, g] of Object.entries(TER.OPS)) ops.appendChild(el('button', { class: 'btn', 'data-hint': g.hint, onclick: () => { TER.applyOp(k, terr.o.terrain.data, terr.o.terrain.res); drawTerrain(); terrCommit(true); } }, g.label));
  $$('#brushMode button').forEach(b => b.addEventListener('click', () => { brush.mode = b.dataset.bm; $$('#brushMode button').forEach(x => x.classList.toggle('on', x === b)); }));
  $$('#terrView button').forEach(b => b.addEventListener('click', () => { terr.view = b.dataset.tv; $$('#terrView button').forEach(x => x.classList.toggle('on', x === b)); drawTerrain(); }));
  $$('#terrRes button').forEach(b => b.addEventListener('click', () => {
    const nr = +b.dataset.res; const t = terr.o.terrain;
    if (nr === t.res) return;
    const nd = new Float32Array(nr * nr);
    for (let z = 0; z < nr; z++) for (let x = 0; x < nr; x++) nd[z * nr + x] = TER.sample(t.data, t.res, (x + 0.5) / nr, (z + 0.5) / nr);
    t.data = nd; t.res = nr;
    $$('#terrRes button').forEach(x => x.classList.toggle('on', x === b));
    drawTerrain(); terrCommit(true);
  }));
  const host = $('#brushHost');
  host.append(
    scrub({ label: 'Brush size', min: 0.02, max: 0.3, get: () => brush.size, set: v => brush.size = v, fmt: v => Math.round(v * 100), hint: 'Brush size' }),
    scrub({ label: 'Strength', min: 0.05, max: 1, get: () => brush.strength, set: v => brush.strength = v, fmt: v => Math.round(v * 100), hint: 'Brush strength' }),
  );
  let painting = false;
  const paint = (e) => {
    const rc = tCanvas.getBoundingClientRect();
    const u = (e.clientX - rc.left) / rc.width, v = (e.clientY - rc.top) / rc.height;
    TER.brush(terr.o.terrain.data, terr.o.terrain.res, u, v, brush.size, brush.strength, e.altKey ? (brush.mode === 'raise' ? 'lower' : 'raise') : brush.mode);
    drawTerrain(); terrCommit(false);
  };
  tCanvas.addEventListener('pointerdown', (e) => { painting = true; tCanvas.setPointerCapture(e.pointerId); paint(e); });
  tCanvas.addEventListener('pointermove', (e) => painting && paint(e));
  tCanvas.addEventListener('pointerup', () => { painting = false; terrCommit(true); });
}
function closeTerrLab(cancel) {
  if (!terr) return;
  if (cancel) { terr.o.terrain.data = terr.orig.data; terr.o.terrain.res = terr.orig.res; app.undo.pop(); }
  terrCommit(true);
  terr = null; $('#terrLab').hidden = true;
}

// modal buttons
$$('.modal').forEach(m => {
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-close]')) closeModal(m, false);
    else if (e.target.closest('[data-cancel]')) closeModal(m, true);
  });
});
function closeModal(m, cancel) {
  if (m.id === 'matLab') closeMatLab(cancel);
  else if (m.id === 'terrLab') closeTerrLab(cancel);
  else m.hidden = true;
}

// ---------------------------------------------------------------- left panel controls
function setViewButtons(v) { $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === v)); $('#viewBadge').textContent = viewLabel(v); }
$$('#views button').forEach(b => b.addEventListener('click', () => {
  if (app.mode === 'render') stopRender(true);
  editor.setView(b.dataset.view); setViewButtons(b.dataset.view);
}));
function dragControl(node, onMove) {
  let s = null;
  node.addEventListener('pointerdown', (e) => { s = { x: e.clientX, y: e.clientY, cam: structuredClone(app.state.camera) }; node.setPointerCapture(e.pointerId); app.cameraWillMove(); });
  node.addEventListener('pointermove', (e) => { if (!s) return; onMove(e.clientX - s.x, e.clientY - s.y, s.cam); editor.updateCamera(); app.cameraMoved(); });
  node.addEventListener('pointerup', () => { s = null; app.cameraDone(); });
}
dragControl($('#trackball'), (dx, dy, c0) => { const c = app.state.camera; c.yaw = c0.yaw - dx * 0.012; c.pitch = clamp(c0.pitch + dy * 0.01, -1.45, 1.45); });
dragControl($('#cross'), (dx, dy, c0) => {
  const c = app.state.camera; const s = c0.dist * 0.01;
  const fwd = [-Math.sin(c0.yaw), -Math.cos(c0.yaw)], right = [Math.cos(c0.yaw), -Math.sin(c0.yaw)];
  c.target = [c0.target[0] + right[0] * dx * s - fwd[0] * dy * s, c0.target[1], c0.target[2] + right[1] * dx * s - fwd[1] * dy * s];
});
function holdZoom(btn, k) {
  let iv = null;
  const stop = () => { clearInterval(iv); iv = null; app.cameraDone(); };
  btn.addEventListener('pointerdown', () => { app.cameraWillMove(); const f = () => { const c = app.state.camera; c.dist = clamp(c.dist * k, 2, 1500); editor.updateCamera(); app.cameraMoved(); }; f(); iv = setInterval(f, 40); });
  btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', () => iv && stop());
}
holdZoom($('#zoomIn'), 0.95); holdZoom($('#zoomOut'), 1.05);
const fovScrub = scrub({ label: 'Field of view', min: 15, max: 100, step: 1, get: () => app.state.camera.fov, set: (v) => { app.state.camera.fov = v; editor.updateCamera(); app.cameraMoved(); }, fmt: v => `${v.toFixed(0)}°`, hint: 'Camera field of view' });
$('#fovHost').appendChild(fovScrub);
function renderDots() {
  const d = $('#camDots'); d.innerHTML = '';
  app.camMem.forEach((m, i) => {
    const b = el('button', { class: m ? 'set' : '', 'data-hint': m ? 'Recall this camera position (Shift-click to clear)' : 'Store the current camera position', 'aria-label': `Camera memory ${i + 1}` });
    b.addEventListener('click', (e) => {
      if (e.shiftKey && m) { app.camMem[i] = null; }
      else if (m) { app.cameraWillMove(); app.state.camera = structuredClone(m); editor.updateCamera(); app.cameraMoved(); fovScrub.refresh(); }
      else { app.camMem[i] = structuredClone(app.state.camera); toast('Camera stored'); }
      renderDots();
    });
    d.appendChild(b);
  });
}
renderDots();

$('#renderBtn').addEventListener('click', () => startRender());
$('#stopBtn').addEventListener('click', () => stopRender(false));
$('#saveImgBtn').addEventListener('click', saveImage);
$('#renderScale').addEventListener('change', (e) => { renderScale = +e.target.value; });
$('#viewport').addEventListener('pointerdown', (e) => {
  if (app.mode === 'render') { e.stopPropagation(); stopRender(true); }
}, true);
nanoCanvas.addEventListener('click', () => { nanoDirty = true; });
$('#nanoMenuBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#nanoMenu').hidden = !$('#nanoMenu').hidden; });
$('#nanoMenu').addEventListener('click', (e) => e.stopPropagation());
$$('input[name=nanoMode]').forEach(r => r.addEventListener('change', () => { nrt.settings.skyOnly = r.value === 'sky' && r.checked ? 1 : 0; nanoDirty = true; }));

// menus
$$('.menu').forEach(m => {
  const btn = $('.menu-btn', m), list = $('.menu-list', m);
  btn.addEventListener('click', (e) => { e.stopPropagation(); const open = list.hidden; closeMenus(); list.hidden = !open; m.classList.toggle('open', open); });
  list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; closeMenus(); menuAction(b.dataset.act, b.dataset.ex); });
});
function closeMenus() { $$('.menu-list').forEach(l => l.hidden = true); $$('.menu').forEach(m => m.classList.remove('open')); $('#nanoMenu').hidden = true; }
document.addEventListener('click', closeMenus);
const exList = $('#exampleList');
for (const name of Object.keys(EXAMPLES)) { if (name === 'Empty World') continue; exList.appendChild(el('button', { 'data-act': 'example', 'data-ex': name }, name)); }
function menuAction(act, ex) {
  switch (act) {
    case 'new': app.beginChange(); loadScene(EXAMPLES['Empty World']()); toast('New world'); break;
    case 'example': app.beginChange(); loadScene(EXAMPLES[ex]()); toast(ex); setTimeout(startRender, 60); break;
    case 'open': $('#fileIn').click(); break;
    case 'save': saveScene(); break;
    case 'saveimg': saveImage(); break;
    case 'undo': doUndo(); break;
    case 'redo': doRedo(); break;
    case 'duplicate': duplicateSelected(); break;
    case 'delete': deleteSelected(); break;
    case 'deselect': app.select(null); break;
    case 'help': $('#help').hidden = false; break;
  }
}
function saveScene() {
  const data = {
    format: 'bryce-web', version: 1, sky: app.state.sky, camera: app.state.camera,
    objects: app.state.objects.map(o => ({ ...o, terrain: o.terrain ? { ...o.terrain, data: Array.from(o.terrain.data, v => +v.toFixed(4)) } : undefined })),
  };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'bryce-scene.json');
}
$('#fileIn').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.objects)) throw new Error('bad');
    for (const o of d.objects) if (o.terrain) o.terrain.data = Float32Array.from(o.terrain.data);
    app.beginChange();
    loadScene({ objects: d.objects, sky: d.sky, camera: d.camera });
    toast(`Opened ${f.name}`);
  } catch { toast('That file is not a Bryce Web scene'); }
  e.target.value = '';
});

// hints
const hintEl = $('#hint');
let hintLock = 0;
function setHint(t) { hintEl.textContent = t; hintLock = performance.now() + 2500; }
document.addEventListener('mouseover', (e) => {
  const h = e.target.closest('[data-hint]');
  if (h) { hintEl.textContent = h.dataset.hint; hintLock = 0; }
});
document.addEventListener('mouseout', (e) => { if (e.target.closest('[data-hint]') && performance.now() > hintLock) hintEl.textContent = DEFAULT_HINT; });
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 1600); }

// keyboard
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, select, textarea') && e.target.type !== 'checkbox' && e.target.type !== 'radio';
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') {
    const open = $$('.modal').find(m => !m.hidden);
    if (open) return closeModal(open, false);
    if (app.mode === 'render') return stopRender(true);
    return app.select(null);
  }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); startRender(); return; }
  if (mod && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); setTab(['create', 'edit', 'sky'][+e.key - 1]); return; }
  if ($$('.modal').some(m => !m.hidden)) return;
  if (e.key === 'Enter') { startRender(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  const k = e.key.toLowerCase();
  if (k === 'w') setMode('translate');
  if (k === 'e') setMode('rotate');
  if (k === 'r') setMode('scale');
});

// ---------------------------------------------------------------- loop
const vp = $('#viewport');
function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  editor.resize(w, h);
}
new ResizeObserver(resize).observe(vp);
resize();

let last = performance.now();
let booted = false;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = now - last; last = now;

  // main view
  if (app.mode === 'render') {
    if (!rt.done) {
      if (dt > 42) budget *= 0.72; else if (dt < 24) budget *= 1.18;
      budget = clamp(budget, 4000, 1500000);
      rt.step(budget);
      const pct = rt.progress();
      $('#progBar').style.width = `${(pct * 100).toFixed(1)}%`;
      $('#hudPass').textContent = rt.passLabel();
      $('#hudPct').textContent = `${Math.floor(pct * 100)}%`;
      $('#renderStatus').textContent = `${rt.passLabel()} · ${((now - renderStart) / 1000).toFixed(1)}s`;
      if (rt.done) {
        const secs = ((performance.now() - renderStart) / 1000).toFixed(1);
        $('#renderStatus').textContent = `Rendered ${rt.w}×${rt.h} in ${secs}s`;
        $('#hudPass').textContent = 'Done'; $('#hudPct').textContent = `${secs}s`;
        $('#renderBtn').classList.remove('busy');
        bgValid = true;
        setHint('Render complete. Click the image to go back to the wireframe, or Save image to keep it.');
      }
    }
    rt.display(1);
  } else {
    const plop = $('#plop').checked && bgValid && rt.hasImage() && editor.view === 'camera';
    if (plop) { rt.display(0.55); editor.render(true); }
    else editor.render(false);
  }

  // nano preview
  if (nanoDirty && $('#nanoAuto').checked && now - lastNanoStart > 90) {
    nanoDirty = false; lastNanoStart = now;
    editor.updateCamera();
    const cam = editor.persp.clone(); cam.aspect = 200 / 140; cam.updateProjectionMatrix();
    nrt.sync(app.state, cam);
    nrt.start(200, 140, { blocks: [4], aa: 1 });
  } else if (nanoDirty && !$('#nanoAuto').checked) nanoDirty = false;
  if (!nrt.done) { nrt.step(14000); nrt.display(1); if (nrt.done && !booted) boot(); }
  else if (nrt.hasImage()) nrt.display(1);

  if (booted) pumpThumbs();
}

function boot() {
  booted = true;
  $('#boot').hidden = true;
  setTimeout(startRender, 150);
}

// ---------------------------------------------------------------- start
buildTerrUI();
loadScene(EXAMPLES['Mountain Lake']());
app.undo.length = 0;
hintEl.textContent = 'Welcome to Bryce Web. Your first scene is rendering — click the picture to start editing.';
requestAnimationFrame(frame);

// testing hooks
window.__bryceDebug = { rt, nrt, editor, startRender, loadScene, EXAMPLES, addObject, openMatLab, openTerrLab, setTab };
