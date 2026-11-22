// Heightmap generation and editing (values 0..1, row-major, row = z, col = x)

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function makeNoise2(seed) {
  const rnd = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const vals = new Float32Array(256).map(() => rnd());
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = vals[perm[X + perm[Y]]], b = vals[perm[X + 1 + perm[Y]]];
    const c = vals[perm[X + perm[Y + 1]]], d = vals[perm[X + 1 + perm[Y + 1]]];
    const u = fade(xf), v = fade(yf);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
}

export function normalize(h) {
  let mn = Infinity, mx = -Infinity;
  for (const v of h) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const r = mx - mn || 1;
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - mn) / r;
  return h;
}

function edgeFalloff(h, res, strength = 1) {
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const u = (x / (res - 1)) * 2 - 1, v = (z / (res - 1)) * 2 - 1;
    const r = Math.min(1, Math.sqrt(u * u + v * v));
    const edge = Math.max(Math.abs(u), Math.abs(v));
    let f = 1 - Math.pow(r, 2.2) * 0.85;
    f *= 1 - Math.pow(Math.max(0, (edge - 0.82) / 0.18), 1.5);
    h[z * res + x] *= 1 - strength + strength * Math.max(0, f);
  }
  return h;
}

export const GENERATORS = {
  fractal: { label: 'Fractal', hint: 'Classic fractal mountain' },
  ridged: { label: 'Ridges', hint: 'Sharp ridged peaks' },
  mesa: { label: 'Mesa', hint: 'Terraced canyon mesas' },
  dunes: { label: 'Dunes', hint: 'Rolling desert dunes' },
  crater: { label: 'Crater', hint: 'Impact crater with rim' },
  volcano: { label: 'Volcano', hint: 'Cone with caldera' },
};

export function generate(kind, res = 128, seed = Math.floor(Math.random() * 1e9)) {
  const n = makeNoise2(seed);
  const h = new Float32Array(res * res);
  const fbm = (x, y, oct = 7, lac = 2.03, gain = 0.5) => {
    let s = 0, a = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += a * n(x * f, y * f); norm += a; a *= gain; f *= lac; }
    return s / norm;
  };
  const ridged = (x, y) => {
    let s = 0, a = 0.5, f = 1, w = 1;
    for (let i = 0; i < 7; i++) {
      let v = 1 - Math.abs(n(x * f, y * f) * 2 - 1);
      v = v * v * w; w = Math.min(1, v * 2);
      s += v * a; a *= 0.5; f *= 2.05;
    }
    return s;
  };
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const u = x / res * 4, v = z / res * 4;
    const cu = (x / (res - 1)) * 2 - 1, cv = (z / (res - 1)) * 2 - 1;
    const r = Math.sqrt(cu * cu + cv * cv);
    let val = 0;
    switch (kind) {
      case 'ridged': val = ridged(u * 0.9, v * 0.9); break;
      case 'mesa': {
        const b = fbm(u * 0.7, v * 0.7, 6);
        const steps = 5;
        const q = b * steps;
        const fl = Math.floor(q);
        const t = q - fl;
        val = (fl + Math.pow(Math.min(1, t * 1.6), 6)) / steps + fbm(u * 3, v * 3, 3) * 0.03;
        break;
      }
      case 'dunes': {
        const w = fbm(u * 0.5, v * 0.5, 3) * 3;
        val = 0.5 + 0.35 * Math.sin(u * 3.2 + w * 2 + v * 0.8) * (0.6 + 0.4 * fbm(u, v, 3)) + fbm(u * 2, v * 2, 4) * 0.15;
        break;
      }
      case 'crater': {
        const rim = Math.exp(-Math.pow((r - 0.55) / 0.12, 2));
        const bowl = r < 0.55 ? -0.35 * (1 - Math.pow(r / 0.55, 2)) : 0;
        val = 0.35 + rim * 0.5 + bowl + fbm(u * 1.5, v * 1.5, 6) * 0.25 + Math.exp(-r * r / 0.01) * 0.15;
        break;
      }
      case 'volcano': {
        const cone = Math.max(0, 1 - r * 1.25);
        const cald = r < 0.12 ? (0.12 - r) * 3.2 : 0;
        val = Math.pow(cone, 1.3) - cald + ridged(u * 1.2, v * 1.2) * 0.18;
        break;
      }
      default: val = Math.pow(fbm(u * 0.8, v * 0.8, 8), 1.6);
    }
    h[z * res + x] = val;
  }
  normalize(h);
  if (kind !== 'dunes') edgeFalloff(h, res, kind === 'mesa' ? 0.7 : 1);
  else edgeFalloff(h, res, 0.6);
  normalize(h);
  return h;
}

export function sample(h, res, u, v) {
  const x = Math.min(res - 1, Math.max(0, u * res - 0.5));
  const y = Math.min(res - 1, Math.max(0, v * res - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(res - 1, x0 + 1), y1 = Math.min(res - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = h[y0 * res + x0], b = h[y0 * res + x1], c = h[y1 * res + x0], d = h[y1 * res + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function smooth(h, res, passes = 1) {
  let src = h;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(src.length);
    for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
      let s = 0, c = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= res || zz >= res) continue;
        const w = (dx === 0 && dz === 0) ? 4 : (dx === 0 || dz === 0) ? 2 : 1;
        s += src[zz * res + xx] * w; c += w;
      }
      out[z * res + x] = s / c;
    }
    src = out;
  }
  h.set(src);
  return h;
}

// Hydraulic droplet erosion
export function erode(h, res, drops = 25000, seed = 7) {
  const rnd = makeRng(seed);
  const inertia = 0.05, capacityK = 4, deposit = 0.3, erodeK = 0.3, evap = 0.02, gravity = 4, minSlope = 0.01;
  const radius = 2;
  const heightGrad = (px, pz) => {
    const x = Math.floor(px), z = Math.floor(pz);
    const fx = px - x, fz = pz - z;
    const i = z * res + x;
    const nw = h[i], ne = h[i + 1], sw = h[i + res], se = h[i + res + 1];
    return {
      gx: (ne - nw) * (1 - fz) + (se - sw) * fz,
      gz: (sw - nw) * (1 - fx) + (se - ne) * fx,
      h: nw * (1 - fx) * (1 - fz) + ne * fx * (1 - fz) + sw * (1 - fx) * fz + se * fx * fz,
    };
  };
  const scale = 1 / res * 40; // height units per cell
  for (let d = 0; d < drops; d++) {
    let px = rnd() * (res - 2), pz = rnd() * (res - 2);
    let dx = 0, dz = 0, speed = 1, water = 1, sed = 0;
    for (let life = 0; life < 40; life++) {
      const nx = Math.floor(px), nz = Math.floor(pz);
      const fx = px - nx, fz = pz - nz;
      const g = heightGrad(px, pz);
      dx = dx * inertia - g.gx * (1 - inertia);
      dz = dz * inertia - g.gz * (1 - inertia);
      const len = Math.hypot(dx, dz);
      if (len < 1e-8) break;
      dx /= len; dz /= len;
      px += dx; pz += dz;
      if (px < 0 || pz < 0 || px >= res - 2 || pz >= res - 2) break;
      const nh = heightGrad(px, pz).h;
      const dh = (nh - g.h) / scale;
      const cap = Math.max(-dh, minSlope) * speed * water * capacityK;
      const i = nz * res + nx;
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * deposit;
        sed -= amt;
        const a = amt * scale;
        h[i] += a * (1 - fx) * (1 - fz); h[i + 1] += a * fx * (1 - fz);
        h[i + res] += a * (1 - fx) * fz; h[i + res + 1] += a * fx * fz;
      } else {
        const amt = Math.min((cap - sed) * erodeK, -dh) * scale;
        let wsum = 0;
        for (let oz = -radius; oz <= radius; oz++) for (let ox = -radius; ox <= radius; ox++) {
          const xx = nx + ox, zz = nz + oz;
          if (xx < 0 || zz < 0 || xx >= res || zz >= res) continue;
          wsum += Math.max(0, radius - Math.hypot(ox, oz));
        }
        for (let oz = -radius; oz <= radius; oz++) for (let ox = -radius; ox <= radius; ox++) {
          const xx = nx + ox, zz = nz + oz;
          if (xx < 0 || zz < 0 || xx >= res || zz >= res) continue;
          const w = Math.max(0, radius - Math.hypot(ox, oz)) / wsum;
          const j = zz * res + xx;
          const take = Math.min(h[j], amt * w);
          h[j] -= take;
        }
        sed += amt / scale;
      }
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      water *= 1 - evap;
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, Math.max(0, h[i]));
  return h;
}

export const OPS = {
  erode: { label: 'Erode', hint: 'Run rainfall erosion: carves gullies and fans' },
  smooth: { label: 'Smooth', hint: 'Soften the terrain' },
  raise: { label: 'Raise', hint: 'Raise the whole terrain' },
  lower: { label: 'Lower', hint: 'Lower the whole terrain' },
  sharpen: { label: 'Spikes', hint: 'Exaggerate peaks' },
  plateau: { label: 'Plateau', hint: 'Flatten the tops into plateaus' },
  invert: { label: 'Invert', hint: 'Turn mountains into canyons' },
  noise: { label: 'Rough', hint: 'Add fine rocky detail' },
  stretch: { label: 'Equalize', hint: 'Stretch heights to the full range' },
};

export function applyOp(op, h, res) {
  switch (op) {
    case 'erode': erode(h, res, Math.round(res * res * 1.4), Math.floor(Math.random() * 1e6)); break;
    case 'smooth': smooth(h, res, 2); break;
    case 'raise': for (let i = 0; i < h.length; i++) h[i] = Math.min(1, h[i] + 0.05); break;
    case 'lower': for (let i = 0; i < h.length; i++) h[i] = Math.max(0, h[i] - 0.05); break;
    case 'sharpen': for (let i = 0; i < h.length; i++) h[i] = Math.pow(h[i], 1.35); break;
    case 'plateau': for (let i = 0; i < h.length; i++) h[i] = Math.min(h[i], 0.7) / 0.7 * 0.85 + Math.max(0, h[i] - 0.7) * 0.15; break;
    case 'invert': for (let i = 0; i < h.length; i++) h[i] = 1 - h[i]; edgeFalloff(h, res, 1); break;
    case 'noise': {
      const n = makeNoise2(Math.floor(Math.random() * 1e6));
      for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
        const i = z * res + x;
        h[i] = Math.min(1, Math.max(0, h[i] + (n(x * 0.35, z * 0.35) - 0.5) * 0.04 * (0.3 + h[i])));
      }
      break;
    }
    case 'stretch': normalize(h); break;
  }
  return h;
}

export function brush(h, res, cx, cz, radius, strength, mode) {
  const r = radius * res;
  const x0 = Math.max(0, Math.floor(cx * res - r)), x1 = Math.min(res - 1, Math.ceil(cx * res + r));
  const z0 = Math.max(0, Math.floor(cz * res - r)), z1 = Math.min(res - 1, Math.ceil(cz * res + r));
  let avg = 0, cnt = 0;
  if (mode === 'smooth' || mode === 'flatten') {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { avg += h[z * res + x]; cnt++; }
    avg /= cnt || 1;
  }
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x + 0.5 - cx * res, z + 0.5 - cz * res) / r;
    if (d > 1) continue;
    const w = Math.pow(1 - d * d, 2) * strength;
    const i = z * res + x;
    if (mode === 'raise') h[i] = Math.min(1, h[i] + w * 0.04);
    else if (mode === 'lower') h[i] = Math.max(0, h[i] - w * 0.04);
    else h[i] = h[i] + (avg - h[i]) * w * 0.5;
  }
}
