import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  KeyboardControls,
  useKeyboardControls,
  Instances,
  Instance,
  Sparkles,
  Grid
} from '@react-three/drei';
import { a, useSpring } from '@react-spring/three';
import { useDrag } from '@use-gesture/react';
import { BufferGeometryUtils, RoundedBoxGeometry } from 'three-stdlib';

/**
 * GardenPets.jsx — “Garden Pets” (Zen Garden + high-tier creatures)
 *
 * Mobile-first guardrails:
 * - No external models/textures.
 * - No real-time shadows (blob shadow only).
 * - No postprocessing.
 * - No physics engines.
 * - Low poly (segments kept small).
 * - Shared geometry + materials cached.
 * - Heart particles are an instanced pool (max 50).
 *
 * Tweakables:
 *   SOCIAL_DISTANCE: how close pets must be to greet
 *   SOCIAL_COOLDOWN_S: seconds before the same pair can greet again
 *   SOCIAL_CHECK_EVERY_FRAMES: how often to run proximity checks
 *
 * Personality rarity knobs are in PERSONALITY.
 */

// ---- Garden bounds (keeps pets + camera contained)
const ROOM_BOUNDS = { minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 };

// ---- Social tuning (Proxemics)
const SOCIAL_DISTANCE = 2.0;
const SOCIAL_COOLDOWN_S = 10;
const SOCIAL_CHECK_EVERY_FRAMES = 30;

// ---- Personality rarity knobs
const PERSONALITY = {
  curiosityChancePerS: 0.11,
  curiosityDuration: [1.2, 2.2],
  restChancePerS: 0.10,
  restDuration: [2.6, 4.8],
  restAfterWalkS: 10,
  chaseChancePerS: 0.04,
  chaseDuration: [3.8, 5.2],
  sleepAfterNoInteractS: 22
};

const LS_KEY = 'mindPalace:gardenPets:v1';

// -----------------------------
// Utilities
// -----------------------------

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function dampAngle(a, b, t) {
  let d = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}
function randRange(a, b) {
  return lerp(a, b, Math.random());
}
function randId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function safeLoadPets() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function safeSavePets(pets) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(pets));
  } catch {
    // ignore
  }
}

function hash1(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}
function smoothstep(t) {
  return t * t * (3 - 2 * t);
}
function noise1D(x, seed) {
  const i0 = Math.floor(x);
  const i1 = i0 + 1;
  const t = smoothstep(x - i0);
  const a = hash1(i0 * 127.1 + seed * 311.7);
  const b = hash1(i1 * 127.1 + seed * 311.7);
  return lerp(a, b, t) * 2 - 1;
}

function useIsMobile() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 720;
  }, []);
}

// -----------------------------
// Procedural tiny textures
// -----------------------------

function useToonRampTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 3;
    c.height = 1;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(3, 1);
    const vals = [70, 160, 255];
    for (let i = 0; i < 3; i++) {
      const v = vals[i];
      img.data[i * 4 + 0] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

function useBlobShadowTexture() {
  return useMemo(() => {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.60, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

// -----------------------------
// Eye shader (procedural SDF)
// -----------------------------

function createEyeShaderMaterial() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBlink: { value: 0.0 },
      uHappy: { value: 0.0 },
      uWide: { value: 0.0 },
      uLook: { value: new THREE.Vector2(0, 0) },
      uInk: { value: new THREE.Color(0x1b1b2d) },
      uOpacity: { value: 1.0 }
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;

      uniform float uBlink;
      uniform float uHappy;
      uniform float uWide;
      uniform vec2 uLook;
      uniform vec3 uInk;
      uniform float uOpacity;

      float sdCircle(vec2 p, float r){ return length(p) - r; }

      // Soft arc eye: distance to a parabola band.
      float sdHappyArc(vec2 p){
        float a = 1.7;
        float b = -0.05;
        float y = a * (p.x*p.x) + b;
        float d = abs(p.y - y);
        float end = smoothstep(0.18, 0.28, abs(p.x));
        return d + end*0.12;
      }

      float eyeMask(vec2 p){
        float blink = clamp(uBlink, 0.0, 1.0);
        float blinkScale = mix(1.0, 0.06, blink);
        p.y /= blinkScale;

        float wide = clamp(uWide, 0.0, 1.0);
        float r = mix(0.105, 0.135, wide);

        float roundD = sdCircle(p, r);
        float happyD = sdHappyArc(p);
        float d = mix(roundD, happyD, clamp(uHappy, 0.0, 1.0));

        float aa = fwidth(d) * 1.4;
        float alpha = 1.0 - smoothstep(0.0, aa, d);
        return alpha;
      }

      void main(){
        vec2 uv = vUv * 2.0 - 1.0;
        vec2 leftC = vec2(-0.35, 0.05);
        vec2 rightC = vec2(0.35, 0.05);

        float leftA = eyeMask(uv - leftC);
        float rightA = eyeMask(uv - rightC);

        float pupilOn = (1.0 - smoothstep(0.55, 0.90, uHappy)) * (1.0 - smoothstep(0.35, 0.85, uBlink));
        vec2 look = clamp(uLook, vec2(-1.0), vec2(1.0)) * 0.08;

        float pL = 1.0 - smoothstep(0.0, fwidth(sdCircle(uv - leftC - look, 0.045))*2.0, sdCircle(uv - leftC - look, 0.045));
        float pR = 1.0 - smoothstep(0.0, fwidth(sdCircle(uv - rightC - look, 0.045))*2.0, sdCircle(uv - rightC - look, 0.045));

        float inkA = max(leftA, rightA);
        float pupilA = max(pL, pR) * pupilOn;

        float a = max(inkA, pupilA);
        if (a < 0.01) discard;
        gl_FragColor = vec4(uInk, a * uOpacity);
      }
    `
  });
  mat.blending = THREE.NormalBlending;
  return mat;
}

// -----------------------------
// Heart particles (instanced pool=50)
// -----------------------------

function createHeartMaterial() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xff6aa8) },
      uOpacity: { value: 1.0 }
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform vec3 uColor;
      uniform float uOpacity;

      float sdHeart(vec2 p){
        p.x *= 1.1;
        p.y += 0.15;
        float a = atan(p.x, p.y)/3.141593;
        float r = length(p);
        float h = abs(a);
        float d = r - (0.55 - 0.25*h);
        d = max(d, p.y + 0.35);
        return d;
      }

      void main(){
        vec2 p = (vUv * 2.0 - 1.0);
        p.y *= 1.1;
        float d = sdHeart(p);
        float aa = fwidth(d) * 2.0;
        float a = 1.0 - smoothstep(0.0, aa, d);
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a * uOpacity);
      }
    `
  });
  mat.blending = THREE.AdditiveBlending;
  return mat;
}

function HeartPool({ getEmitterRef }) {
  const meshRef = useRef();
  const tmpObj = useMemo(() => new THREE.Object3D(), []);
  const hearts = useRef([]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.22, 0.22, 1, 1), []);
  const material = useMemo(() => createHeartMaterial(), []);

  useEffect(() => {
    hearts.current = new Array(50).fill(0).map(() => ({
      active: false,
      pos: new THREE.Vector3(0, -999, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 1,
      scale: 1
    }));
  }, []);

  const emit = useCallback((worldPos, n = 2) => {
    const arr = hearts.current;
    for (let k = 0; k < n; k++) {
      const i = arr.findIndex((h) => !h.active);
      if (i < 0) break;
      const h = arr[i];
      h.active = true;
      h.life = 0;
      h.maxLife = randRange(0.75, 1.25);
      h.pos.copy(worldPos);
      h.pos.y += randRange(0.45, 0.75);
      h.vel.set(randRange(-0.006, 0.006), randRange(0.010, 0.018), randRange(-0.006, 0.006));
      h.scale = randRange(0.8, 1.3);
    }
  }, []);

  useEffect(() => {
    getEmitterRef?.({ emit });
  }, [emit, getEmitterRef]);

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const arr = hearts.current;

    for (let i = 0; i < arr.length; i++) {
      const h = arr[i];
      if (!h.active) {
        tmpObj.position.set(0, -999, 0);
        tmpObj.scale.set(0.001, 0.001, 0.001);
        tmpObj.rotation.set(0, 0, 0);
        tmpObj.updateMatrix();
        meshRef.current.setMatrixAt(i, tmpObj.matrix);
        continue;
      }

      h.life += dt;
      const t = h.life / h.maxLife;
      if (t >= 1) {
        h.active = false;
        continue;
      }

      h.vel.y -= 0.002 * dt * 60;
      h.pos.addScaledVector(h.vel, dt * 60);

      const fade = 1.0 - smoothstep(clamp((t - 0.55) / 0.45, 0, 1));
      const s = h.scale * (0.9 + t * 0.3);

      tmpObj.position.copy(h.pos);
      tmpObj.scale.set(s, s, s);
      tmpObj.rotation.set(0, 0, Math.sin((i + t) * 7.0) * 0.25);
      tmpObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tmpObj.matrix);

      material.uniforms.uOpacity.value = 0.95 * fade;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, 50]} frustumCulled={false} />;
}

// -----------------------------
// Species roster
// -----------------------------

const SPECIES = {
  cat: { label: 'Cat', emoji: '🐱', scale: 1.0, ear: 'pointy', tail: 'long' },
  dog: { label: 'Dog', emoji: '🐶', scale: 1.0, ear: 'floppy', tail: 'short' },
  bunny: { label: 'Bunny', emoji: '🐰', scale: 1.0, ear: 'long', tail: 'pom' },
  tiger: { label: 'Tiger', emoji: '🐯', scale: 1.5, ear: 'pointy', tail: 'long', highTier: true },
  wolf: { label: 'Dire Wolf', emoji: '🐺', scale: 1.8, ear: 'sharp', tail: 'long', highTier: true },
  dragon: { label: 'Dragon', emoji: '🐲', scale: 2.2, ear: 'horn', tail: 'long', mythical: true, hover: true }
};

const NAMES = ['Mochi', 'Nova', 'Kumo', 'Yuzu', 'Hana', 'Sora', 'Miso', 'Kiki', 'Nori', 'Taro', 'Pip', 'Luna'];

function makePet(speciesKey = 'cat') {
  const sp = SPECIES[speciesKey] || SPECIES.cat;
  const cozy = {
    cat: [0xcdb4db, 0xbde0fe, 0xa2d2ff, 0xffc8dd],
    dog: [0xffd6a5, 0xfec89a, 0xfde4cf, 0xcdeac0],
    bunny: [0xd0f4de, 0xa9def9, 0xe4c1f9, 0xfcf6bd],
    tiger: [0xf4a261, 0xf6bd60, 0xfefae0],
    wolf: [0xb8c0c8, 0x7f8c99, 0xcfe9ff],
    dragon: [0x6ee7b7, 0x60a5fa, 0xa7f3d0]
  };

  const x = (Math.random() * 2 - 1) * 6.8;
  const z = (Math.random() * 2 - 1) * 6.8;

  return {
    id: randId(),
    name: pick(NAMES) + ' ' + ((Math.random() * 100) | 0),
    speciesKey,
    bodyColor: pick(cozy[speciesKey] || cozy.cat),
    position: [x, z],
    yaw: Math.random() * Math.PI * 2,
    seed: Math.random() * 10
  };
}

function defaultPets() {
  return [makePet('cat'), makePet('dog'), makePet('bunny')].map((p, i) => ({
    ...p,
    id: ['pet_a', 'pet_b', 'pet_c'][i],
    position: [[-2.0, 0.5], [2.1, -1.2], [0.2, 2.2]][i],
    yaw: [0, Math.PI, Math.PI * 0.5][i]
  }));
}

// -----------------------------
// Global geometry + material caches
// -----------------------------

const GEO_CACHE = new Map();
const MAT_CACHE = new Map();

function mergeGeos(list) {
  const merge = BufferGeometryUtils.mergeBufferGeometries || BufferGeometryUtils.mergeGeometries;
  if (!merge) return null;
  const out = merge(list, false);
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

function applyVertexColor(geo, hex) {
  const c = new THREE.Color(hex);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3 + 0] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function getToonMat(rampTex, hex, keyExtra = '') {
  const k = String(hex) + '|' + (keyExtra || '');
  const cached = MAT_CACHE.get(k);
  if (cached) return cached;
  const m = new THREE.MeshToonMaterial({
    color: new THREE.Color(hex),
    gradientMap: rampTex
  });
  m.dithering = true;
  MAT_CACHE.set(k, m);
  return m;
}

function getDetailMat(rampTex) {
  const k = 'detail|' + rampTex.uuid;
  const cached = MAT_CACHE.get(k);
  if (cached) return cached;
  const m = new THREE.MeshToonMaterial({
    color: 0xffffff,
    gradientMap: rampTex,
    vertexColors: true
  });
  m.dithering = true;
  MAT_CACHE.set(k, m);
  return m;
}

function getBlobMat(blobTex) {
  const k = 'blob|' + blobTex.uuid;
  const cached = MAT_CACHE.get(k);
  if (cached) return cached;
  const m = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.8, depthWrite: false });
  MAT_CACHE.set(k, m);
  return m;
}

// Dragon flap material patch (keeps MeshToonMaterial, adds aWing/aSide attributes)
function patchDragonFlapMaterial(mat) {
  if (mat.userData._flapPatched) return;
  mat.userData._flapPatched = true;
  mat.userData.uTime = { value: 0 };

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uTime;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute float aWing;\nattribute float aSide;\nuniform float uTime;\nmat2 rot2(float a){ float s = sin(a); float c = cos(a); return mat2(c,-s,s,c); }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>\nif(aWing > 0.5){\n  float side = aSide;\n  float ang = sin(uTime * 0.8 + side * 0.3) * 0.55;\n  objectNormal.xy = rot2(ang * side) * objectNormal.xy;\n}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nif(aWing > 0.5){\n  float side = aSide;\n  vec3 pivot = vec3(0.55 * side, 0.90, -0.20);\n  float ang = sin(uTime * 0.8 + side * 0.3) * 0.55;\n  transformed -= pivot;\n  transformed.xy = rot2(ang * side) * transformed.xy;\n  transformed += pivot;\n}`
      );

    mat.userData._shader = shader;
  };

  mat.needsUpdate = true;
}

function setWingAttributes(geo, wingFlag, sideVal) {
  const pos = geo.getAttribute('position');
  const aWing = new Float32Array(pos.count);
  const aSide = new Float32Array(pos.count);
  aWing.fill(wingFlag);
  aSide.fill(sideVal);
  geo.setAttribute('aWing', new THREE.BufferAttribute(aWing, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1));
  return geo;
}

function ensureWingAttrs(geo) {
  const pos = geo.getAttribute('position');
  if (!geo.getAttribute('aWing')) geo.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  if (!geo.getAttribute('aSide')) geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  return geo;
}

function getPetGeometries(speciesKey) {
  const key = speciesKey || 'cat';
  const cached = GEO_CACHE.get(key);
  if (cached) return cached;

  const sp = SPECIES[key] || SPECIES.cat;
  const seg = 2; // low-poly

  // Body merged
  const bodyParts = [];
  // Head merged (separate mesh for tilt)
  const headParts = [];
  // Details (vertex colors) merged
  const detailParts = [];

  // Shared dims
  const scale = sp.scale || 1;
  const body = new RoundedBoxGeometry(0.95 * scale, 0.66 * scale, 0.86 * scale, seg, 0.22 * scale);
  body.translate(0, 0.52 * scale, 0);
  bodyParts.push(body);

  // Paws
  const paw = new RoundedBoxGeometry(0.22 * scale, 0.14 * scale, 0.26 * scale, seg, 0.09 * scale);
  const pawPos = [
    [-0.30, 0.20, 0.24],
    [0.30, 0.20, 0.24],
    [-0.30, 0.20, -0.18],
    [0.30, 0.20, -0.18]
  ];
  for (const [x, y, z] of pawPos) {
    const p = paw.clone();
    p.translate(x * scale, y * scale, z * scale);
    bodyParts.push(p);
  }

  // Head
  const head = new RoundedBoxGeometry(0.70 * scale, 0.62 * scale, 0.68 * scale, seg, 0.22 * scale);
  head.translate(0, 1.05 * scale, 0.28 * scale);
  headParts.push(head);

  // Cheek fluff
  const cheek = new THREE.SphereGeometry(0.16 * scale, 8, 6);
  const c1 = cheek.clone();
  c1.scale(1.1, 0.8, 0.8);
  c1.translate(-0.48 * scale, 0.98 * scale, 0.48 * scale);
  headParts.push(c1);
  const c2 = cheek.clone();
  c2.scale(1.1, 0.8, 0.8);
  c2.translate(0.48 * scale, 0.98 * scale, 0.48 * scale);
  headParts.push(c2);

  // Details
  // Belly patch
  const belly = new RoundedBoxGeometry(0.55 * scale, 0.34 * scale, 0.20 * scale, seg, 0.14 * scale);
  belly.translate(0, 0.46 * scale, 0.46 * scale);
  applyVertexColor(belly, 0xfff6ea);
  detailParts.push(belly);

  // Collar
  const collar = new THREE.TorusGeometry(0.30 * scale, 0.06 * scale, 6, 10);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 0.80 * scale, 0.16 * scale);
  applyVertexColor(collar, 0xffffff);
  detailParts.push(collar);

  // Tag
  const tag = new THREE.SphereGeometry(0.07 * scale, 8, 6);
  tag.translate(0, 0.72 * scale, 0.40 * scale);
  applyVertexColor(tag, 0xfff3c8);
  detailParts.push(tag);

  // Blush
  const blush = new THREE.SphereGeometry(0.085 * scale, 8, 6);
  const b1 = blush.clone();
  b1.scale(1.25, 0.6, 0.45);
  b1.translate(-0.34 * scale, 0.98 * scale, 0.62 * scale);
  applyVertexColor(b1, 0xff8fb6);
  detailParts.push(b1);
  const b2 = blush.clone();
  b2.scale(1.25, 0.6, 0.45);
  b2.translate(0.34 * scale, 0.98 * scale, 0.62 * scale);
  applyVertexColor(b2, 0xff8fb6);
  detailParts.push(b2);

  // Nose
  const nose = new THREE.SphereGeometry(0.05 * scale, 8, 6);
  nose.translate(0, 0.98 * scale, 0.76 * scale);
  applyVertexColor(nose, 0x1b1b2d);
  detailParts.push(nose);

  // Tiger stripes + sideburns
  if (key === 'tiger') {
    const stripe = new RoundedBoxGeometry(0.08 * scale, 0.28 * scale, 0.06 * scale, seg, 0.04 * scale);
    const stripePos = [
      [-0.25, 0.58, 0.42],
      [0.25, 0.58, 0.42],
      [-0.18, 0.46, 0.46],
      [0.18, 0.46, 0.46],
      [0, 0.52, -0.30]
    ];
    for (const [x, y, z] of stripePos) {
      const s = stripe.clone();
      s.translate(x * scale, y * scale, z * scale);
      applyVertexColor(s, 0x1b1b2d);
      detailParts.push(s);
    }

    // sideburn fluff
    const sb = new RoundedBoxGeometry(0.12 * scale, 0.20 * scale, 0.08 * scale, seg, 0.05 * scale);
    const sbL = sb.clone();
    sbL.translate(-0.55 * scale, 0.98 * scale, 0.56 * scale);
    applyVertexColor(sbL, 0xfefae0);
    detailParts.push(sbL);
    const sbR = sb.clone();
    sbR.translate(0.55 * scale, 0.98 * scale, 0.56 * scale);
    applyVertexColor(sbR, 0xfefae0);
    detailParts.push(sbR);
  }

  // Dire wolf ruff (ring of spikes)
  if (key === 'wolf') {
    const spike = new THREE.ConeGeometry(0.10 * scale, 0.22 * scale, 6, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const s = spike.clone();
      s.rotateX(Math.PI);
      s.translate(Math.cos(a) * 0.42 * scale, 0.90 * scale, Math.sin(a) * 0.20 * scale);
      applyVertexColor(s, i % 2 === 0 ? 0xcfe9ff : 0xb8c0c8);
      detailParts.push(s);
    }

    // sharper muzzle
    const muzzle = new RoundedBoxGeometry(0.34 * scale, 0.20 * scale, 0.44 * scale, seg, 0.10 * scale);
    muzzle.translate(0, 0.92 * scale, 0.68 * scale);
    applyVertexColor(muzzle, 0xfefae0);
    detailParts.push(muzzle);
  }

  // Dragon wings + horns merged into body mesh
  // Wings are flapped via shader by marking wing vertices with attributes
  let isDragon = key === 'dragon';
  if (isDragon) {
    // Ensure all existing parts have wing attrs set to 0 so merge keeps attributes
    for (const g of bodyParts) ensureWingAttrs(g);
    for (const g of headParts) ensureWingAttrs(g);
    for (const g of detailParts) ensureWingAttrs(g);

    // Add wings to bodyParts
    const wing = new RoundedBoxGeometry(0.90 * scale, 0.08 * scale, 0.55 * scale, seg, 0.06 * scale);
    // Left wing
    const wL = wing.clone();
    wL.translate(-0.85 * scale, 0.92 * scale, -0.15 * scale);
    setWingAttributes(wL, 1, -1);
    bodyParts.push(wL);
    // Right wing
    const wR = wing.clone();
    wR.translate(0.85 * scale, 0.92 * scale, -0.15 * scale);
    setWingAttributes(wR, 1, 1);
    bodyParts.push(wR);

    // Horns (details)
    const horn = new THREE.ConeGeometry(0.07 * scale, 0.25 * scale, 7, 1);
    const h1 = horn.clone();
    h1.translate(-0.20 * scale, 1.46 * scale, 0.10 * scale);
    applyVertexColor(h1, 0xfff6ea);
    detailParts.push(ensureWingAttrs(h1));
    const h2 = horn.clone();
    h2.translate(0.20 * scale, 1.46 * scale, 0.10 * scale);
    applyVertexColor(h2, 0xfff6ea);
    detailParts.push(ensureWingAttrs(h2));
  } else {
    // ensure non-dragon has wing attributes too (merge safety if cached reused in a scene)
    for (const g of bodyParts) ensureWingAttrs(g);
    for (const g of headParts) ensureWingAttrs(g);
    for (const g of detailParts) ensureWingAttrs(g);
  }

  // Tail (separate for wag)
  let tailGeo;
  if (sp.tail === 'pom') {
    tailGeo = new THREE.SphereGeometry(0.14 * scale, 8, 6);
    tailGeo.translate(0, 0.82 * scale, -0.44 * scale);
  } else {
    const long = sp.tail === 'long';
    const tail = new RoundedBoxGeometry(long ? 0.16 * scale : 0.18 * scale, long ? 0.56 * scale : 0.36 * scale, 0.16 * scale, seg, 0.10 * scale);
    tail.rotateX(Math.PI * 0.18);
    tail.translate(0, 0.80 * scale, -0.46 * scale);
    tailGeo = tail;
  }

  // Ears instanced geometry (one draw call)
  // For bunny, we stretch in instance matrices.
  const earGeo = new RoundedBoxGeometry(0.18 * scale, 0.32 * scale, 0.14 * scale, seg, 0.10 * scale);

  // Face plane (eyes shader)
  const faceGeo = new THREE.PlaneGeometry(0.95 * scale, 0.60 * scale, 1, 1);

  // Hitbox (easy mobile interaction)
  const hitGeo = new RoundedBoxGeometry(1.55 * scale, 1.35 * scale, 1.55 * scale, 1, 0.25 * scale);
  hitGeo.translate(0, 0.90 * scale, 0.15 * scale);

  const bodyGeo = mergeGeos(bodyParts) || new THREE.BoxGeometry(1, 1, 1);
  const headGeo = mergeGeos(headParts) || new THREE.BoxGeometry(1, 1, 1);
  const detailGeo = mergeGeos(detailParts) || new THREE.BoxGeometry(0.01, 0.01, 0.01);

  const out = { bodyGeo, headGeo, detailGeo, tailGeo, earGeo, faceGeo, hitGeo };
  GEO_CACHE.set(key, out);
  return out;
}

// -----------------------------
// Virtual Joystick (mobile)
// -----------------------------

function VirtualJoystick({ onChange }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const [active, setActive] = useState(false);

  const state = useRef({ id: null, cx: 0, cy: 0 });

  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;

    const down = (e) => {
      if (!e.isPrimary) return;
      state.current.id = e.pointerId;
      const rect = base.getBoundingClientRect();
      state.current.cx = rect.left + rect.width / 2;
      state.current.cy = rect.top + rect.height / 2;
      setActive(true);
      base.setPointerCapture?.(e.pointerId);
    };

    const move = (e) => {
      if (!active) return;
      if (e.pointerId !== state.current.id) return;
      const dx = e.clientX - state.current.cx;
      const dy = e.clientY - state.current.cy;
      const r = 46;
      const len = Math.hypot(dx, dy) || 1;
      const nx = clamp(dx / r, -1, 1);
      const ny = clamp(dy / r, -1, 1);

      if (knobRef.current) {
        const kx = (dx / len) * Math.min(r, len);
        const ky = (dy / len) * Math.min(r, len);
        knobRef.current.style.transform = `translate(${kx}px, ${ky}px)`;
      }

      onChange?.({ x: nx, y: ny });
    };

    const up = (e) => {
      if (e.pointerId !== state.current.id) return;
      setActive(false);
      state.current.id = null;
      if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
      onChange?.({ x: 0, y: 0 });
    };

    base.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });

    return () => {
      base.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [active, onChange]);

  return (
    <div className="fixed bottom-5 left-5 z-[80] select-none">
      <div
        ref={baseRef}
        className="w-[120px] h-[120px] rounded-full border border-black/10 bg-white/30 backdrop-blur-md flex items-center justify-center"
        style={{ touchAction: 'none' }}
      >
        <div ref={knobRef} className="w-[56px] h-[56px] rounded-full bg-white/40 border border-black/10" />
      </div>
      <div className="mt-2 text-[11px] text-black/60">Move</div>
    </div>
  );
}

// -----------------------------
// Player controller (WASD + pointer lock desktop, joystick + touch look mobile)
// -----------------------------

function PlayerController({ isDraggingRef, joystickRef }) {
  const { camera, gl } = useThree();
  const isMobile = useIsMobile();

  const [, getKeys] = useKeyboardControls();

  const yaw = useRef(0);
  const pitch = useRef(0);
  const locked = useRef(false);
  const lastTouch = useRef({ id: null, x: 0, y: 0, active: false });

  useEffect(() => {
    const e = new THREE.Euler().copy(camera.rotation);
    yaw.current = e.y;
    pitch.current = e.x;
  }, [camera]);

  useEffect(() => {
    if (isMobile) return;
    const el = gl.domElement;

    const onPointerLockChange = () => {
      locked.current = document.pointerLockElement === el;
    };

    const onMouseMove = (e) => {
      if (!locked.current) return;
      if (isDraggingRef?.current) return;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      yaw.current -= mx * 0.0022;
      pitch.current -= my * 0.0022;
      pitch.current = clamp(pitch.current, -1.15, 1.15);
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);

    const onClick = () => {
      if (isDraggingRef?.current) return;
      if (!document.pointerLockElement) el.requestPointerLock?.();
    };

    el.addEventListener('click', onClick);

    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('click', onClick);
    };
  }, [gl.domElement, isDraggingRef, isMobile]);

  useEffect(() => {
    if (!isMobile) return;
    const el = gl.domElement;

    const down = (e) => {
      if (!e.isPrimary) return;
      if (isDraggingRef?.current) return;
      // only right side rotates
      if (e.clientX < window.innerWidth * 0.5) return;
      lastTouch.current.id = e.pointerId;
      lastTouch.current.x = e.clientX;
      lastTouch.current.y = e.clientY;
      lastTouch.current.active = true;
    };

    const move = (e) => {
      if (!lastTouch.current.active) return;
      if (lastTouch.current.id !== e.pointerId) return;
      if (isDraggingRef?.current) return;
      const dx = e.clientX - lastTouch.current.x;
      const dy = e.clientY - lastTouch.current.y;
      lastTouch.current.x = e.clientX;
      lastTouch.current.y = e.clientY;
      yaw.current -= dx * 0.0032;
      pitch.current -= dy * 0.0032;
      pitch.current = clamp(pitch.current, -1.10, 1.10);
    };

    const up = (e) => {
      if (lastTouch.current.id !== e.pointerId) return;
      lastTouch.current.active = false;
      lastTouch.current.id = null;
    };

    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerup', up, { passive: true });
    el.addEventListener('pointercancel', up, { passive: true });

    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl.domElement, isDraggingRef, isMobile]);

  const tmpForward = useMemo(() => new THREE.Vector3(), []);
  const tmpRight = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');

    let mx = 0;
    let mz = 0;

    if (!isMobile) {
      const k = getKeys();
      mx += (k.right ? 1 : 0) - (k.left ? 1 : 0);
      mz += (k.backward ? 1 : 0) - (k.forward ? 1 : 0);
    }

    const joy = joystickRef?.current || { x: 0, y: 0 };
    mx += joy.x;
    mz += joy.y;

    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;

    const base = isMobile ? 2.8 : 3.4;
    const sprint = !isMobile && getKeys().sprint;
    const speed = sprint ? base * 1.65 : base;

    camera.getWorldDirection(tmpForward);
    tmpForward.y = 0;
    tmpForward.normalize();
    tmpRight.set(tmpForward.z, 0, -tmpForward.x);

    const vx = (tmpRight.x * mx + tmpForward.x * mz) * speed;
    const vz = (tmpRight.z * mx + tmpForward.z * mz) * speed;

    camera.position.x += vx * dt;
    camera.position.z += vz * dt;

    camera.position.x = clamp(camera.position.x, ROOM_BOUNDS.minX + 0.6, ROOM_BOUNDS.maxX - 0.6);
    camera.position.z = clamp(camera.position.z, ROOM_BOUNDS.minZ + 0.6, ROOM_BOUNDS.maxZ - 0.6);

    // Grounded + head bob
    const moving = Math.abs(mx) + Math.abs(mz) > 0.1;
    const bob = moving ? Math.sin(state.clock.getElapsedTime() * (sprint ? 10.0 : 7.0)) * (sprint ? 0.05 : 0.035) : 0;
    camera.position.y = 1.65 + bob;
  });

  return null;
}

// -----------------------------
// Garden environment
// -----------------------------

function ZenGarden({ rampTex }) {
  const floorMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#7bcf7a'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const pathMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#e6d7b8'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const trunkMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#8b5a2b'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const leafMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#2f7d4f'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const rockMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#a9b3bb'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  // shared geos (instancing)
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.12, 0.16, 1.6, 7, 1), []);
  const leafGeo = useMemo(() => new THREE.IcosahedronGeometry(0.75, 0), []);
  const rockGeo = useMemo(() => new THREE.DodecahedronGeometry(0.55, 0), []);

  const treePoints = useMemo(() => {
    const pts = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 11.6 + Math.sin(i * 2.1) * 0.35 + Math.random() * 0.35;
      pts.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        s: 0.8 + Math.random() * 0.55,
        ry: Math.random() * Math.PI * 2
      });
    }
    return pts;
  }, []);

  const rockPoints = useMemo(() => {
    const pts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      pts.push({
        x: (Math.random() * 2 - 1) * 7.8,
        z: (Math.random() * 2 - 1) * 7.8,
        s: 0.7 + Math.random() * 1.3,
        ry: Math.random() * Math.PI * 2
      });
    }
    return pts;
  }, []);

  // Dreamy rays (cheap cones)
  const rayMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffd89a'),
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }, []);

  const sparkleCount = useMemo(() => {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    return dpr > 1.2 ? 80 : 60;
  }, []);

  return (
    <group>
      {/* Grass floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} material={floorMat}>
        <circleGeometry args={[18, 48]} />
      </mesh>

      {/* Path hint */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} material={pathMat}>
        <ringGeometry args={[3.2, 3.9, 48]} />
      </mesh>

      {/* Soft grid for orientation (very subtle) */}
      <Grid
        position={[0, 0.02, 0]}
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.6}
        cellColor={'#ffffff'}
        sectionSize={5}
        sectionThickness={1}
        sectionColor={'#ffffff'}
        fadeDistance={18}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* Perimeter trees (2 instanced draw calls) */}
      <Instances limit={treePoints.length} geometry={trunkGeo} material={trunkMat}>
        {treePoints.map((p, i) => (
          <Instance key={i} position={[p.x, 0.8, p.z]} rotation={[0, p.ry, 0]} scale={[p.s, 1.2 * p.s, p.s]} />
        ))}
      </Instances>
      <Instances limit={treePoints.length} geometry={leafGeo} material={leafMat}>
        {treePoints.map((p, i) => (
          <Instance key={i} position={[p.x, 2.1 * p.s, p.z]} rotation={[0, p.ry * 0.7, 0]} scale={[p.s * 1.2, p.s * 1.1, p.s * 1.2]} />
        ))}
      </Instances>

      {/* Rocks */}
      <Instances limit={rockPoints.length} geometry={rockGeo} material={rockMat}>
        {rockPoints.map((p, i) => (
          <Instance key={i} position={[p.x, 0.32, p.z]} rotation={[0, p.ry, 0]} scale={[p.s, p.s * 0.7, p.s]} />
        ))}
      </Instances>

      {/* God rays */}
      <mesh position={[4.5, 4.0, 1.5]} rotation={[Math.PI, 0.4, 0]} material={rayMat}>
        <coneGeometry args={[3.4, 7.0, 18, 1, true]} />
      </mesh>
      <mesh position={[-4.2, 4.1, -2.5]} rotation={[Math.PI, -0.55, 0]} material={rayMat}>
        <coneGeometry args={[3.0, 6.2, 18, 1, true]} />
      </mesh>
      <mesh position={[0.5, 3.8, -5.8]} rotation={[Math.PI, 0.1, 0]} material={rayMat}>
        <coneGeometry args={[3.2, 6.8, 18, 1, true]} />
      </mesh>

      {/* Pollen/Fireflies */}
      <Sparkles count={sparkleCount} speed={0.25} opacity={0.35} scale={[22, 4.2, 22]} size={1.6} color={'#ffdca8'} />
    </group>
  );
}

// -----------------------------
// Palace Pet component
// -----------------------------

const BASE_Y = 0.55;

function GardenPet({
  pet,
  bounds,
  rugs,
  rampTex,
  blobTex,
  registerAPI,
  onCommit,
  onHover,
  setDragging,
  getPosMap,
  getHeartEmitter,
  chaseModeRef,
  isDraggingRef
}) {
  const { size, camera } = useThree();
  const isMobile = useIsMobile();

  const sp = SPECIES[pet.speciesKey] || SPECIES.cat;

  const { bodyGeo, headGeo, detailGeo, tailGeo, earGeo, faceGeo, hitGeo } = useMemo(
    () => getPetGeometries(pet.speciesKey),
    [pet.speciesKey]
  );

  // Materials (cached)
  const bodyMat = useMemo(() => {
    const m = getToonMat(rampTex, pet.bodyColor, pet.speciesKey);
    if (pet.speciesKey === 'dragon') patchDragonFlapMaterial(m);
    return m;
  }, [pet.bodyColor, pet.speciesKey, rampTex]);

  const detailMat = useMemo(() => getDetailMat(rampTex), [rampTex]);
  const blobMat = useMemo(() => getBlobMat(blobTex), [blobTex]);
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false }), []);

  // Unique eye shader per pet (uniforms are per-instance)
  const eyeMat = useMemo(() => createEyeShaderMaterial(), []);

  // Refs
  const headRef = useRef();
  const tailRef = useRef();
  const earsRef = useRef();

  // Pose
  const hoverBaseY = sp.hover ? 1.50 : BASE_Y;
  const pos = useRef(new THREE.Vector3(pet.position[0], hoverBaseY, pet.position[1]));
  const vel = useRef(new THREE.Vector3());
  const yaw = useRef(pet.yaw ?? 0);

  // Interaction state
  const heldRef = useRef(false);
  const hoverRef = useRef(false);

  // Petting state ("love")
  const petting = useRef({ lastX: 0, lastDir: 0, flips: 0, love: 0, emitT: 0 });

  // Brain
  const brain = useRef({
    mode: 'wandering',
    t: 0,
    seed: Math.floor((pet.seed ?? 1) * 9999) % 10000,
    walkS: 0,
    restSpot: new THREE.Vector3(),
    lastInteractAt: 0
  });

  // Social state
  const social = useRef({ active: false, until: 0, partnerId: null, partnerPos: new THREE.Vector3(), facePartnerYaw: 0 });

  // Spring: position/rotation/scale/lift
  const [{ p, r, s, lift }, api] = useSpring(() => ({
    p: [pos.current.x, pos.current.y, pos.current.z],
    r: [0, yaw.current, 0],
    s: [1, 1, 1],
    lift: 0,
    config: { mass: 1.0, tension: 240, friction: 26 }
  }));

  // Expose API to manager
  useEffect(() => {
    registerAPI?.(pet.id, {
      getPose: () => ({ x: pos.current.x, z: pos.current.z, yaw: yaw.current, mode: brain.current.mode, speciesKey: pet.speciesKey }),
      setSocial: ({ active, until, partnerId, partnerPos }) => {
        social.current.active = active;
        social.current.until = until;
        social.current.partnerId = partnerId;
        if (partnerPos) {
          social.current.partnerPos.copy(partnerPos);
          const dx = partnerPos.x - pos.current.x;
          const dz = partnerPos.z - pos.current.z;
          social.current.facePartnerYaw = Math.atan2(dx, dz);
        }
      },
      greet: () => {
        api.start({ lift: 0.42, s: [1.14, 0.86, 1.14], config: { mass: 1.0, tension: 320, friction: 22 } });
        setTimeout(() => api.start({ lift: 0, s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } }), 220);
      },
      nudgeToSleepSpot: (spot) => {
        // Used for cuddle pile bias
        brain.current.mode = 'sleeping';
        brain.current.t = randRange(3.0, 6.0);
        brain.current.restSpot.copy(spot);
      }
    });
  }, [api, pet.id, pet.speciesKey, registerAPI]);

  // Drag plane helpers
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const setFromClient = useCallback((clientX, clientY) => {
    const ndc = {
      x: (clientX / size.width) * 2 - 1,
      y: -(clientY / size.height) * 2 + 1
    };
    raycaster.setFromCamera(ndc, camera);
  }, [camera, raycaster, size.height, size.width]);

  const doTap = useCallback(() => {
    brain.current.lastInteractAt = performance.now() * 0.001;

    // Jump/spin + hearts
    api.start({
      lift: sp.hover ? 0.35 : 0.58,
      r: [0, yaw.current + Math.PI * 2, 0],
      s: [1.18, 0.82, 1.18],
      config: { mass: 1.0, tension: 340, friction: 22 }
    });

    const emitter = getHeartEmitter?.();
    if (emitter?.emit) emitter.emit(pos.current.clone(), sp.highTier || sp.mythical ? 3 : 2);

    setTimeout(() => {
      api.start({ lift: 0, s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } });
    }, 240);
  }, [api, getHeartEmitter, sp.highTier, sp.hover, sp.mythical]);

  const bind = useDrag(
    ({ first, last, active, tap, event, canceled }) => {
      if (tap) {
        event?.stopPropagation?.();
        doTap();
        return;
      }

      if (first) {
        event?.stopPropagation?.();
        heldRef.current = true;
        brain.current.mode = 'held';
        brain.current.lastInteractAt = performance.now() * 0.001;
        setDragging?.(pet.id);
        if (isDraggingRef) isDraggingRef.current = true;

        api.start({ s: [0.92, 1.10, 0.92], config: { mass: 1.05, tension: 360, friction: 24 } });
      }

      if (active && event?.clientX != null && event?.clientY != null) {
        const liftY = sp.hover ? 2.3 : 1.5;
        plane.constant = -liftY;
        setFromClient(event.clientX, event.clientY);
        if (raycaster.ray.intersectPlane(plane, hit)) {
          const x = clamp(hit.x, bounds.minX, bounds.maxX);
          const z = clamp(hit.z, bounds.minZ, bounds.maxZ);
          pos.current.set(x, liftY, z);
          vel.current.set(0, 0, 0);
          api.start({
            p: [x, liftY, z],
            config: { mass: 1.25, tension: 280, friction: 30 }
          });
        }
      }

      if (last || canceled) {
        heldRef.current = false;
        setDragging?.(null);
        if (isDraggingRef) isDraggingRef.current = false;

        pos.current.y = hoverBaseY;
        brain.current.mode = social.current.active ? 'socializing' : 'wandering';

        api.start({
          p: [pos.current.x, hoverBaseY, pos.current.z],
          s: [1.22, 0.78, 1.22],
          config: { mass: 1.0, tension: 280, friction: 18 }
        });
        setTimeout(() => api.start({ s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } }), 160);

        onCommit?.(pet.id, { position: [pos.current.x, pos.current.z], yaw: yaw.current });
      }

      if (active && event?.cancelable) event.preventDefault();
    },
    { pointer: { touch: true }, eventOptions: { passive: false } }
  );

  // AI + animation
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const steer = useMemo(() => new THREE.Vector3(), []);
  const sep = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const B = brain.current;

    // Update dragon wing flap uniform
    if (pet.speciesKey === 'dragon' && bodyMat.userData?.uTime) {
      bodyMat.userData.uTime.value = t;
    }

    // Social expiry
    if (social.current.active && t > social.current.until) {
      social.current.active = false;
      social.current.partnerId = null;
      if (!heldRef.current && B.mode === 'socializing') B.mode = 'wandering';
    }

    // Love decay
    petting.current.love = Math.max(0, petting.current.love - dt * 0.55);
    if (petting.current.love > 0.2) {
      petting.current.emitT -= dt;
      if (petting.current.emitT <= 0) {
        petting.current.emitT = randRange(0.14, 0.22);
        getHeartEmitter?.()?.emit?.(pos.current.clone(), 1);
      }
    }

    // Chase manager influence
    const chase = chaseModeRef?.current;
    if (!heldRef.current && chase && chase.active) {
      if (chase.chaserId === pet.id) {
        B.mode = 'chasing';
        B.t = chase.until - t;
        B.restSpot.set(chase.runnerPos.x, hoverBaseY, chase.runnerPos.z);
      } else if (chase.runnerId === pet.id) {
        B.mode = 'running';
        B.t = chase.until - t;
      }
    }

    // Held behavior: wide eyes + look at camera + dangle
    if (heldRef.current) {
      eyeMat.uniforms.uWide.value = lerp(eyeMat.uniforms.uWide.value, 1.0, 0.18);
      eyeMat.uniforms.uHappy.value = lerp(eyeMat.uniforms.uHappy.value, 0.0, 0.12);
      eyeMat.uniforms.uBlink.value = lerp(eyeMat.uniforms.uBlink.value, 0.0, 0.25);

      tmp.set(camera.position.x - pos.current.x, camera.position.y - (pos.current.y + 0.9), camera.position.z - pos.current.z);
      tmp.normalize();
      eyeMat.uniforms.uLook.value.set(tmp.x, -tmp.y);

      if (headRef.current) {
        headRef.current.rotation.x = lerp(headRef.current.rotation.x, -0.25, 0.18);
        headRef.current.rotation.z = lerp(headRef.current.rotation.z, Math.sin(t * 10.0 + pet.seed) * 0.22, 0.22);
      }
      if (tailRef.current) {
        tailRef.current.rotation.y = Math.sin(t * 10.5) * 1.0;
        tailRef.current.rotation.x = Math.cos(t * 5.0) * 0.14;
      }

      return;
    }

    // If camera far: companion follow
    const dxp = camera.position.x - pos.current.x;
    const dzp = camera.position.z - pos.current.z;
    const dPlayer2 = dxp * dxp + dzp * dzp;
    const shouldFollow = dPlayer2 > 70; // > ~8.4 units

    // Social stops movement
    if (social.current.active) B.mode = 'socializing';

    // Sleep
    const sinceInteract = (performance.now() * 0.001) - (B.lastInteractAt || 0);
    if (B.mode !== 'sleeping' && !social.current.active && !shouldFollow) {
      if (sinceInteract > PERSONALITY.sleepAfterNoInteractS && Math.random() < 0.035 * dt) {
        B.mode = 'sleeping';
        B.t = randRange(3.0, 6.0);
        const spot = pick(rugs);
        B.restSpot.set(spot[0], hoverBaseY, spot[1]);
      }
    }

    // Timers
    B.t -= dt;

    // Wander -> rest/curious
    if (B.mode === 'wandering') {
      B.walkS += dt;
      if (!shouldFollow && B.walkS > PERSONALITY.restAfterWalkS && Math.random() < PERSONALITY.restChancePerS * dt) {
        B.mode = 'resting';
        B.t = randRange(PERSONALITY.restDuration[0], PERSONALITY.restDuration[1]);
        B.walkS = 0;
        const spot = pick(rugs);
        B.restSpot.set(spot[0], hoverBaseY, spot[1]);
      } else if (!shouldFollow && Math.random() < PERSONALITY.curiosityChancePerS * dt) {
        B.mode = 'curious';
        B.t = randRange(PERSONALITY.curiosityDuration[0], PERSONALITY.curiosityDuration[1]);
      }
    }

    if (shouldFollow && B.mode !== 'sleeping') {
      B.mode = 'following';
    } else if (B.mode === 'following' && !shouldFollow) {
      B.mode = social.current.active ? 'socializing' : 'wandering';
      B.walkS = 0;
    }

    // Separation from other pets + slight from player (boid-ish)
    sep.set(0, 0, 0);
    const map = getPosMap?.();
    if (map) {
      for (const [id, p2] of map) {
        if (id === pet.id) continue;
        const ox = pos.current.x - p2.x;
        const oz = pos.current.z - p2.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 2.3 * 2.3 && d2 > 0.0001) {
          const inv = 1 / (Math.sqrt(d2) || 1);
          const push = (1.0 - Math.sqrt(d2) / 2.3) * 0.018;
          sep.x += ox * inv * push;
          sep.z += oz * inv * push;
        }
      }
    }
    // Player personal space
    {
      const ox = pos.current.x - camera.position.x;
      const oz = pos.current.z - camera.position.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 1.6 * 1.6 && d2 > 0.0001) {
        const inv = 1 / (Math.sqrt(d2) || 1);
        sep.x += ox * inv * 0.022;
        sep.z += oz * inv * 0.022;
      }
    }

    // AI
    if (B.mode === 'socializing') {
      vel.current.multiplyScalar(Math.pow(0.72, dt * 60));
      yaw.current = dampAngle(yaw.current, social.current.facePartnerYaw, 0.14);
    } else if (B.mode === 'curious') {
      vel.current.multiplyScalar(Math.pow(0.70, dt * 60));
      const targetYaw = Math.atan2(dxp, dzp);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.12);
      if (B.t <= 0) B.mode = 'wandering';
    } else if (B.mode === 'resting' || B.mode === 'sleeping') {
      tmp.set(B.restSpot.x - pos.current.x, 0, B.restSpot.z - pos.current.z);
      const d = tmp.length();
      if (d > 0.20) {
        tmp.multiplyScalar(1 / (d || 1));
        vel.current.x += tmp.x * dt * 2.2;
        vel.current.z += tmp.z * dt * 2.2;
        const targetYaw = Math.atan2(vel.current.x, vel.current.z);
        if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.10);
      } else {
        vel.current.multiplyScalar(Math.pow(0.70, dt * 60));
        if (B.t <= 0) B.mode = 'wandering';
      }
    } else if (B.mode === 'following') {
      tmp.set(dxp, 0, dzp);
      const d = tmp.length();
      if (d > 0.001) tmp.multiplyScalar(1 / d);
      const speed = isMobile ? 1.45 : 1.65;
      vel.current.x += tmp.x * speed * dt * 3.0;
      vel.current.z += tmp.z * speed * dt * 3.0;
      vel.current.x *= Math.pow(0.86, dt * 60);
      vel.current.z *= Math.pow(0.86, dt * 60);
      const targetYaw = Math.atan2(vel.current.x, vel.current.z);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.12);
    } else if (B.mode === 'chasing') {
      tmp.set(B.restSpot.x - pos.current.x, 0, B.restSpot.z - pos.current.z);
      const d = tmp.length();
      if (d > 0.001) tmp.multiplyScalar(1 / d);
      const speed = 2.05;
      vel.current.x += tmp.x * speed * dt * 3.0;
      vel.current.z += tmp.z * speed * dt * 3.0;
      vel.current.x *= Math.pow(0.86, dt * 60);
      vel.current.z *= Math.pow(0.86, dt * 60);
      const targetYaw = Math.atan2(vel.current.x, vel.current.z);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.13);
    } else if (B.mode === 'running') {
      const ch = chase?.chaserPos;
      if (ch) {
        tmp.set(pos.current.x - ch.x, 0, pos.current.z - ch.z);
        const d = tmp.length();
        if (d > 0.001) tmp.multiplyScalar(1 / d);
        const speed = 2.1;
        vel.current.x += tmp.x * speed * dt * 3.0;
        vel.current.z += tmp.z * speed * dt * 3.0;
        vel.current.x *= Math.pow(0.86, dt * 60);
        vel.current.z *= Math.pow(0.86, dt * 60);
        const targetYaw = Math.atan2(vel.current.x, vel.current.z);
        if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.13);
      }
    } else {
      // Wandering with noise + wall steering
      const nx = noise1D(t * 0.55, B.seed);
      const nz = noise1D(t * 0.55 + 100, B.seed);
      tmp.set(nx, 0, nz);
      const l = tmp.length();
      if (l > 0.001) tmp.multiplyScalar(1 / l);

      steer.set(0, 0, 0);
      const margin = 1.25;
      if (pos.current.x > bounds.maxX - margin) steer.x -= (pos.current.x - (bounds.maxX - margin)) / margin;
      if (pos.current.x < bounds.minX + margin) steer.x += ((bounds.minX + margin) - pos.current.x) / margin;
      if (pos.current.z > bounds.maxZ - margin) steer.z -= (pos.current.z - (bounds.maxZ - margin)) / margin;
      if (pos.current.z < bounds.minZ + margin) steer.z += ((bounds.minZ + margin) - pos.current.z) / margin;

      tmp.addScaledVector(steer, 1.25);
      tmp.addScaledVector(sep, 1.0);
      const l2 = tmp.length();
      if (l2 > 0.001) tmp.multiplyScalar(1 / l2);

      const speed = sp.highTier ? 1.35 : 1.20;
      vel.current.x += tmp.x * speed * dt * 2.6;
      vel.current.z += tmp.z * speed * dt * 2.6;

      vel.current.x *= Math.pow(0.88, dt * 60);
      vel.current.z *= Math.pow(0.88, dt * 60);

      const targetYaw = Math.atan2(vel.current.x, vel.current.z);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.09);
    }

    // Integrate
    pos.current.x += vel.current.x * dt * 60;
    pos.current.z += vel.current.z * dt * 60;

    pos.current.x = clamp(pos.current.x, bounds.minX, bounds.maxX);
    pos.current.z = clamp(pos.current.z, bounds.minZ, bounds.maxZ);

    // Hover for dragon
    if (sp.hover) {
      pos.current.y = hoverBaseY + Math.sin(t * 1.15 + pet.seed) * 0.12;
    } else {
      pos.current.y = hoverBaseY;
    }

    // Waddle locomotion
    const speed2 = vel.current.x * vel.current.x + vel.current.z * vel.current.z;
    const moving = speed2 > 0.0008 && !social.current.active && B.mode !== 'curious' && B.mode !== 'sleeping';
    const bob = moving ? Math.sin(t * 6.0 + pet.seed) * 0.045 : Math.sin(t * 2.0 + pet.seed) * 0.016;
    const rock = moving ? Math.sin(t * 6.0 + pet.seed) * 0.06 : 0;

    // Sit/sleep scaling
    const nearRest = (B.mode === 'resting' || B.mode === 'sleeping') && tmp.set(B.restSpot.x - pos.current.x, 0, B.restSpot.z - pos.current.z).length() < 0.28;
    const sit = nearRest && (B.mode === 'resting');
    const sleep = nearRest && (B.mode === 'sleeping');
    const sitScale = sit ? [1.06, 0.84, 1.06] : sleep ? [1.10, 0.78, 1.10] : [1, 1, 1];

    api.start({
      p: [pos.current.x, pos.current.y + bob, pos.current.z],
      r: [rock, yaw.current, 0],
      s: sitScale,
      immediate: true
    });

    // Face expression: blink + happy from love
    const blinkBase = 0.5 + 0.5 * Math.sin(t * 0.9 + pet.seed);
    const blinkPulse = smoothstep(clamp((blinkBase - 0.94) / (1.0 - 0.94), 0, 1)) * 0.9;

    const love = petting.current.love;
    const happy = clamp((love - 0.25) * 1.4, 0, 1);

    const targetBlink = sleep ? 1.0 : Math.max(blinkPulse, clamp(love * 0.4, 0, 0.35));
    eyeMat.uniforms.uBlink.value = lerp(eyeMat.uniforms.uBlink.value, targetBlink, 0.18);
    eyeMat.uniforms.uHappy.value = lerp(eyeMat.uniforms.uHappy.value, happy, 0.12);
    eyeMat.uniforms.uWide.value = lerp(eyeMat.uniforms.uWide.value, 0.0, 0.12);

    // Look direction: towards camera on curious/hover/love
    let lookX = 0;
    let lookY = 0;
    if (social.current.active) {
      tmp.set(social.current.partnerPos.x - pos.current.x, 0.2, social.current.partnerPos.z - pos.current.z).normalize();
      lookX = tmp.x;
      lookY = -tmp.y;
    } else if (B.mode === 'curious' || hoverRef.current || love > 0.25) {
      tmp.set(dxp, camera.position.y - (pos.current.y + 0.9), dzp).normalize();
      lookX = tmp.x;
      lookY = -tmp.y;
    }
    eyeMat.uniforms.uLook.value.set(
      lerp(eyeMat.uniforms.uLook.value.x, lookX, 0.10),
      lerp(eyeMat.uniforms.uLook.value.y, lookY, 0.10)
    );

    // Head tilt feedback
    if (headRef.current) {
      const wantsTilt = (B.mode === 'curious') || hoverRef.current || (love > 0.25);
      const tilt = wantsTilt ? 0.22 : 0.10;
      headRef.current.rotation.z = lerp(headRef.current.rotation.z, rock * 0.35, 0.16);
      headRef.current.rotation.x = lerp(
        headRef.current.rotation.x,
        (B.mode === 'curious' ? -tilt : -0.08) + (hoverRef.current ? 0.06 : 0) + (love > 0.25 ? 0.05 : 0),
        0.18
      );
    }

    // Tail wag
    if (tailRef.current) {
      const wagSpeed = moving ? 7.2 : 4.2;
      const wagAmp = moving ? 0.70 : 0.45;
      tailRef.current.rotation.y = Math.sin(t * wagSpeed) * wagAmp;
      tailRef.current.rotation.x = Math.cos(t * wagSpeed * 0.5) * 0.12;
    }

    // Ear twitch (instanced)
    if (earsRef.current) {
      const twitch = Math.sin(t * 6.5 + pet.seed) * 0.12;
      const m1 = new THREE.Matrix4();
      const m2 = new THREE.Matrix4();
      const left = new THREE.Object3D();
      const right = new THREE.Object3D();

      const earY = sp.ear === 'long' ? 1.55 * sp.scale : 1.35 * sp.scale;
      const earZ = sp.ear === 'floppy' ? 0.10 * sp.scale : 0.16 * sp.scale;
      const earSX = sp.ear === 'long' ? 0.85 : 1.0;
      const earSY = sp.ear === 'long' ? 1.75 : 1.0;

      left.position.set(-0.30 * sp.scale, earY, earZ);
      right.position.set(0.30 * sp.scale, earY, earZ);
      left.scale.set(earSX, earSY, 0.95);
      right.scale.set(earSX, earSY, 0.95);

      if (sp.ear === 'pointy') {
        left.rotation.set(0, 0, 0.45 + twitch * 0.35);
        right.rotation.set(0, 0, -0.45 - twitch * 0.35);
      } else if (sp.ear === 'floppy') {
        left.rotation.set(0.2, 0, 0.85 + twitch * 0.25);
        right.rotation.set(0.2, 0, -0.85 - twitch * 0.25);
      } else if (sp.ear === 'sharp') {
        left.rotation.set(-0.05, 0, 0.55 + twitch * 0.25);
        right.rotation.set(-0.05, 0, -0.55 - twitch * 0.25);
      } else {
        // bunny/dragon horn-ish
        left.rotation.set(-0.1, 0, 0.18 + twitch * 0.25);
        right.rotation.set(-0.1, 0, -0.18 - twitch * 0.25);
      }

      left.updateMatrix();
      right.updateMatrix();
      m1.copy(left.matrix);
      m2.copy(right.matrix);
      earsRef.current.setMatrixAt(0, m1);
      earsRef.current.setMatrixAt(1, m2);
      earsRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  // Petting detection
  const onPetMove = useCallback((e) => {
    if (heldRef.current) return;
    const localX = e.point.x;
    const dx = localX - petting.current.lastX;
    petting.current.lastX = localX;

    const dir = dx > 0.003 ? 1 : dx < -0.003 ? -1 : 0;
    if (dir !== 0 && petting.current.lastDir !== 0 && dir !== petting.current.lastDir) {
      petting.current.flips++;
    }
    if (dir !== 0) petting.current.lastDir = dir;

    if (petting.current.flips >= 3) {
      petting.current.flips = 0;
      petting.current.love = clamp(petting.current.love + 0.22, 0, 1);
      brain.current.lastInteractAt = performance.now() * 0.001;

      api.start({ s: [1.06, 0.90, 1.06], config: { mass: 1.0, tension: 200, friction: 22 } });
      setTimeout(() => api.start({ s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } }), 160);

      getHeartEmitter?.()?.emit?.(pos.current.clone(), 1);
    }
  }, [api, getHeartEmitter]);

  return (
    <a.group
      {...bind()}
      position={p.to((x, y, z) => [x, y + lift.get(), z])}
      rotation={r}
      scale={s}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverRef.current = true;
        onHover?.(pet);
      }}
      onPointerOut={() => {
        hoverRef.current = false;
        onHover?.(null);
      }}
    >
      {/* Blob shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} material={blobMat}>
        <planeGeometry args={[1.75 * sp.scale, 1.75 * sp.scale]} />
      </mesh>

      {/* Body + details */}
      <mesh geometry={bodyGeo} material={bodyMat} />
      <mesh geometry={detailGeo} material={detailMat} />

      {/* Head group */}
      <group ref={headRef}>
        <mesh geometry={headGeo} material={bodyMat} />
        <mesh geometry={faceGeo} material={eyeMat} position={[0, 1.02 * sp.scale, 0.63 * sp.scale]} />
        <instancedMesh ref={earsRef} args={[earGeo, bodyMat, 2]} />
      </group>

      {/* Tail */}
      <group ref={tailRef}>
        <mesh geometry={tailGeo} material={bodyMat} />
      </group>

      {/* Hitbox */}
      <mesh
        geometry={hitGeo}
        material={hitMat}
        onPointerMove={(e) => {
          e.stopPropagation();
          onPetMove(e);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      />
    </a.group>
  );
}

// -----------------------------
// Manager (persistence + social proxemics + chase/cuddle)
// -----------------------------

function PetManager({ bounds, rugs, rampTex, blobTex, isDraggingRef }) {
  const isMobile = useIsMobile();
  const maxPets = isMobile ? 7 : 12;

  const [pets, setPets] = useState(() => safeLoadPets() ?? defaultPets());
  const petsRef = useRef(pets);

  // APIs per pet
  const apiRef = useRef(new Map());
  const registerAPI = useCallback((id, api) => {
    apiRef.current.set(id, api);
    return () => apiRef.current.delete(id);
  }, []);

  // Hover HUD
  const [hovered, setHovered] = useState(null);

  // Heart emitter
  const heartEmitterRef = useRef(null);

  // Position map for separation
  const posMapRef = useRef(new Map());
  const getPosMap = useCallback(() => posMapRef.current, []);

  // Chase mode
  const chaseModeRef = useRef({
    active: false,
    until: 0,
    chaserId: null,
    runnerId: null,
    runnerPos: new THREE.Vector3(),
    chaserPos: new THREE.Vector3()
  });

  // Persist
  useEffect(() => {
    petsRef.current = pets;
    safeSavePets(pets);
  }, [pets]);

  const commitPet = useCallback((id, patch) => {
    const arr = petsRef.current;
    const idx = arr.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const next = arr.slice();
    next[idx] = { ...next[idx], ...patch };
    petsRef.current = next;
    setPets(next);
  }, []);

  const addPet = useCallback((speciesKey) => {
    setPets((prev) => {
      if (prev.length >= maxPets) return prev;
      return [...prev, makePet(speciesKey)];
    });
  }, [maxPets]);

  const resetPets = useCallback(() => {
    setPets(defaultPets());
  }, []);

  // Social cooldown per pair
  const pairCooldown = useRef(new Map());
  const frameCounter = useRef(0);

  // Cuddle pile hint
  const lastSleepSpotRef = useRef(null);

  useFrame((state, dt) => {
    frameCounter.current++;
    const t = state.clock.getElapsedTime();

    // Snapshot poses
    const arr = petsRef.current;
    posMapRef.current.clear();
    for (const p of arr) {
      const api = apiRef.current.get(p.id);
      const pose = api?.getPose?.();
      if (!pose) continue;
      posMapRef.current.set(p.id, { x: pose.x, z: pose.z, yaw: pose.yaw, mode: pose.mode, speciesKey: pose.speciesKey });
    }

    // Update chase positions
    if (chaseModeRef.current.active) {
      const ch = posMapRef.current.get(chaseModeRef.current.chaserId);
      const ru = posMapRef.current.get(chaseModeRef.current.runnerId);
      if (ch) chaseModeRef.current.chaserPos.set(ch.x, BASE_Y, ch.z);
      if (ru) chaseModeRef.current.runnerPos.set(ru.x, BASE_Y, ru.z);
      if (t > chaseModeRef.current.until) {
        chaseModeRef.current.active = false;
        chaseModeRef.current.chaserId = null;
        chaseModeRef.current.runnerId = null;
      }
    } else {
      // Start a chase burst
      if (arr.length >= 2 && Math.random() < PERSONALITY.chaseChancePerS * (1 / 60)) {
        const a = pick(arr);
        let b = pick(arr);
        let guard = 0;
        while (b.id === a.id && guard++ < 6) b = pick(arr);

        chaseModeRef.current.active = true;
        chaseModeRef.current.chaserId = a.id;
        chaseModeRef.current.runnerId = b.id;
        chaseModeRef.current.until = t + randRange(PERSONALITY.chaseDuration[0], PERSONALITY.chaseDuration[1]);
      }
    }

    // Social proximity checks
    if (frameCounter.current % SOCIAL_CHECK_EVERY_FRAMES !== 0) return;
    if (arr.length < 2) return;

    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i];
        const b = arr[j];

        const apiA = apiRef.current.get(a.id);
        const apiB = apiRef.current.get(b.id);
        if (!apiA || !apiB) continue;

        const pa = posMapRef.current.get(a.id);
        const pb = posMapRef.current.get(b.id);
        if (!pa || !pb) continue;

        // Ignore if chasing
        if (chaseModeRef.current.active) {
          const ch = chaseModeRef.current;
          if (a.id === ch.chaserId || a.id === ch.runnerId || b.id === ch.chaserId || b.id === ch.runnerId) continue;
        }

        const key = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
        const until = pairCooldown.current.get(key) || 0;
        if (t < until) continue;

        const dx = pa.x - pb.x;
        const dz = pa.z - pb.z;
        const d2 = dx * dx + dz * dz;

        if (d2 < SOCIAL_DISTANCE * SOCIAL_DISTANCE) {
          pairCooldown.current.set(key, t + SOCIAL_COOLDOWN_S);

          const duration = 1.05 + Math.random() * 0.45;
          const untilT = t + duration;

          const partnerPosA = new THREE.Vector3(pb.x, BASE_Y, pb.z);
          const partnerPosB = new THREE.Vector3(pa.x, BASE_Y, pa.z);

          apiA.setSocial?.({ active: true, until: untilT, partnerId: b.id, partnerPos: partnerPosA });
          apiB.setSocial?.({ active: true, until: untilT, partnerId: a.id, partnerPos: partnerPosB });

          apiA.greet?.();
          apiB.greet?.();

          // Hearts in between
          heartEmitterRef.current?.emit?.(new THREE.Vector3((pa.x + pb.x) * 0.5, BASE_Y, (pa.z + pb.z) * 0.5), 2);

          // Cuddle pile bias: if one is sleeping, invite the other (rare)
          if ((pa.mode === 'sleeping' || pb.mode === 'sleeping') && Math.random() < 0.35) {
            const spot = lastSleepSpotRef.current || pick(rugs);
            lastSleepSpotRef.current = spot;
            // nudge other to sleep too
            if (pa.mode === 'sleeping' && pb.mode !== 'sleeping') apiB.nudgeToSleepSpot?.(new THREE.Vector3(spot[0], BASE_Y, spot[1]));
            if (pb.mode === 'sleeping' && pa.mode !== 'sleeping') apiA.nudgeToSleepSpot?.(new THREE.Vector3(spot[0], BASE_Y, spot[1]));
          }
        }
      }
    }
  });

  // Sample persistence occasionally (lightweight)
  useFrame((_, dt) => {
    const saver = (PetManager._saver ||= { t: 0 });
    saver.t += dt;
    if (saver.t < 1.6) return;
    saver.t = 0;

    const arr = petsRef.current;
    if (!arr.length) return;

    let changed = false;
    const next = arr.map((p) => {
      const pose = posMapRef.current.get(p.id);
      if (!pose) return p;
      const nx = pose.x;
      const nz = pose.z;
      const nyaw = pose.yaw;
      if ((p.position?.[0] ?? 0) !== nx || (p.position?.[1] ?? 0) !== nz || (p.yaw ?? 0) !== nyaw) {
        changed = true;
        return { ...p, position: [nx, nz], yaw: nyaw };
      }
      return p;
    });

    if (changed) {
      petsRef.current = next;
      setPets(next);
      safeSavePets(next);
    }
  });

  const [hudVisible, setHudVisible] = useState(true);

  return (
    <>
      {/* HUD */}
      <div className="fixed top-3 left-3 z-[90] max-w-[94vw] pointer-events-auto">
        <div className="flex justify-end">
          <button
            className="mb-2 px-3 py-2 rounded-xl bg-white/40 hover:bg-white/50 border border-black/10 text-sm"
            onClick={() => setHudVisible((v) => !v)}
            title="Toggle HUD (Screenshot mode)"
          >
            👁️
          </button>
        </div>

        {hudVisible && (
          <div className="rounded-2xl border border-black/10 bg-white/35 backdrop-blur-md px-4 py-3 text-black">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold leading-tight">Garden Pets</div>
                <div className="text-xs text-black/70">Zen garden companions • Saved locally</div>
                <div className="mt-1 text-[11px] text-black/50">{pets.length} pet(s) • Mobile-first</div>
              </div>
              <div className="text-[11px] rounded-full px-2 py-1 border border-black/10 bg-white/30">
                {isMobile ? 'MOBILE' : 'DESKTOP'}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-6 gap-2">
              {Object.entries(SPECIES).map(([k, v]) => (
                <button
                  key={k}
                  className="px-2 py-2 rounded-xl bg-white/30 hover:bg-white/45 border border-black/10 text-base"
                  onClick={() => addPet(k)}
                  title={`Spawn ${v.label}`}
                >
                  {v.emoji}
                </button>
              ))}
              <button
                className="col-span-2 px-3 py-2 rounded-xl bg-white/30 hover:bg-white/45 border border-black/10 text-sm"
                onClick={resetPets}
              >
                Reset
              </button>
            </div>

            <div className="mt-3 text-[11px] text-black/60 space-y-1">
              <div><b>Desktop</b>: Click to lock mouse • WASD move • Shift sprint</div>
              <div><b>Mobile</b>: Joystick move • Drag right side to look</div>
              <div><b>Pet</b>: Tap = hop+hearts • Drag = carry • Rub = love</div>
              <div><b>Social</b>: greet within {SOCIAL_DISTANCE}u (every {SOCIAL_CHECK_EVERY_FRAMES} frames), cooldown {SOCIAL_COOLDOWN_S}s</div>
            </div>

            <div className="mt-2 text-[12px] text-emerald-900 min-h-[16px]">
              {hovered ? (
                <span><b>{SPECIES[hovered.speciesKey]?.label ?? 'Pet'}</b> — {hovered.name}</span>
              ) : (
                <span className="text-black/45">Hover a pet to see its name</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Vignette */}
      <div
        className="fixed inset-0 pointer-events-none z-[85]"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 100%)'
        }}
      />

      {/* Hearts */}
      <HeartPool getEmitterRef={(api) => (heartEmitterRef.current = api)} />

      {pets.map((p) => (
        <GardenPet
          key={p.id}
          pet={p}
          bounds={bounds}
          rugs={rugs}
          rampTex={rampTex}
          blobTex={blobTex}
          registerAPI={registerAPI}
          onCommit={commitPet}
          onHover={setHovered}
          setDragging={(idOrNull) => {
            if (isDraggingRef) isDraggingRef.current = !!idOrNull;
          }}
          getPosMap={getPosMap}
          getHeartEmitter={() => heartEmitterRef.current}
          chaseModeRef={chaseModeRef}
          isDraggingRef={isDraggingRef}
        />
      ))}
    </>
  );
}

// -----------------------------
// Main export
// -----------------------------

export default function GardenPets() {
  const isMobile = useIsMobile();

  const bounds = useMemo(() => ({ ...ROOM_BOUNDS }), []);
  const rugs = useMemo(() => {
    // “rest spots” in the garden (near inner ring)
    return [
      [-3.5, -3.5],
      [3.5, -3.5],
      [-3.5, 3.5],
      [3.5, 3.5],
      [0, 0]
    ];
  }, []);

  const rampTex = useToonRampTexture();
  const blobTex = useBlobShadowTexture();

  const joystickRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  const [glLost, setGlLost] = useState(false);

  return (
    <div className="w-screen h-screen overflow-hidden bg-gradient-to-b from-[#fff4d6] via-[#dff5ff] to-[#bde7c2]">
      {isMobile && (
        <VirtualJoystick onChange={(v) => (joystickRef.current = v)} />
      )}

      {glLost && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center">
          <div className="rounded-2xl bg-white/70 border border-black/10 px-5 py-4 text-black max-w-[90vw]">
            <div className="font-bold">WebGL context lost</div>
            <div className="text-sm text-black/70 mt-1">Try reloading the page. On mobile, low memory can cause this.</div>
          </div>
        </div>
      )}

      <KeyboardControls
        map={[
          { name: 'forward', keys: ['ArrowUp', 'KeyW'] },
          { name: 'backward', keys: ['ArrowDown', 'KeyS'] },
          { name: 'left', keys: ['ArrowLeft', 'KeyA'] },
          { name: 'right', keys: ['ArrowRight', 'KeyD'] },
          { name: 'sprint', keys: ['ShiftLeft', 'ShiftRight'] }
        ]}
      >
        <Canvas
          dpr={isMobile ? 1 : [1, 2]}
          gl={{ antialias: !isMobile, powerPreference: 'high-performance', alpha: false }}
          camera={{ position: [0, 1.65, 6.5], fov: 60, near: 0.1, far: 80 }}
          onCreated={({ gl }) => {
            const onLost = (e) => {
              e.preventDefault?.();
              setGlLost(true);
            };
            gl.domElement.addEventListener('webglcontextlost', onLost, false);
          }}
        >
          <color attach="background" args={['#e8f6ff']} />
          <fog attach="fog" args={['#e2f0ff', 8, 38]} />

          {/* Golden hour lighting */}
          <hemisphereLight intensity={0.85} color={'#b7d8ff'} groundColor={'#ffe5b8'} />
          <directionalLight intensity={1.5} position={[7, 10, 5]} color={'#ffd700'} />

          <ZenGarden rampTex={rampTex} />

          <PlayerController isDraggingRef={isDraggingRef} joystickRef={joystickRef} />

          <PetManager bounds={bounds} rugs={rugs} rampTex={rampTex} blobTex={blobTex} isDraggingRef={isDraggingRef} />
        </Canvas>
      </KeyboardControls>
    </div>
  );
}