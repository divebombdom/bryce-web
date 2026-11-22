// Generates the ray-tracing fragment shader for a given scene layout.

export const VERT = /* glsl */`
void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COMMON = /* glsl */`
layout(location = 0) out highp vec4 outColor;
uniform vec2 uRes;
uniform vec2 uJitter;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform float uTanFov;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uAmb;
uniform vec3 uHazeCol;
uniform vec3 uFogCol;
uniform vec3 uCloudCol;
uniform float uHaze;
uniform float uFog;
uniform float uFogH;
uniform float uShadow;
uniform float uClouds;
uniform float uCloudH;
uniform float uCloudFreq;
uniform float uStars;
uniform float uExposure;
uniform int uBounces;
uniform int uSteps;
uniform int uAO;
uniform int uSkyOnly;
uniform sampler2D uPrev;
uniform float uBlend;

float hash3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float hash2(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x+p3.y)*p3.z); }
float noise3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float noise2(vec2 x){
  vec2 i = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(hash2(i), hash2(i+vec2(1,0)), f.x), mix(hash2(i+vec2(0,1)), hash2(i+vec2(1,1)), f.x), f.y);
}
float fbm3(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*noise3(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s/0.96875; }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<6;i++){ s += a*noise2(p); p = mat2(1.6,1.2,-1.2,1.6)*p + vec2(3.1,7.7); a *= 0.5; } return s/0.984; }

float dot2(vec2 v){ return dot(v,v); }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0); }
float sdCyl(vec3 p){ vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(1.0,1.0); return min(max(d.x,d.y),0.0) + length(max(d,0.0)); }
float sdCone(vec3 p){
  float h = 1.0, r1 = 1.0, r2 = 0.0;
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(r2,h); vec2 k2 = vec2(r2-r1, 2.0*h);
  vec2 ca = vec2(q.x - min(q.x, (q.y<0.0)?r1:r2), abs(q.y)-h);
  vec2 cb = q - k1 + k2*clamp(dot(k1-q,k2)/dot2(k2), 0.0, 1.0);
  float s = (cb.x<0.0 && ca.y<0.0) ? -1.0 : 1.0;
  return s*sqrt(min(dot2(ca), dot2(cb)));
}
float sdPyr0(vec3 p, float h){
  float m2 = h*h + 0.25;
  p.xz = abs(p.xz);
  p.xz = (p.z>p.x) ? p.zx : p.xz;
  p.xz -= 0.5;
  vec3 q = vec3(p.z, h*p.y - 0.5*p.x, h*p.x + 0.5*p.y);
  float s = max(-q.x, 0.0);
  float t = clamp((q.y - 0.5*p.z)/(m2 + 0.25), 0.0, 1.0);
  float a = m2*(q.x+s)*(q.x+s) + q.y*q.y;
  float b = m2*(q.x+0.5*t)*(q.x+0.5*t) + (q.y-m2*t)*(q.y-m2*t);
  float d2 = min(q.y, -q.x*m2 - q.y*0.5) > 0.0 ? 0.0 : min(a,b);
  return sqrt((d2 + q.z*q.z)/m2) * sign(max(q.z, -p.y));
}
float sdPyramid(vec3 p){ return sdPyr0(vec3(p.x*0.5, (p.y+1.0)*0.5, p.z*0.5), 1.0)*2.0; }
float sdTorus(vec3 p){ vec2 t = vec2(length(p.xz) - 0.72, p.y); return length(t) - 0.28; }
float stoneShape(vec3 n, float seed){
  float a = seed*1.731, b = seed*0.917, c = seed*2.313;
  return 0.16*sin(3.1*n.x + a)*sin(2.7*n.y + b)*sin(3.3*n.z + c)
       + 0.08*sin(6.3*n.x + c)*sin(5.9*n.z + a)*sin(6.7*n.y + b)
       + 0.10*n.y;
}
float sdStone(vec3 p, float seed){
  float l = length(p);
  vec3 n = p/max(l,1e-4);
  return (l - (0.86 + stoneShape(n, seed)))*0.75;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
`;

export function sceneKey(objects) {
  return objects.filter(o => !o.hidden).map(o => o.type).join(',');
}

export function buildFragment(objects) {
  const vis = objects.filter(o => !o.hidden);
  const N = Math.max(1, vis.length);
  const terrains = [];
  let mapCode = '';
  let planeCode = '';
  let cloudCode = '';
  vis.forEach((o, i) => {
    const q = `(uInv[${i}]*vec4(p,1.0)).xyz`;
    let call = null;
    switch (o.type) {
      case 'sphere': call = `(length(q)-1.0)`; break;
      case 'cube': call = `sdBox(q, vec3(1.0))`; break;
      case 'cylinder': case 'disk': call = `sdCyl(q)`; break;
      case 'cone': call = `sdCone(q)`; break;
      case 'pyramid': call = `sdPyramid(q)`; break;
      case 'torus': call = `sdTorus(q)`; break;
      case 'stone': call = `sdStone(q, uMC[${i}].z)`; break;
      case 'terrain': {
        const k = terrains.length; terrains.push(i);
        call = null;
        mapCode += `  { vec3 q = ${q}; float t = sdTerrain(q, uScl[${i}], uT${k}, uTres[${k}]); if(t < d){ d = t; id = ${i}.0; } }\n`;
        break;
      }
      case 'ground': case 'water':
        planeCode += `  { float t = (uPY[${i}] - ro.y)/rd.y; if(t > 0.002 && t < best.x){ best = vec2(t, ${i}.0); } }\n`;
        break;
      case 'cloud':
        cloudCode += `  col = cloudLayer(col, ro, rd, uPY[${i}], uC1[${i}].rgb, uC2[${i}].rgb, uMA[${i}].y);\n`;
        break;
    }
    if (call) mapCode += `  { vec3 q = ${q}; float t = ${call}*uMS[${i}]; if(t < d){ d = t; id = ${i}.0; } }\n`;
  });

  const terrDecl = terrains.map((_, k) => `uniform sampler2D uT${k};`).join('\n');
  const tresDecl = terrains.length ? `uniform float uTres[${terrains.length}];` : '';

  return /* glsl */`
${COMMON}
#define N ${N}
uniform mat4 uInv[N];
uniform vec3 uScl[N];
uniform float uMS[N];
uniform float uPY[N];
uniform vec4 uC1[N];
uniform vec4 uC2[N];
uniform vec4 uMA[N]; // tex, scale, bump, spec
uniform vec4 uMB[N]; // refl, transp, ior, emit
uniform vec4 uMC[N]; // metal, isPlane, seed, isTerrain
${terrDecl}
${tresDecl}

float sdTerrain(vec3 q, vec3 s, sampler2D tex, float res){
  float ms = min(s.x, min(s.y, s.z));
  float db = sdBox(q - vec3(0.0,0.5,0.0), vec3(1.0,0.5,1.0));
  if(db > 0.05) return db*ms;
  vec2 uv = q.xz*0.5 + 0.5;
  float e = 1.0/res;
  float h = texture(tex, uv).r;
  float hx = texture(tex, uv + vec2(e,0.0)).r - h;
  float hz = texture(tex, uv + vec2(0.0,e)).r - h;
  vec2 g = vec2(hx/(2.0*e)*s.y/s.x, hz/(2.0*e)*s.y/s.z);
  float dv = (q.y - h)*s.y/sqrt(1.0 + dot(g,g));
  return max(db*ms, dv*0.75);
}

vec2 map(vec3 p){
  float d = 1e9; float id = -1.0;
${mapCode}
  return vec2(d, id);
}

vec2 hitPlanes(vec3 ro, vec3 rd){
  vec2 best = vec2(1e9, -1.0);
  if(abs(rd.y) < 1e-6) return best;
${planeCode}
  return best;
}

vec2 march(vec3 ro, vec3 rd, float tmax, float side){
  float t = 0.0;
  for(int i=0;i<400;i++){
    if(i >= uSteps) break;
    vec3 p = ro + rd*t;
    vec2 h = map(p);
    float d = h.x*side;
    if(d < 0.0006*max(1.0,t)) return vec2(t, h.y);
    t += d;
    if(t > tmax) break;
  }
  return vec2(-1.0);
}

vec3 calcNormal(vec3 p, float t){
  float e = 0.0008*max(1.0, t*0.5);
  vec2 k = vec2(1.0,-1.0);
  return normalize(k.xyy*map(p + k.xyy*e).x + k.yyx*map(p + k.yyx*e).x + k.yxy*map(p + k.yxy*e).x + k.xxx*map(p + k.xxx*e).x);
}

float softShadow(vec3 ro, vec3 rd){
  float res = 1.0; float t = 0.02;
  for(int i=0;i<96;i++){
    if(i*2 >= uSteps) break;
    float h = map(ro + rd*t).x;
    res = min(res, 14.0*h/t);
    t += clamp(h, 0.03, 6.0);
    if(res < 0.002 || t > 220.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n){
  float occ = 0.0, sca = 1.0;
  for(int i=0;i<5;i++){
    float h = 0.03 + 0.25*float(i);
    float d = map(p + n*h).x;
    occ += (h - d)*sca; sca *= 0.7;
  }
  return clamp(1.0 - 1.2*occ, 0.0, 1.0);
}

float cloudDensity(vec2 xz, float freq, float cover){
  float f = fbm2(xz*0.0035*freq + vec2(11.0, 3.0));
  return smoothstep(1.0 - cover, 1.0 - cover + 0.38, f);
}

vec3 cloudLayer(vec3 col, vec3 ro, vec3 rd, float h, vec3 lit, vec3 shade, float freq){
  if(uClouds <= 0.0) return col;
  float t = (h - ro.y)/rd.y;
  if(t <= 0.0 || abs(rd.y) < 1e-4) return col;
  vec3 p = ro + rd*t;
  float d = cloudDensity(p.xz, freq, uClouds);
  if(d <= 0.0) return col;
  float d2 = cloudDensity(p.xz + uSunDir.xz*25.0, freq, uClouds);
  float lightness = clamp(1.0 - (d2 - d)*1.8, 0.25, 1.25);
  float sunF = pow(max(dot(rd, uSunDir),0.0), 6.0);
  vec3 c = mix(shade*uAmb*1.6, lit*(uSunCol*0.85 + uAmb*0.6), lightness*0.75) + uSunCol*sunF*0.45*(1.0-d);
  float fade = exp(-t*0.00025);
  return mix(col, c, d*fade*0.95);
}

vec3 sky(vec3 ro, vec3 rd){
  float y = rd.y;
  vec3 col;
  if(y > 0.0){
    col = mix(uHorizon, uZenith, pow(y, 0.45));
  } else {
    col = uHorizon*mix(1.0, 0.55, clamp(-y*3.0, 0.0, 1.0));
  }
  float sd = max(dot(rd, uSunDir), 0.0);
  col += uSunCol*(pow(sd, 6.0)*0.25 + pow(sd, 64.0)*0.35)*(0.4 + uHaze);
  col = mix(col, uHazeCol, uHaze*0.5*exp(-max(y,0.0)*8.0));
  if(uStars > 0.0 && y > 0.0){
    vec3 sp = floor(rd*420.0);
    float st = step(0.9975, hash3(sp));
    col += vec3(st*uStars*(0.5 + hash3(sp+1.3)))*smoothstep(0.0, 0.25, y);
  }
  float disc = smoothstep(0.9993, 0.99965, sd);
  col += uSunCol*disc*8.0;
  if(y > 0.0){
    col = cloudLayer(col, ro, rd, uCloudH, uCloudCol, uCloudCol*0.55, uCloudFreq);
${cloudCode}
  }
  return col;
}

void atmos(vec3 ro, vec3 rd, float t, out float f, out vec3 fc){
  float sd = pow(max(dot(rd, uSunDir), 0.0), 8.0);
  vec3 hc = mix(uHazeCol, uSunCol, sd*0.4);
  float fh = 1.0 - exp(-t*uHaze*uHaze*0.0035);
  float b = 0.18;
  float ry = abs(rd.y) < 1e-3 ? 1e-3 : rd.y;
  float fogAmt = uFog*0.6*exp(-(ro.y - uFogH)*b)*(1.0 - exp(-t*ry*b))/ry;
  float ff = 1.0 - exp(-max(fogAmt, 0.0));
  f = 1.0 - (1.0 - fh)*(1.0 - ff);
  fc = (hc*fh + uFogCol*ff*(1.0 + uSunCol*0.0))/max(fh + ff, 1e-4);
}

vec3 albedo(int i, vec3 pl, vec3 pt, vec3 pw, vec3 n, out float emitMask){
  int tex = int(uMA[i].x + 0.5);
  float sc = uMA[i].y;
  vec3 c1 = uC1[i].rgb, c2 = uC2[i].rgb;
  emitMask = 0.0;
  if(tex == 1){
    float s = 2.0/max(sc, 0.01);
    vec3 cc = floor(pt/s + 1e-3);
    float k = mod(cc.x + cc.y + cc.z, 2.0);
    if(uMC[i].y > 0.5) k = mod(cc.x + cc.z, 2.0);
    return mix(c1, c2, k);
  }
  if(tex == 2){
    float f = fbm3(pt*sc*0.6);
    float g = noise3(pt*sc*6.0);
    return mix(c1, c2, smoothstep(0.3, 0.75, f))*(0.82 + 0.3*g);
  }
  if(tex == 3){
    float h = clamp(pl.y, 0.0, 1.0);
    float nn = fbm3(pt*0.25*sc);
    float slope = 1.0 - n.y;
    vec3 grass = c1*(0.8 + 0.4*noise3(pt*0.7));
    vec3 rock = c2*(0.75 + 0.5*fbm3(pt*sc*1.3));
    rock *= 0.85 + 0.15*sin(pw.y*3.0 + nn*6.0);
    vec3 col = mix(grass, rock, smoothstep(0.18, 0.45, h + (nn-0.5)*0.25));
    col = mix(col, rock, smoothstep(0.28, 0.5, slope));
    float snow = smoothstep(0.58, 0.68, h + (nn - 0.5)*0.22) * (1.0 - smoothstep(0.42, 0.62, slope));
    return mix(col, vec3(0.93, 0.95, 1.0), snow);
  }
  if(tex == 4){
    float v = sin(pt.x*sc*1.5 + fbm3(pt*sc*0.9)*7.0);
    return mix(c2, c1, pow(abs(v), 0.35));
  }
  if(tex == 5){
    float r = length(pt.xz)*sc*4.0 + fbm3(pt*sc*vec3(0.5,3.0,0.5))*2.0;
    return mix(c1, c2, smoothstep(0.2, 0.8, fract(r)))*(0.9 + 0.2*noise3(pt*vec3(30.0,1.0,30.0)));
  }
  if(tex == 6){
    vec3 d = normalize(pl);
    float f = fbm3(d*2.2*sc + 3.0);
    vec3 land = mix(c2, vec3(0.55,0.45,0.3), smoothstep(0.55, 0.7, f));
    vec3 col = f > 0.5 ? land : c1*(0.8 + 0.4*f);
    float ice = smoothstep(0.78, 0.86, abs(d.y) + (f-0.5)*0.2);
    col = mix(col, vec3(0.95), ice);
    float cl = smoothstep(0.55, 0.75, fbm3(d*4.0 + 17.0));
    return mix(col, vec3(1.0), cl*0.8);
  }
  if(tex == 7){
    float f = fbm3(pt*sc*1.1);
    float crack = 1.0 - smoothstep(0.02, 0.08, abs(f - 0.5));
    float hot = smoothstep(0.62, 0.8, fbm3(pt*sc*0.45 + 5.0));
    emitMask = max(crack, hot*0.8);
    return mix(c1*(0.7 + 0.6*noise3(pt*3.0)), c2, emitMask);
  }
  if(tex == 8){
    float y = pw.y*sc*0.9 + fbm3(pt*0.15*sc)*1.6;
    float b = 0.5 + 0.5*sin(y*2.1) * sin(y*0.73 + 1.0);
    vec3 col = mix(c1, c2, b);
    return col*(0.85 + 0.25*noise3(pt*vec3(4.0, 12.0, 4.0)));
  }
  if(tex == 9){
    vec3 g = abs(fract(pt*sc*0.5) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.05, min(min(g.x, g.z), uMC[i].y > 0.5 ? 1.0 : g.y));
    emitMask = line;
    return mix(c1, c2, line);
  }
  if(tex == 10){
    float f = fbm3(pt*sc*0.7);
    return mix(c2, c1, smoothstep(0.35, 0.7, f));
  }
  return c1;
}

vec3 bumpNormal(vec3 n, vec3 pt, float amt, float sc, bool plane, float dist){
  amt /= 1.0 + dist*(plane ? 0.035 : 0.01);
  if(amt <= 0.002) return n;
  float e = 0.05/max(sc, 0.1);
  vec3 q = pt*sc;
  if(plane){
    vec2 w = q.xz*0.9;
    float ew = 0.03;
    float h0 = noise2(w) + 0.5*noise2(w*2.3 + 4.0) + 0.25*noise2(w*5.1 + 9.0);
    float hx = noise2(w + vec2(ew,0.0)) + 0.5*noise2((w + vec2(ew,0.0))*2.3 + 4.0) + 0.25*noise2((w + vec2(ew,0.0))*5.1 + 9.0) - h0;
    float hz = noise2(w + vec2(0.0,ew)) + 0.5*noise2((w + vec2(0.0,ew))*2.3 + 4.0) + 0.25*noise2((w + vec2(0.0,ew))*5.1 + 9.0) - h0;
    return normalize(n - vec3(hx, 0.0, hz)/ew*amt*0.18);
  }
  float h0 = noise3(q*2.0);
  vec3 g = vec3(noise3(q*2.0 + vec3(e,0,0)) - h0, noise3(q*2.0 + vec3(0,e,0)) - h0, noise3(q*2.0 + vec3(0,0,e)) - h0)/e;
  g += 0.5*vec3(noise3(q*7.0 + vec3(e,0,0)) - noise3(q*7.0), noise3(q*7.0 + vec3(0,e,0)) - noise3(q*7.0), noise3(q*7.0 + vec3(0,0,e)) - noise3(q*7.0))/e;
  return normalize(n - (g - n*dot(g,n))*amt*0.12);
}

vec3 trace(vec3 ro, vec3 rd){
  vec3 col = vec3(0.0);
  vec3 thr = vec3(1.0);
  float side = 1.0;
  if(uSkyOnly == 1) return sky(ro, rd);
  for(int b=0;b<6;b++){
    if(b >= uBounces) break;
    vec2 ph = hitPlanes(ro, rd);
    float tmax = ph.y >= 0.0 ? ph.x : 3000.0;
    vec2 h = march(ro, rd, tmax, side);
    float t; int i; bool isPlane = false;
    if(h.y >= 0.0){ t = h.x; i = int(h.y + 0.5); }
    else if(ph.y >= 0.0){ t = ph.x; i = int(ph.y + 0.5); isPlane = true; }
    else {
      vec3 s = sky(ro, rd);
      float f; vec3 fc; atmos(ro, rd, 2500.0, f, fc);
      if(rd.y > 0.0) f *= 0.35 + 0.65*exp(-rd.y*6.0);
      col += thr*mix(s, fc, f);
      break;
    }
    vec3 p = ro + rd*t;
    vec3 pl = (uInv[i]*vec4(p,1.0)).xyz;
    vec3 pt = pl*uScl[i];
    vec3 n;
    if(isPlane){ n = vec3(0.0, rd.y < 0.0 ? 1.0 : -1.0, 0.0); }
    else { n = calcNormal(p, t)*side; }
    vec3 ng = n;
    float sc = uMA[i].y;
    n = bumpNormal(n, pt, uMA[i].z, sc, isPlane, t);
    float em;
    vec3 alb = albedo(i, pl, pt, p, ng, em);
    float spec = uMA[i].w;
    float refl = uMB[i].x, transp = uMB[i].y, ior = uMB[i].z, emit = uMB[i].w;
    float metal = uMC[i].x;

    // lighting
    vec3 L = uSunDir;
    float ndl = max(dot(n, L), 0.0);
    float sh = 1.0;
    vec3 po = p + ng*0.004*max(1.0, t*0.02);
    if(ndl > 0.0 && uShadow > 0.0){
      sh = softShadow(po, L);
      if(uClouds > 0.0 && L.y > 0.0){
        float tc = (uCloudH - p.y)/L.y;
        vec3 cp = p + L*tc;
        sh *= 1.0 - 0.6*cloudDensity(cp.xz, uCloudFreq, uClouds);
      }
      sh = mix(1.0, sh, uShadow);
    }
    float ao = (uAO == 1 && !isPlane) ? calcAO(p, ng) : (uAO == 1 ? mix(0.55, 1.0, calcAO(p, ng)) : 1.0);
    vec3 amb = uAmb*(0.65 + 0.35*n.y) + uHorizon*0.12*(1.0 - n.y)*0.5;
    vec3 diff = alb*(uSunCol*ndl*sh + amb*ao);
    vec3 hv = normalize(L - rd);
    float sp = pow(max(dot(n, hv), 0.0), 8.0 + spec*120.0)*spec*sh*(ndl > 0.0 ? 1.0 : 0.0);
    vec3 specC = uSunCol*sp*mix(vec3(1.0), alb, metal)*1.4;

    float cosi = clamp(-dot(rd, n), 0.0, 1.0);
    float fres = pow(1.0 - cosi, 5.0);
    float kr = refl > 0.0 ? clamp(refl + (1.0 - refl)*fres*0.9, 0.0, 1.0) : 0.0;
    float kt = transp*(1.0 - kr);
    vec3 local = diff*(1.0 - kr)*(1.0 - kt) + specC + alb*emit*em*(em > 0.0 ? 1.0 : 0.0);
    if(int(uMA[i].x + 0.5) != 7 && int(uMA[i].x + 0.5) != 9) local += alb*emit;

    float f; vec3 fc; atmos(ro, rd, t, f, fc);
    col += thr*mix(local, fc, f);
    thr *= (1.0 - f);

    if(kt > 0.01){
      float eta = side > 0.0 ? 1.0/ior : ior;
      vec3 rr = refract(rd, n, eta);
      col += thr*kr*sky(p, reflect(rd, n))*mix(vec3(1.0), alb, metal);
      if(dot(rr, rr) < 1e-4){ rd = reflect(rd, n); ro = p + ng*0.004; thr *= kt; continue; }
      thr *= kt*mix(vec3(1.0), alb, 0.6);
      rd = rr;
      ro = p - ng*0.006*max(1.0, t*0.01);
      if(!isPlane) side = -side;
    } else if(kr > 0.01){
      thr *= kr*mix(vec3(1.0), alb, metal);
      rd = reflect(rd, n);
      if(isPlane && rd.y < 0.0) rd.y = -rd.y;
      ro = p + ng*0.004*max(1.0, t*0.02);
    } else break;
    if(max(thr.x, max(thr.y, thr.z)) < 0.02) break;
  }
  return col;
}

void main(){
  vec2 fc = gl_FragCoord.xy - 0.5 + uJitter;
  vec2 ndc = (fc/uRes)*2.0 - 1.0;
  float aspect = uRes.x/uRes.y;
  vec3 rd = normalize(uCamRot*vec3(ndc.x*uTanFov*aspect, ndc.y*uTanFov, -1.0));
  vec3 c = trace(uCamPos, rd)*uExposure;
  c = aces(c*0.95);
  c = pow(c, vec3(1.0/2.2));
  c += (hash2(gl_FragCoord.xy + uJitter*91.0) - 0.5)/255.0;
  vec4 outc = vec4(c, 1.0);
  if(uBlend < 1.0){
    vec4 prev = texelFetch(uPrev, ivec2(gl_FragCoord.xy), 0);
    outc = mix(prev, outc, uBlend);
  }
  outColor = outc;
}
`;
}

export const DISPLAY_FRAG = /* glsl */`
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tPrev;
uniform sampler2D tCur;
uniform float uSplit;
uniform int uHasPrev;
uniform vec2 uView;
uniform float uDim;
void main(){
  vec2 uv = gl_FragCoord.xy/uView;
  vec4 c;
  if(uv.y > 1.0 - uSplit) c = texture(tCur, uv);
  else if(uHasPrev == 1) c = texture(tPrev, uv);
  else c = vec4(0.18, 0.18, 0.19, 1.0);
  c.rgb *= uDim;
  outColor = vec4(c.rgb, 1.0);
}
`;
