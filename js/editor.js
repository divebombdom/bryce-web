import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { TYPES } from './scene.js';
import { sample } from './terrain.js';
import { objectMatrix } from './raytracer.js';

const DEG = Math.PI / 180;

// ---------- wireframe line builders (unit local space, matching the SDFs) ----------
function circle(pts, r, y, seg = 32, fn) {
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, y, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y, Math.sin(a1) * r];
    if (fn) { fn(p0); fn(p1); }
    pts.push(...p0, ...p1);
  }
}

function stoneShape(n, seed) {
  const a = seed * 1.731, b = seed * 0.917, c = seed * 2.313;
  return 0.16 * Math.sin(3.1 * n[0] + a) * Math.sin(2.7 * n[1] + b) * Math.sin(3.3 * n[2] + c)
    + 0.08 * Math.sin(6.3 * n[0] + c) * Math.sin(5.9 * n[2] + a) * Math.sin(6.7 * n[1] + b)
    + 0.10 * n[1];
}

function sphereLines(radiusFn, lat = 9, lon = 12) {
  const pts = [];
  const P = (th, ph) => {
    const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    const r = radiusFn(n);
    return [n[0] * r, n[1] * r, n[2] * r];
  };
  for (let i = 1; i < lat; i++) {
    const th = i / lat * Math.PI;
    for (let j = 0; j < 36; j++) pts.push(...P(th, j / 36 * Math.PI * 2), ...P(th, (j + 1) / 36 * Math.PI * 2));
  }
  for (let j = 0; j < lon; j++) {
    const ph = j / lon * Math.PI * 2;
    for (let i = 0; i < 24; i++) pts.push(...P(i / 24 * Math.PI, ph), ...P((i + 1) / 24 * Math.PI, ph));
  }
  return pts;
}

function terrainLines(o, n = 28) {
  const { data, res } = o.terrain;
  const pts = [];
  const H = (u, v) => sample(data, res, u, v);
  const V = (i, j) => { const u = i / n, v = j / n; return [u * 2 - 1, H(u, v), v * 2 - 1]; };
  for (let j = 0; j <= n; j++) for (let i = 0; i < n; i++) { pts.push(...V(i, j), ...V(i + 1, j)); pts.push(...V(j, i), ...V(j, i + 1)); }
  return pts;
}

export function wireLines(o) {
  switch (o.type) {
    case 'sphere': return sphereLines(() => 1);
    case 'stone': return sphereLines((nn) => 0.86 + stoneShape(nn, o.seed), 8, 10);
    case 'cube': {
      const e = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
      const pts = Array.from(e.attributes.position.array);
      // inner cross lines for Bryce-like look
      for (const s of [-1, 1]) pts.push(-1, s, 0, 1, s, 0, 0, s, -1, 0, s, 1);
      return pts;
    }
    case 'cylinder': case 'disk': {
      const pts = [];
      circle(pts, 1, -1); circle(pts, 1, 1); circle(pts, 1, 0, 32);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push(Math.cos(a), -1, Math.sin(a), Math.cos(a), 1, Math.sin(a)); }
      return pts;
    }
    case 'cone': {
      const pts = [];
      circle(pts, 1, -1); circle(pts, 0.5, 0);
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; pts.push(Math.cos(a), -1, Math.sin(a), 0, 1, 0); }
      return pts;
    }
    case 'pyramid': {
      const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const pts = [];
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pts.push(a[0], -1, a[1], b[0], -1, b[1], a[0], -1, a[1], 0, 1, 0); }
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; pts.push(a[0] / 2, 0, a[1] / 2, b[0] / 2, 0, b[1] / 2); }
      return pts;
    }
    case 'torus': {
      const pts = [];
      const R = 0.72, r = 0.28;
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        for (let j = 0; j < 20; j++) {
          const b0 = j / 20 * Math.PI * 2, b1 = (j + 1) / 20 * Math.PI * 2;
          const P = (b) => [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)];
          pts.push(...P(b0), ...P(b1));
        }
      }
      for (const b of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) circle(pts, R + r * Math.cos(b), r * Math.sin(b), 40);
      return pts;
    }
    case 'terrain': return terrainLines(o);
    default: return [];
  }
}

function pickGeometry(o) {
  switch (o.type) {
    case 'sphere': case 'stone': return new THREE.SphereGeometry(1, 16, 12);
    case 'cube': return new THREE.BoxGeometry(2, 2, 2);
    case 'cylinder': case 'disk': return new THREE.CylinderGeometry(1, 1, 2, 16);
    case 'cone': return new THREE.ConeGeometry(1, 2, 16);
    case 'pyramid': { const g = new THREE.ConeGeometry(Math.SQRT2, 2, 4); g.rotateY(Math.PI / 4); return g; }
    case 'torus': { const g = new THREE.TorusGeometry(0.72, 0.28, 8, 24); g.rotateX(Math.PI / 2); return g; }
    case 'terrain': {
      const n = 24, g = new THREE.PlaneGeometry(2, 2, n, n);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, sample(o.terrain.data, o.terrain.res, p.getX(i) * 0.5 + 0.5, p.getZ(i) * 0.5 + 0.5));
      g.computeBoundingSphere();
      return g;
    }
    default: { const g = new THREE.PlaneGeometry(6000, 6000); g.rotateX(-Math.PI / 2); return g; }
  }
}

const PLANE_COLORS = { water: 0x6fa3c9, ground: 0xa88a64, cloud: 0xe8ecf2 };
const WIRE = 0xdcd6c8, SEL = 0xff4b33;

export class Editor {
  constructor(renderer, canvas, app) {
    this.r = renderer;
    this.canvas = canvas;
    this.app = app;
    this.scene = new THREE.Scene();
    this.bg = new THREE.Color(0x36383a);
    this.scene.fog = new THREE.Fog(0x36383a, 30, 400);
    this.persp = new THREE.PerspectiveCamera(48, 1, 0.1, 6000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    this.view = 'camera';
    this.orthoZoom = { top: 60, front: 40, side: 40 };
    this.orthoCenter = { top: new THREE.Vector3(), front: new THREE.Vector3(0, 8, 0), side: new THREE.Vector3(0, 8, 0) };
    this.items = new Map();

    this.grid = new THREE.GridHelper(400, 40, 0x4a4c4f, 0x434547);
    this.grid.material.fog = true;
    this.scene.add(this.grid);

    this.helperCam = new THREE.PerspectiveCamera(48, 1, 0.5, 6);
    this.camHelper = new THREE.CameraHelper(this.helperCam);
    this.camHelper.visible = false;
    this.scene.add(this.camHelper);

    this.tc = new TransformControls(this.persp, canvas);
    this.tc.setSize(0.9);
    this.tcHelper = this.tc.getHelper();
    this.scene.add(this.tcHelper);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.dragging = e.value;
      if (e.value) app.beginChange(); else app.endChange();
    });
    this.tc.addEventListener('objectChange', () => this.onTransform());

    this.selBox = new THREE.Box3Helper(new THREE.Box3(), SEL);
    this.selBox.material.transparent = true; this.selBox.material.opacity = 0.35;
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    this.ray = new THREE.Raycaster();
    this.bindInput();
  }

  get camera() { return this.view === 'camera' ? this.persp : this.ortho; }

  setView(v) {
    this.view = v;
    this.tc.camera = this.camera;
    this.camHelper.visible = v !== 'camera';
    this.updateCamera();
  }

  updateCamera() {
    const c = this.app.state.camera;
    const t = new THREE.Vector3(...c.target);
    const off = new THREE.Vector3(Math.sin(c.yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(c.yaw) * Math.cos(c.pitch)).multiplyScalar(c.dist);
    this.persp.position.copy(t).add(off);
    this.persp.up.set(0, 1, 0);
    this.persp.lookAt(t);
    this.persp.fov = c.fov;
    this.persp.updateProjectionMatrix();
    this.persp.updateMatrixWorld();
    this.helperCam.position.copy(this.persp.position);
    this.helperCam.quaternion.copy(this.persp.quaternion);
    this.helperCam.fov = c.fov; this.helperCam.aspect = this.persp.aspect;
    this.helperCam.far = Math.max(4, c.dist * 0.25);
    this.helperCam.updateProjectionMatrix(); this.helperCam.updateMatrixWorld();
    this.camHelper.update();
    if (this.view !== 'camera') {
      const z = this.orthoZoom[this.view], cen = this.orthoCenter[this.view];
      const a = this.aspect || 1;
      Object.assign(this.ortho, { left: -z * a, right: z * a, top: z, bottom: -z });
      this.ortho.up.set(0, 1, 0);
      if (this.view === 'top') { this.ortho.position.set(cen.x, 1000, cen.z); this.ortho.up.set(0, 0, -1); }
      if (this.view === 'front') this.ortho.position.set(cen.x, cen.y, 1000);
      if (this.view === 'side') this.ortho.position.set(1000, cen.y, cen.z);
      this.ortho.lookAt(this.view === 'top' ? new THREE.Vector3(cen.x, 0, cen.z) : this.view === 'front' ? new THREE.Vector3(cen.x, cen.y, 0) : new THREE.Vector3(0, cen.y, cen.z));
      this.ortho.updateProjectionMatrix();
      this.ortho.updateMatrixWorld();
    }
    // follow-camera plane grids
    const fc = this.view === 'camera' ? t : this.orthoCenter[this.view];
    for (const it of this.items.values()) if (it.isPlane) { it.lines.position.x = Math.round(fc.x / 20) * 20; it.lines.position.z = Math.round(fc.z / 20) * 20; }
    this.scene.fog.near = this.view === 'camera' ? c.dist * 0.6 : 4000;
    this.scene.fog.far = this.view === 'camera' ? c.dist * 6 + 120 : 6000;
  }

  resize(w, h) {
    this.aspect = w / h;
    this.persp.aspect = w / h;
    this.updateCamera();
  }

  // ---------- object sync ----------
  rebuildAll() {
    for (const it of this.items.values()) { this.scene.remove(it.group); it.group.traverse(c => c.geometry && c.geometry.dispose()); }
    this.items.clear();
    for (const o of this.app.state.objects) this.addItem(o);
    this.refreshSelection();
  }

  addItem(o) {
    const group = new THREE.Group();
    group.userData.id = o.id;
    const isPlane = !!TYPES[o.type].plane;
    let lines;
    if (isPlane) {
      const div = o.type === 'cloud' ? 24 : 60;
      lines = new THREE.GridHelper(o.type === 'cloud' ? 1200 : 600, div, PLANE_COLORS[o.type], PLANE_COLORS[o.type]);
      lines.material.transparent = true; lines.material.opacity = o.type === 'cloud' ? 0.35 : 0.55;
      lines.material.fog = true;
      this.scene.add(lines);
      lines.userData.planeOf = o.id;
    } else {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wireLines(o), 3));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: WIRE, fog: true, transparent: true, opacity: 0.92 }));
      group.add(lines);
    }
    const pick = new THREE.Mesh(pickGeometry(o), new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    pick.userData.id = o.id;
    group.add(pick);
    this.scene.add(group);
    const it = { group, lines, pick, isPlane, o };
    this.items.set(o.id, it);
    this.syncItem(o);
    return it;
  }

  removeItem(id) {
    const it = this.items.get(id);
    if (!it) return;
    if (this.tc.object === it.group) this.tc.detach();
    this.scene.remove(it.group);
    if (it.isPlane) this.scene.remove(it.lines);
    this.items.delete(id);
  }

  syncItem(o) {
    const it = this.items.get(o.id);
    if (!it) return;
    it.o = o;
    const m = objectMatrix(o);
    m.decompose(it.group.position, it.group.quaternion, it.group.scale);
    if (it.isPlane) { it.lines.position.y = o.pos[1]; it.group.position.set(0, o.pos[1], 0); }
    it.group.visible = !o.hidden;
    if (it.isPlane) it.lines.visible = !o.hidden;
  }

  refreshGeometry(o) {
    const it = this.items.get(o.id);
    if (!it || it.isPlane) return;
    it.lines.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(wireLines(o), 3));
    it.lines.geometry = g;
    it.pick.geometry.dispose();
    it.pick.geometry = pickGeometry(o);
  }

  refreshSelection() {
    const sel = this.app.state.selected;
    for (const [id, it] of this.items) {
      const on = id === sel;
      const col = on ? SEL : it.isPlane ? PLANE_COLORS[it.o.type] : WIRE;
      if (it.isPlane) { it.lines.material.color.set(col); it.lines.material.opacity = on ? 0.8 : (it.o.type === 'cloud' ? 0.35 : 0.55); }
      else it.lines.material.color.set(col);
    }
    const it = this.items.get(sel);
    if (it && !it.o.hidden) {
      this.tc.attach(it.group);
      this.applyMode();
    } else this.tc.detach();
    this.updateSelBox();
  }

  updateSelBox() {
    const it = this.items.get(this.app.state.selected);
    if (it && !it.isPlane && !it.o.hidden) {
      it.group.updateMatrixWorld(true);
      this.selBox.box.setFromObject(it.pick);
      this.selBox.visible = true;
    } else this.selBox.visible = false;
  }

  setMode(m) { this.mode = m; this.applyMode(); }
  applyMode() {
    const it = this.items.get(this.app.state.selected);
    const mode = this.mode || 'translate';
    if (!it) return;
    if (it.isPlane) {
      this.tc.setMode('translate');
      this.tc.showX = false; this.tc.showZ = false; this.tc.showY = true;
    } else {
      this.tc.setMode(mode);
      this.tc.showX = this.tc.showY = this.tc.showZ = true;
    }
    this.tc.setSpace(mode === 'scale' ? 'local' : 'world');
  }

  onTransform() {
    const it = this.items.get(this.app.state.selected);
    if (!it) return;
    const o = it.o;
    const g = it.group;
    if (it.isPlane) { o.pos[1] = +g.position.y.toFixed(3); g.position.x = 0; g.position.z = 0; it.lines.position.y = o.pos[1]; }
    else {
      o.pos = g.position.toArray().map(v => +v.toFixed(3));
      const e = new THREE.Euler().setFromQuaternion(g.quaternion, 'XYZ');
      o.rot = [e.x / DEG, e.y / DEG, e.z / DEG].map(v => +v.toFixed(2));
      o.scl = g.scale.toArray().map(v => +Math.max(0.01, Math.abs(v)).toFixed(3));
    }
    this.updateSelBox();
    this.app.objectChanged(o, { live: true });
  }

  // ---------- picking & navigation ----------
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const picks = [...this.items.values()].filter(i => !i.o.hidden).map(i => i.pick);
    const hits = this.ray.intersectObjects(picks, false);
    const solid = hits.find(h => !this.items.get(h.object.userData.id).isPlane);
    const h = solid || hits[0];
    return h ? h.object.userData.id : null;
  }

  bindInput() {
    const el = this.canvas;
    let down = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (this.tc.axis !== null && e.button === 0) return; // gizmo grabbed
      down = { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey, moved: false, cam: structuredClone(this.app.state.camera) };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!down || this.dragging) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!down.moved && Math.hypot(dx, dy) < 4) return;
      if (!down.moved) { down.moved = true; this.app.cameraWillMove(); }
      const c = this.app.state.camera;
      const pan = down.button === 2 || down.button === 1 || down.shift || this.view !== 'camera';
      if (this.view !== 'camera') {
        const z = this.orthoZoom[this.view];
        const s = (2 * z) / el.clientHeight;
        const cen = this.orthoCenter[this.view];
        if (!down.c0) down.c0 = cen.clone();
        if (this.view === 'top') cen.set(down.c0.x - dx * s, 0, down.c0.z - dy * s);
        if (this.view === 'front') cen.set(down.c0.x - dx * s, down.c0.y + dy * s, 0);
        if (this.view === 'side') cen.set(0, down.c0.y + dy * s, down.c0.z + dx * s);
      } else if (pan) {
        const s = down.cam.dist * 0.0016;
        const right = new THREE.Vector3(Math.cos(down.cam.yaw), 0, -Math.sin(down.cam.yaw));
        const up = new THREE.Vector3(0, 1, 0);
        const t = new THREE.Vector3(...down.cam.target).addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
        c.target = t.toArray();
      } else {
        c.yaw = down.cam.yaw - dx * 0.006;
        c.pitch = Math.max(-1.45, Math.min(1.45, down.cam.pitch + dy * 0.005));
      }
      this.updateCamera();
      this.app.cameraMoved();
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      if (!down.moved && down.button === 0 && !this.dragging) {
        const id = this.pick(e.clientX, e.clientY);
        this.app.select(id);
      }
      if (down.moved) this.app.cameraDone();
      down = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.app.cameraWillMove();
      const k = Math.exp(e.deltaY * 0.0012);
      if (this.view === 'camera') {
        const c = this.app.state.camera;
        c.dist = Math.max(2, Math.min(1500, c.dist * k));
      } else this.orthoZoom[this.view] = Math.max(3, Math.min(2000, this.orthoZoom[this.view] * k));
      this.updateCamera();
      this.app.cameraMoved();
      clearTimeout(this._wt); this._wt = setTimeout(() => this.app.cameraDone(), 250);
    }, { passive: false });
  }

  render(withBackground) {
    this.scene.background = withBackground ? null : this.bg;
    const ac = this.r.autoClear;
    if (withBackground) { this.r.autoClear = false; this.r.clearDepth(); }
    this.r.render(this.scene, this.camera);
    this.r.autoClear = ac;
  }
}
