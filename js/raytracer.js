import * as THREE from 'three';
import { VERT, buildFragment, sceneKey, DISPLAY_FRAG } from './shader.js';
import { TYPES } from './scene.js';

const DEG = Math.PI / 180;

export function sunDirection(sky) {
  const az = sky.sunAz * DEG, el = sky.sunEl * DEG;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

export function objectMatrix(o) {
  const m = new THREE.Matrix4();
  const plane = TYPES[o.type].plane;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(plane ? 0 : o.rot[0] * DEG, plane ? 0 : o.rot[1] * DEG, plane ? 0 : o.rot[2] * DEG, 'XYZ'));
  m.compose(new THREE.Vector3(...o.pos), q, new THREE.Vector3(...(plane ? [1, 1, 1] : o.scl)));
  return m;
}

export class Raytracer {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.key = null;
    this.mat = null;
    this.terrTex = new Map();
    this.displayMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: DISPLAY_FRAG,
      uniforms: { tPrev: { value: null }, tCur: { value: null }, uSplit: { value: 0 }, uHasPrev: { value: 0 }, uView: { value: new THREE.Vector2(1, 1) }, uDim: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
    this.passes = [];
    this.idx = 0;
    this.row = 0;
    this.prevTex = null;
    this.done = true;
    this.targets = {};
    this.settings = { bounces: 4, steps: 220, ao: 1, skyOnly: 0 };
  }

  build(objects) {
    const key = sceneKey(objects);
    if (key === this.key && this.mat) return false;
    this.key = key;
    const vis = objects.filter(o => !o.hidden);
    const N = Math.max(1, vis.length);
    const arr = (f) => Array.from({ length: N }, f);
    const uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) }, uJitter: { value: new THREE.Vector2(0.5, 0.5) },
      uCamPos: { value: new THREE.Vector3() }, uCamRot: { value: new THREE.Matrix3() }, uTanFov: { value: 0.5 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() }, uHazeCol: { value: new THREE.Color() },
      uFogCol: { value: new THREE.Color() }, uCloudCol: { value: new THREE.Color() },
      uHaze: { value: 0 }, uFog: { value: 0 }, uFogH: { value: 0 }, uShadow: { value: 1 }, uClouds: { value: 0 },
      uCloudH: { value: 150 }, uCloudFreq: { value: 1 }, uStars: { value: 0 }, uExposure: { value: 1 },
      uBounces: { value: 4 }, uSteps: { value: 200 }, uAO: { value: 1 }, uSkyOnly: { value: 0 },
      uPrev: { value: null }, uBlend: { value: 1 },
      uInv: { value: arr(() => new THREE.Matrix4()) }, uScl: { value: arr(() => new THREE.Vector3(1, 1, 1)) },
      uMS: { value: arr(() => 1) }, uPY: { value: arr(() => 0) },
      uC1: { value: arr(() => new THREE.Vector4()) }, uC2: { value: arr(() => new THREE.Vector4()) },
      uMA: { value: arr(() => new THREE.Vector4()) }, uMB: { value: arr(() => new THREE.Vector4()) }, uMC: { value: arr(() => new THREE.Vector4()) },
    };
    const nT = vis.filter(o => o.type === 'terrain').length;
    for (let k = 0; k < nT; k++) uniforms['uT' + k] = { value: null };
    if (nT) uniforms.uTres = { value: Array.from({ length: nT }, () => 128) };
    if (this.mat) this.mat.dispose();
    this.mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: buildFragment(objects), uniforms,
      depthTest: false, depthWrite: false,
    });
    return true;
  }

  terrainTexture(o) {
    const t = o.terrain;
    let e = this.terrTex.get(o.id);
    if (e && e.version === (t.version || 0) && e.res === t.res) return e.tex;
    if (e) e.tex.dispose();
    const half = new Uint16Array(t.res * t.res);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(t.data[i]);
    const tex = new THREE.DataTexture(half, t.res, t.res, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.terrTex.set(o.id, { tex, version: t.version || 0, res: t.res });
    return tex;
  }

  sync(state, camera) {
    this.build(state.objects);
    const u = this.mat.uniforms;
    const vis = state.objects.filter(o => !o.hidden);
    let k = 0;
    const c = new THREE.Color();
    vis.forEach((o, i) => {
      const m = objectMatrix(o);
      u.uInv.value[i].copy(m).invert();
      const plane = TYPES[o.type].plane;
      const s = plane ? [1, 1, 1] : o.scl;
      u.uScl.value[i].set(...s);
      u.uMS.value[i] = Math.min(...s.map(Math.abs));
      u.uPY.value[i] = o.pos[1];
      const mt = o.mat;
      c.set(mt.c1); u.uC1.value[i].set(c.r, c.g, c.b, 1);
      c.set(mt.c2); u.uC2.value[i].set(c.r, c.g, c.b, 1);
      u.uMA.value[i].set(mt.tex, mt.scale, mt.bump, mt.spec);
      u.uMB.value[i].set(mt.refl, mt.transp, mt.ior, mt.emit);
      u.uMC.value[i].set(mt.metal, plane ? 1 : 0, o.seed ?? 0, o.type === 'terrain' ? 1 : 0);
      if (o.type === 'terrain') {
        u['uT' + k].value = this.terrainTexture(o);
        u.uTres.value[k] = o.terrain.res;
        k++;
      }
    });
    const sky = state.sky;
    u.uSunDir.value.copy(sunDirection(sky));
    u.uSunCol.value.set(sky.sun).multiplyScalar(sky.sunPower * 1.5 * Math.min(1, Math.max(0.15, (sky.sunEl + 4) / 10)));
    u.uZenith.value.set(sky.zenith);
    u.uHorizon.value.set(sky.horizon);
    u.uAmb.value.set(sky.ambient).multiplyScalar(0.9);
    u.uHazeCol.value.set(sky.hazeColor);
    u.uFogCol.value.set(sky.fogColor);
    u.uCloudCol.value.set(sky.cloudColor);
    u.uHaze.value = sky.haze; u.uFog.value = sky.fog; u.uFogH.value = sky.fogHeight;
    u.uShadow.value = sky.shadows; u.uClouds.value = sky.clouds; u.uCloudH.value = sky.cloudHeight;
    u.uCloudFreq.value = sky.cloudFreq; u.uStars.value = sky.stars || 0; u.uExposure.value = sky.exposure;
    camera.updateMatrixWorld();
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    u.uTanFov.value = Math.tan(camera.fov * DEG / 2);
    u.uBounces.value = this.settings.bounces;
    u.uSteps.value = this.settings.steps;
    u.uAO.value = this.settings.ao;
    u.uSkyOnly.value = this.settings.skyOnly;
  }

  target(name, w, h) {
    let t = this.targets[name];
    if (t && t.width === w && t.height === h) return t;
    if (t) t.dispose();
    t = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, type: THREE.UnsignedByteType });
    this.targets[name] = t;
    return t;
  }

  start(w, h, { blocks = [16, 8, 4, 2], aa = 4 } = {}) {
    this.w = w; this.h = h;
    this.passes = [];
    for (const b of blocks) this.passes.push({ rt: this.target('b' + b, Math.ceil(w / b), Math.ceil(h / b)), jitter: [0.5, 0.5], blend: 1, label: `${b}×${b}` });
    const A = this.target('fullA', w, h), B = this.target('fullB', w, h);
    this.passes.push({ rt: A, jitter: [0.5, 0.5], blend: 1, label: 'Full' });
    for (let s = 1; s < aa; s++) {
      const rt = s % 2 ? B : A;
      this.passes.push({ rt, prev: s % 2 ? A : B, jitter: [halton(s + 1, 2), halton(s + 1, 3)], blend: 1 / (s + 1), label: `Antialias ${s}/${aa - 1}` });
    }
    this.idx = 0; this.row = 0; this.prevTex = null; this.done = false;
    this.finalTex = null;
  }

  // Render up to `budget` pixels of the current pass. Returns true when finished.
  step(budget) {
    if (this.done) return true;
    const p = this.passes[this.idx];
    const W = p.rt.width, H = p.rt.height;
    const rows = Math.max(1, Math.min(H - this.row, Math.floor(budget / W)));
    const y0 = H - this.row - rows;
    const u = this.mat.uniforms;
    u.uRes.value.set(W, H);
    u.uJitter.value.set(p.jitter[0], p.jitter[1]);
    u.uBlend.value = p.blend;
    u.uPrev.value = p.prev ? p.prev.texture : null;
    this.quad.material = this.mat;
    p.rt.scissor.set(0, y0, W, rows);
    p.rt.scissorTest = true;
    const ac = this.r.autoClear;
    this.r.autoClear = false;
    this.r.setRenderTarget(p.rt);
    this.r.render(this.scene, this.cam);
    this.r.setRenderTarget(null);
    this.r.autoClear = ac;
    p.rt.scissorTest = false;
    this.row += rows;
    if (this.row >= H) {
      this.prevTex = p.rt.texture;
      this.finalTex = p.rt.texture;
      this.idx++; this.row = 0;
      if (this.idx >= this.passes.length) this.done = true;
    }
    return this.done;
  }

  progress() {
    if (this.done) return 1;
    const p = this.passes[this.idx];
    return (this.idx + this.row / p.rt.height) / this.passes.length;
  }
  passLabel() { return this.done ? 'Done' : this.passes[this.idx].label; }

  display(dim = 1) {
    const d = this.displayMat.uniforms;
    const size = this.r.getDrawingBufferSize(new THREE.Vector2());
    d.uView.value.copy(size);
    d.uDim.value = dim;
    if (this.done || !this.passes.length) {
      d.tCur.value = this.finalTex; d.uSplit.value = 1; d.uHasPrev.value = 0;
      if (!this.finalTex) return;
    } else {
      const p = this.passes[this.idx];
      d.tCur.value = p.rt.texture;
      d.uSplit.value = this.row / p.rt.height;
      d.tPrev.value = this.prevTex;
      d.uHasPrev.value = this.prevTex ? 1 : 0;
    }
    this.quad.material = this.displayMat;
    this.r.setRenderTarget(null);
    this.r.render(this.scene, this.cam);
  }

  hasImage() { return !!this.finalTex; }

  // One-shot render to pixels (for thumbnails)
  renderPixels(w, h) {
    const rt = this.target('still', w, h);
    const u = this.mat.uniforms;
    u.uRes.value.set(w, h); u.uJitter.value.set(0.5, 0.5); u.uBlend.value = 1; u.uPrev.value = null;
    this.quad.material = this.mat;
    this.r.setRenderTarget(rt);
    this.r.render(this.scene, this.cam);
    const buf = new Uint8Array(w * h * 4);
    this.r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.r.setRenderTarget(null);
    return buf;
  }

  readFinal() {
    const tex = this.finalTex;
    if (!tex) return null;
    const rt = Object.values(this.targets).find(t => t.texture === tex);
    const buf = new Uint8Array(rt.width * rt.height * 4);
    this.r.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    return { buf, w: rt.width, h: rt.height };
  }
}
