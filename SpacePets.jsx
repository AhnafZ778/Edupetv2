import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Stars, Sparkles, Html } from '@react-three/drei';
import { a, useSpring } from '@react-spring/three';
import { useDrag } from '@use-gesture/react';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CapsuleGeometry } from 'three/examples/jsm/geometries/CapsuleGeometry.js';

/**
 * Palace Pets — “Living World” Upgrade
 *
 * Mobile-first constraints honored:
 * - No external models
 * - No real-time shadows (blob shadows only)
 * - No postprocessing
 * - No physics engines
 * - Low poly
 * - Global/shared geometry caches
 * - Small particle pool (50 hearts)
 *
 * -----------------------------
 * TWEAKS
 * -----------------------------
 * Social / Proxemics:
 *   SOCIAL_DISTANCE: distance to trigger greetings
 *   SOCIAL_COOLDOWN_S: pair cooldown to avoid infinite loops
 *
 * Personality rarity:
 *   PERSONALITY.* chances control how often behaviors happen
 */

// ---- Room bounds (keep player and pets inside)
const ROOM_BOUNDS = { minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 };

// ---- Social tuning
const SOCIAL_DISTANCE = 2.0;
const SOCIAL_COOLDOWN_S = 10;
const SOCIAL_CHECK_EVERY_FRAMES = 30;

// ---- Personality rarity knobs
const PERSONALITY = {
  curiosityChancePerS: 0.12, // chance per second to enter curiosity when wandering
  curiosityDuration: [1.2, 2.3],
  restChancePerS: 0.10, // chance per second to rest after walking a while
  restDuration: [2.6, 4.6],
  restAfterWalkS: 10.5,
  chaseChancePerS: 0.04, // manager-level chance to start a chase sequence
  chaseDuration: [3.5, 5.5],
  sleepAfterNoInteractS: 22 // if not interacted, can fall asleep on a rug
};

const LS_KEY = 'mindPalace:palacePets:living:v1';

// -----------------------------
// Small utilities
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

function randId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function safeLoadPets() {
  try {
    if (typeof window === 'undefined') return null;
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
    if (typeof window === 'undefined') return;
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

function randRange(a, b) {
  return lerp(a, b, Math.random());
}

// -----------------------------
// Procedural textures (tiny canvases)
// -----------------------------

function useToonRampTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 3;
    c.height = 1;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(3, 1);
    const vals = [60, 150, 255];
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
    g.addColorStop(0, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.60, 'rgba(0,0,0,0.14)');
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
// SDF Eye Shader (no external textures)
// -----------------------------

function createEyeShaderMaterial() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBlink: { value: 0.0 }, // 0=open, 1=closed
      uHappy: { value: 0.0 }, // 0=round, 1=happy arc
      uWide: { value: 0.0 }, // 0=normal, 1=wide eyes
      uLook: { value: new THREE.Vector2(0, 0) }, // -1..1
      uInk: { value: new THREE.Color(0x141425) },
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

      float sdCircle(vec2 p, float r){
        return length(p) - r;
      }

      // A soft arc-like "happy" eye: distance to a parabola band.
      float sdHappyArc(vec2 p){
        // parabola y = a*x^2 + b
        float a = 1.7;
        float b = -0.05;
        float y = a * (p.x*p.x) + b;
        float d = abs(p.y - y);
        // fade ends
        float end = smoothstep(0.18, 0.28, abs(p.x));
        return d + end*0.12;
      }

      float eyeMask(vec2 p){
        // Blink compresses Y around center.
        float blink = clamp(uBlink, 0.0, 1.0);
        float blinkScale = mix(1.0, 0.06, blink);
        p.y /= blinkScale;

        // Wide opens eyes slightly (bigger radius)
        float wide = clamp(uWide, 0.0, 1.0);
        float r = mix(0.105, 0.13, wide);

        float roundD = sdCircle(p, r);
        float happyD = sdHappyArc(p);
        float d = mix(roundD, happyD, clamp(uHappy, 0.0, 1.0));

        // Convert distance to alpha
        float aa = fwidth(d) * 1.4;
        float alpha = 1.0 - smoothstep(0.0, aa, d);
        return alpha;
      }

      void main(){
        // Face plane coords: center at 0
        vec2 uv = vUv * 2.0 - 1.0;

        // Place eyes
        vec2 leftC = vec2(-0.35, 0.05);
        vec2 rightC = vec2(0.35, 0.05);

        float leftA = eyeMask(uv - leftC);
        float rightA = eyeMask(uv - rightC);

        // Pupils (only when not happy / not blinking)
        float pupilOn = (1.0 - smoothstep(0.55, 0.90, uHappy)) * (1.0 - smoothstep(0.35, 0.85, uBlink));
        vec2 look = clamp(uLook, vec2(-1.0), vec2(1.0)) * 0.08;
        float pL = 1.0 - smoothstep(0.0, fwidth(sdCircle(uv - leftC - look, 0.045))*2.0, sdCircle(uv - leftC - look, 0.045));
        float pR = 1.0 - smoothstep(0.0, fwidth(sdCircle(uv - rightC - look, 0.045))*2.0, sdCircle(uv - rightC - look, 0.045));

        float inkA = max(leftA, rightA);
        float pupilA = max(pL, pR) * pupilOn;

        // Compose: eye whites are transparent; only draw ink.
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
// Heart Particle Shader (instanced, SDF, pool=50)
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

      // Classic 2D heart SDF
      float sdHeart(vec2 p){
        p.x *= 1.1;
        p.y += 0.15;
        float a = atan(p.x, p.y)/3.141593;
        float r = length(p);
        float h = abs(a);
        float d = r - (0.55 - 0.25*h);
        // carve bottom point
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
  const hearts = useRef([]); // {pos, vel, life, maxLife, scale}
  const tmpObj = useMemo(() => new THREE.Object3D(), []);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.22, 0.22, 1, 1), []);
  const material = useMemo(() => createHeartMaterial(), []);

  // initialize pool
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
      h.pos.y += randRange(0.35, 0.65);
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

    // Cheap: update opacity based on last updated heart
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

      h.vel.y -= 0.002 * dt * 60; // tiny gravity
      h.pos.addScaledVector(h.vel, dt * 60);

      const fade = 1.0 - smoothstep(0.55, 1.0, t);
      const s = h.scale * (0.9 + t * 0.3);

      tmpObj.position.copy(h.pos);
      tmpObj.scale.set(s, s, s);
      tmpObj.rotation.set(0, 0, Math.sin((i + t) * 7.0) * 0.25);
      tmpObj.updateMatrix();
      meshRef.current.setMatrixAt(i, tmpObj.matrix);

      // material is shared; approximate by using overall opacity
      material.uniforms.uOpacity.value = 0.95 * fade;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, 50]} frustumCulled={false} />;
}

// -----------------------------
// Species + palettes
// -----------------------------

const SPECIES = {
  cat: { label: 'Cat', ear: 'pointy', tail: 'long' },
  dog: { label: 'Dog', ear: 'floppy', tail: 'short' },
  bunny: { label: 'Bunny', ear: 'long', tail: 'pom' }
};

const NAMES = ['Nova', 'Mochi', 'Cosmo', 'Luna', 'Pip', 'Byte', 'Orion', 'Echo', 'Comet', 'Bean', 'Nori', 'Pebble', 'Sprout'];

function makePet(seedN = 0) {
  const keys = Object.keys(SPECIES);
  const speciesKey = pick(keys);

  const cozyPalettes = {
    cat: [0xcdb4db, 0xbde0fe, 0xa2d2ff, 0xffc8dd],
    dog: [0xffd6a5, 0xfec89a, 0xfde4cf, 0xcdeac0],
    bunny: [0xd0f4de, 0xa9def9, 0xe4c1f9, 0xfcf6bd]
  };

  const x = (Math.random() * 2 - 1) * 4.8;
  const z = (Math.random() * 2 - 1) * 4.8;

  return {
    id: randId(),
    name: pick(NAMES) + ' ' + ((Math.random() * 100) | 0),
    speciesKey,
    bodyColor: pick(cozyPalettes[speciesKey]),
    position: [x, z],
    yaw: Math.random() * Math.PI * 2,
    seed: seedN + Math.random() * 9
  };
}

function defaultPets() {
  return [
    {
      id: 'pet_a',
      name: 'Nova 12',
      speciesKey: 'cat',
      bodyColor: 0xcdb4db,
      position: [-2.0, 0.5],
      yaw: 0,
      seed: 1.2
    },
    {
      id: 'pet_b',
      name: 'Mochi 7',
      speciesKey: 'dog',
      bodyColor: 0xffd6a5,
      position: [2.2, -1.1],
      yaw: Math.PI,
      seed: 2.4
    }
  ];
}

// -----------------------------
// Global geometry cache (merged parts)
// -----------------------------

const GEO_CACHE = new Map();

function getMergeFn() {
  return BufferGeometryUtils.mergeGeometries || BufferGeometryUtils.mergeBufferGeometries;
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

function getPetGeometries(speciesKey) {
  const key = speciesKey || 'cat';
  const cached = GEO_CACHE.get(key);
  if (cached) return cached;

  const sp = SPECIES[key] || SPECIES.cat;
  const merge = getMergeFn();

  // Keep segments low (mobile)
  const seg = 2;

  // BODY + PAWS (merged)
  const bodyParts = [];
  {
    const body = new RoundedBoxGeometry(0.95, 0.66, 0.86, seg, 0.22);
    body.translate(0, 0.52, 0);
    bodyParts.push(body);

    const paw = new RoundedBoxGeometry(0.22, 0.14, 0.26, seg, 0.09);
    const pawPos = [
      [-0.30, 0.20, 0.24],
      [0.30, 0.20, 0.24],
      [-0.30, 0.20, -0.18],
      [0.30, 0.20, -0.18]
    ];
    for (const [x, y, z] of pawPos) {
      const p = paw.clone();
      p.translate(x, y, z);
      bodyParts.push(p);
    }
  }

  // HEAD (separate mesh so it can tilt)
  const headParts = [];
  {
    const head = new RoundedBoxGeometry(0.70, 0.62, 0.68, seg, 0.22);
    head.translate(0, 1.05, 0.28);
    headParts.push(head);

    // Cheek fluff (same body mat so it stays “toy”)
    const cheek = new THREE.SphereGeometry(0.16, 8, 6);
    const c1 = cheek.clone();
    c1.scale(1.1, 0.8, 0.8);
    c1.translate(-0.48, 0.98, 0.48);
    headParts.push(c1);

    const c2 = cheek.clone();
    c2.scale(1.1, 0.8, 0.8);
    c2.translate(0.48, 0.98, 0.48);
    headParts.push(c2);
  }

  // DETAILS (vertex colors) — keep as one mesh/material
  const detailParts = [];
  {
    // Belly patch
    const belly = new RoundedBoxGeometry(0.55, 0.34, 0.20, seg, 0.14);
    belly.translate(0, 0.46, 0.46);
    applyVertexColor(belly, 0xfff6ea);
    detailParts.push(belly);

    // Collar
    const collar = new THREE.TorusGeometry(0.30, 0.06, 6, 10);
    collar.rotateX(Math.PI / 2);
    collar.translate(0, 0.80, 0.16);
    applyVertexColor(collar, 0xffffff);
    detailParts.push(collar);

    // Tag
    const tag = new THREE.SphereGeometry(0.07, 8, 6);
    tag.translate(0, 0.72, 0.40);
    applyVertexColor(tag, 0xfff3c8);
    detailParts.push(tag);

    // Blush
    const blush = new THREE.SphereGeometry(0.085, 8, 6);
    const b1 = blush.clone();
    b1.scale(1.25, 0.6, 0.45);
    b1.translate(-0.34, 0.98, 0.62);
    applyVertexColor(b1, 0xff8fb6);
    detailParts.push(b1);

    const b2 = blush.clone();
    b2.scale(1.25, 0.6, 0.45);
    b2.translate(0.34, 0.98, 0.62);
    applyVertexColor(b2, 0xff8fb6);
    detailParts.push(b2);

    // Nose (tiny)
    const nose = new THREE.SphereGeometry(0.05, 8, 6);
    nose.translate(0, 0.98, 0.76);
    applyVertexColor(nose, 0x1b1b2d);
    detailParts.push(nose);
  }

  // Tail (separate for wag)
  let tailGeo;
  {
    if (sp.tail === 'pom') {
      tailGeo = new THREE.SphereGeometry(0.14, 8, 6);
      tailGeo.translate(0, 0.82, -0.44);
    } else {
      const long = sp.tail === 'long';
      const tail = new RoundedBoxGeometry(long ? 0.16 : 0.18, long ? 0.50 : 0.34, 0.16, seg, 0.10);
      tail.rotateX(Math.PI * 0.18);
      tail.translate(0, 0.80, -0.46);
      tailGeo = tail;
    }
  }

  // Ears (instanced 2)
  const earGeo = new RoundedBoxGeometry(0.18, 0.32, 0.14, seg, 0.10);

  // Face plane (eyes shader)
  const faceGeo = new THREE.PlaneGeometry(0.95, 0.60, 1, 1);

  // Hitbox (easy mobile)
  const hitGeo = new RoundedBoxGeometry(1.55, 1.35, 1.55, 1, 0.25);
  hitGeo.translate(0, 0.90, 0.15);

  const out = {
    bodyGeo: null,
    headGeo: null,
    detailGeo: null,
    tailGeo,
    earGeo,
    faceGeo,
    hitGeo
  };

  if (merge) {
    out.bodyGeo = merge(bodyParts, false);
    out.headGeo = merge(headParts, false);
    out.detailGeo = merge(detailParts, false);

    out.bodyGeo.computeVertexNormals();
    out.headGeo.computeVertexNormals();
    out.detailGeo.computeVertexNormals();

    out.bodyGeo.computeBoundingSphere();
    out.headGeo.computeBoundingSphere();
  } else {
    out.bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    out.headGeo = new THREE.BoxGeometry(1, 1, 1);
    out.detailGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  }

  GEO_CACHE.set(key, out);
  return out;
}

// -----------------------------
// Virtual Joystick (no external lib)
// -----------------------------

function VirtualJoystick({ onChange }) {
  const baseRef = useRef(null);
  const knobRef = useRef(null);
  const [active, setActive] = useState(false);

  const state = useRef({
    id: null,
    cx: 0,
    cy: 0,
    x: 0,
    y: 0
  });

  useEffect(() => {
    const base = baseRef.current;
    if (!base) return;

    const onDown = (e) => {
      if (!e.isPrimary) return;
      state.current.id = e.pointerId;
      const rect = base.getBoundingClientRect();
      state.current.cx = rect.left + rect.width / 2;
      state.current.cy = rect.top + rect.height / 2;
      setActive(true);
      base.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e) => {
      if (!active) return;
      if (state.current.id !== e.pointerId) return;
      const dx = e.clientX - state.current.cx;
      const dy = e.clientY - state.current.cy;
      const r = 46;
      const len = Math.hypot(dx, dy) || 1;
      const nx = clamp(dx / r, -1, 1);
      const ny = clamp(dy / r, -1, 1);
      state.current.x = nx;
      state.current.y = ny;
      // knob
      if (knobRef.current) {
        const kx = (dx / len) * Math.min(r, len);
        const ky = (dy / len) * Math.min(r, len);
        knobRef.current.style.transform = `translate(${kx}px, ${ky}px)`;
      }
      onChange?.({ x: nx, y: ny });
    };

    const onUp = (e) => {
      if (state.current.id !== e.pointerId) return;
      setActive(false);
      state.current.id = null;
      state.current.x = 0;
      state.current.y = 0;
      if (knobRef.current) knobRef.current.style.transform = `translate(0px, 0px)`;
      onChange?.({ x: 0, y: 0 });
    };

    base.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });

    return () => {
      base.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [active, onChange]);

  return (
    <div className="fixed bottom-5 left-5 z-[60] select-none">
      <div
        ref={baseRef}
        className="w-[120px] h-[120px] rounded-full border border-white/15 bg-white/10 backdrop-blur-md flex items-center justify-center"
        style={{ touchAction: 'none' }}
      >
        <div
          ref={knobRef}
          className="w-[56px] h-[56px] rounded-full bg-white/20 border border-white/20"
        />
      </div>
      <div className="mt-2 text-[11px] text-white/60">Move</div>
    </div>
  );
}

// -----------------------------
// Player Controller (WASD + pointer lock, joystick for mobile)
// -----------------------------

function useIsMobile() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 720;
  }, []);
}

function PlayerController({ dragging, joystickRef }) {
  const { camera, gl } = useThree();
  const isMobile = useIsMobile();

  const keys = useRef({ w: false, a: false, s: false, d: false, shift: false });
  const yaw = useRef(0);
  const pitch = useRef(0);

  const locked = useRef(false);
  const lastTouch = useRef({ id: null, x: 0, y: 0, active: false });

  useEffect(() => {
    // Initialize yaw/pitch from current camera
    const e = new THREE.Euler().copy(camera.rotation);
    yaw.current = e.y;
    pitch.current = e.x;
  }, [camera]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onKey = (down) => (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w') keys.current.w = down;
      if (k === 'a') keys.current.a = down;
      if (k === 's') keys.current.s = down;
      if (k === 'd') keys.current.d = down;
      if (k === 'shift') keys.current.shift = down;
    };

    window.addEventListener('keydown', onKey(true));
    window.addEventListener('keyup', onKey(false));

    return () => {
      window.removeEventListener('keydown', onKey(true));
      window.removeEventListener('keyup', onKey(false));
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const onPointerLockChange = () => {
      locked.current = document.pointerLockElement === gl.domElement;
    };

    const onMouseMove = (e) => {
      if (!locked.current) return;
      if (dragging) return;
      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      yaw.current -= mx * 0.0022;
      pitch.current -= my * 0.0022;
      pitch.current = clamp(pitch.current, -1.15, 1.15);
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);

    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
    };
  }, [dragging, gl.domElement]);

  useEffect(() => {
    // Click to lock pointer (desktop)
    if (isMobile) return;
    const el = gl.domElement;
    const onClick = () => {
      if (dragging) return;
      if (!document.pointerLockElement) {
        el.requestPointerLock?.();
      }
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [dragging, gl.domElement, isMobile]);

  useEffect(() => {
    // Touch look (mobile): drag on empty canvas to rotate
    if (!isMobile) return;
    const el = gl.domElement;

    const down = (e) => {
      if (!e.isPrimary) return;
      if (dragging) return;
      // Don’t steal if user is touching joystick area (handled by HTML)
      lastTouch.current.id = e.pointerId;
      lastTouch.current.x = e.clientX;
      lastTouch.current.y = e.clientY;
      lastTouch.current.active = true;
    };

    const move = (e) => {
      if (!lastTouch.current.active) return;
      if (lastTouch.current.id !== e.pointerId) return;
      if (dragging) return;
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
  }, [dragging, gl.domElement, isMobile]);

  const tmpForward = useMemo(() => new THREE.Vector3(), []);
  const tmpRight = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    // Apply look
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');

    // Move
    let mx = 0;
    let mz = 0;

    if (!isMobile) {
      mx += (keys.current.d ? 1 : 0) - (keys.current.a ? 1 : 0);
      mz += (keys.current.s ? 1 : 0) - (keys.current.w ? 1 : 0);
    }

    const joy = joystickRef?.current || { x: 0, y: 0 };
    // joystick y is screen down => forward is -y
    mx += joy.x;
    mz += joy.y;

    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;

    // speed
    const base = isMobile ? 3.0 : 3.5;
    const speed = (!isMobile && keys.current.shift) ? base * 1.65 : base;

    // Forward/right in XZ
    camera.getWorldDirection(tmpForward);
    tmpForward.y = 0;
    tmpForward.normalize();
    tmpRight.set(tmpForward.z, 0, -tmpForward.x);

    // mz positive means move backward; we want W (mz negative) forward, but we already set mz from joy
    const vx = (tmpRight.x * mx + tmpForward.x * mz) * speed;
    const vz = (tmpRight.z * mx + tmpForward.z * mz) * speed;

    camera.position.x += vx * dt;
    camera.position.z += vz * dt;

    // keep inside room
    camera.position.x = clamp(camera.position.x, ROOM_BOUNDS.minX + 0.6, ROOM_BOUNDS.maxX - 0.6);
    camera.position.z = clamp(camera.position.z, ROOM_BOUNDS.minZ + 0.6, ROOM_BOUNDS.maxZ - 0.6);

    // gentle head bob
    camera.position.y = 1.65 + Math.sin(performance.now() * 0.004) * 0.03 * (Math.abs(mx) + Math.abs(mz) > 0.1 ? 1 : 0);
  });

  return null;
}

// -----------------------------
// Palace Room (floor + walls + dreamy extras)
// -----------------------------

function MindPalaceRoom({ bounds, rampTex }) {
  const floorMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: 0x07071c, gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const wallMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: 0x0e0e2a, gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;

  // cheap “god rays” = additive transparent cones
  const rayMat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9ab0ff),
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    return m;
  }, []);

  return (
    <group>
      {/* Floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} material={floorMat}>
        <planeGeometry args={[w + 6, d + 6]} />
      </mesh>

      {/* Soft grid */}
      <Grid
        position={[0, 0.02, 0]}
        args={[w + 2, d + 2]}
        cellSize={1}
        cellThickness={0.75}
        cellColor={'#3b4bff'}
        sectionSize={5}
        sectionThickness={1.15}
        sectionColor={'#1a1a44'}
        fadeDistance={22}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* Walls */}
      <mesh position={[0, 1.0, bounds.maxZ + 0.30]} material={wallMat}>
        <boxGeometry args={[w + 2.2, 2, 0.6]} />
      </mesh>
      <mesh position={[0, 1.0, bounds.minZ - 0.30]} material={wallMat}>
        <boxGeometry args={[w + 2.2, 2, 0.6]} />
      </mesh>
      <mesh position={[bounds.maxX + 0.30, 1.0, 0]} material={wallMat}>
        <boxGeometry args={[0.6, 2, d + 2.2]} />
      </mesh>
      <mesh position={[bounds.minX - 0.30, 1.0, 0]} material={wallMat}>
        <boxGeometry args={[0.6, 2, d + 2.2]} />
      </mesh>

      {/* Dreamy "god rays" cones */}
      <mesh position={[3.5, 2.4, 2.0]} rotation={[Math.PI, 0.4, 0]} material={rayMat}>
        <coneGeometry args={[2.8, 4.8, 18, 1, true]} />
      </mesh>
      <mesh position={[-3.8, 2.5, -1.0]} rotation={[Math.PI, -0.6, 0]} material={rayMat}>
        <coneGeometry args={[2.6, 4.2, 18, 1, true]} />
      </mesh>
      <mesh position={[0.0, 2.3, -4.2]} rotation={[Math.PI, 0.05, 0]} material={rayMat}>
        <coneGeometry args={[2.9, 5.0, 18, 1, true]} />
      </mesh>

      {/* Dust motes */}
      <Sparkles
        count={120}
        speed={0.25}
        opacity={0.30}
        scale={[w + 8, 2.8, d + 8]}
        size={1.4}
        color={'#cbd7ff'}
      />
    </group>
  );
}

// -----------------------------
// Palace Pet (AI + interaction + petting)
// -----------------------------

const BASE_Y = 0.55;

function PalacePet({
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
  chaseModeRef
}) {
  const { size, camera } = useThree();
  const isMobile = useIsMobile();

  const { bodyGeo, headGeo, detailGeo, tailGeo, earGeo, faceGeo, hitGeo } = useMemo(
    () => getPetGeometries(pet.speciesKey),
    [pet.speciesKey]
  );

  const bodyMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color(pet.bodyColor), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [pet.bodyColor, rampTex]);

  const detailMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: rampTex, vertexColors: true });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const blobMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.86, depthWrite: false });
  }, [blobTex]);

  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false }), []);

  // Eye shader material per pet (uniforms are unique)
  const eyeMat = useMemo(() => createEyeShaderMaterial(), []);

  // Refs
  const headRef = useRef();
  const tailRef = useRef();
  const earsRef = useRef();

  // Pose state
  const pos = useRef(new THREE.Vector3(pet.position[0], BASE_Y, pet.position[1]));
  const vel = useRef(new THREE.Vector3());
  const yaw = useRef(pet.yaw ?? 0);

  // Interaction
  const heldRef = useRef(false);
  const hoverRef = useRef(false);

  // Petting “rub” tracker
  const petting = useRef({
    active: false,
    lastX: 0,
    lastDir: 0,
    flips: 0,
    t: 0,
    love: 0,
    emitT: 0
  });

  // Brain state machine
  const brain = useRef({
    mode: 'wandering', // wandering | socializing | resting | curious | held | chasing | running | sleeping
    t: 0,
    seed: Math.floor((pet.seed ?? 1) * 9999) % 10000,
    walkS: 0,
    target: new THREE.Vector3(),
    restSpot: new THREE.Vector3(),
    lastInteractAt: 0
  });

  // Social state set by manager
  const social = useRef({ active: false, until: 0, partnerId: null, partnerPos: new THREE.Vector3(), facePartnerYaw: 0 });

  // Spring: position, rotation, scale, lift
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
      getPose: () => ({ x: pos.current.x, z: pos.current.z, yaw: yaw.current, mode: brain.current.mode }),
      setSocial: ({ active, until, partnerId, partnerPos }) => {
        social.current.active = active;
        social.current.until = until;
        social.current.partnerId = partnerId;
        if (partnerPos) {
          social.current.partnerPos.copy(partnerPos);
          // cache partner yaw target
          const dx = partnerPos.x - pos.current.x;
          const dz = partnerPos.z - pos.current.z;
          social.current.facePartnerYaw = Math.atan2(dx, dz);
        }
      },
      greet: () => {
        // synced hop + squish
        api.start({ lift: 0.42, s: [1.16, 0.84, 1.16], config: { mass: 1.0, tension: 320, friction: 22 } });
        setTimeout(() => api.start({ lift: 0, s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } }), 220);
      },
      forceMode: (m, durationS = 1) => {
        brain.current.mode = m;
        brain.current.t = durationS;
      }
    });
  }, [api, pet.id, registerAPI]);

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

    // tap feedback: hop + spin + squish + a couple hearts
    api.start({
      lift: 0.58,
      r: [0, yaw.current + Math.PI * 2, 0],
      s: [1.18, 0.82, 1.18],
      config: { mass: 1.0, tension: 340, friction: 22 }
    });

    const emitter = getHeartEmitter?.();
    if (emitter?.emit) emitter.emit(pos.current.clone(), 2);

    setTimeout(() => {
      api.start({ lift: 0, s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } });
    }, 240);
  }, [api, getHeartEmitter]);

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

        // Dangle squish
        api.start({ s: [0.92, 1.10, 0.92], config: { mass: 1.05, tension: 360, friction: 24 } });
      }

      if (active && event?.clientX != null && event?.clientY != null) {
        plane.constant = -1.5;
        setFromClient(event.clientX, event.clientY);
        if (raycaster.ray.intersectPlane(plane, hit)) {
          const x = clamp(hit.x, bounds.minX, bounds.maxX);
          const z = clamp(hit.z, bounds.minZ, bounds.maxZ);
          pos.current.set(x, 1.5, z);
          vel.current.set(0, 0, 0);

          api.start({
            p: [x, 1.5, z],
            config: { mass: 1.2, tension: 320, friction: 28 }
          });
        }
      }

      if (last || canceled) {
        heldRef.current = false;
        setDragging?.(null);

        // Drop to floor + bounce
        pos.current.y = BASE_Y;
        brain.current.mode = social.current.active ? 'socializing' : 'wandering';

        api.start({
          p: [pos.current.x, BASE_Y, pos.current.z],
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

  // AI update
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const steer = useMemo(() => new THREE.Vector3(), []);
  const sep = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const B = brain.current;

    // Social expiry
    if (social.current.active && t > social.current.until) {
      social.current.active = false;
      social.current.partnerId = null;
      if (!heldRef.current && B.mode === 'socializing') B.mode = 'wandering';
    }

    // Petting/Love decay and emit
    petting.current.love = Math.max(0, petting.current.love - dt * 0.55);
    if (petting.current.love > 0.2) {
      petting.current.emitT -= dt;
      if (petting.current.emitT <= 0) {
        petting.current.emitT = randRange(0.14, 0.22);
        const emitter = getHeartEmitter?.();
        if (emitter?.emit) emitter.emit(pos.current.clone(), 1);
      }
    }

    // Let manager put pets into chase/run modes
    const chase = chaseModeRef?.current;
    if (!heldRef.current && chase && chase.active) {
      if (chase.chaserId === pet.id) {
        B.mode = 'chasing';
        B.t = chase.until - t;
        B.target.set(chase.runnerPos.x, BASE_Y, chase.runnerPos.z);
      } else if (chase.runnerId === pet.id) {
        B.mode = 'running';
        B.t = chase.until - t;
        // run away from chaser
        B.target.set(pos.current.x, BASE_Y, pos.current.z);
      }
    }

    // If held: expressive wide eyes and look at camera
    if (heldRef.current) {
      eyeMat.uniforms.uWide.value = lerp(eyeMat.uniforms.uWide.value, 1.0, 0.18);
      eyeMat.uniforms.uHappy.value = lerp(eyeMat.uniforms.uHappy.value, 0.0, 0.12);
      eyeMat.uniforms.uBlink.value = lerp(eyeMat.uniforms.uBlink.value, 0.0, 0.25);

      // look at camera
      tmp.set(camera.position.x - pos.current.x, camera.position.y - (pos.current.y + 0.9), camera.position.z - pos.current.z);
      tmp.normalize();
      eyeMat.uniforms.uLook.value.set(tmp.x, -tmp.y);

      // head tilt / dangle wiggle
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

    // Determine if pet should follow the player (camera)
    const dxp = camera.position.x - pos.current.x;
    const dzp = camera.position.z - pos.current.z;
    const dPlayer2 = dxp * dxp + dzp * dzp;
    const shouldFollow = dPlayer2 > 64; // > 8 units

    // Social stops movement and faces partner
    if (social.current.active) {
      B.mode = 'socializing';
    }

    // Sleep logic (only if not interacted recently)
    const sinceInteract = (performance.now() * 0.001) - (B.lastInteractAt || 0);
    if (B.mode !== 'sleeping' && !social.current.active && !shouldFollow) {
      if (sinceInteract > PERSONALITY.sleepAfterNoInteractS && Math.random() < 0.035 * dt) {
        B.mode = 'sleeping';
        B.t = randRange(3.0, 6.0);
        const spot = pick(rugs);
        B.restSpot.set(spot[0], BASE_Y, spot[1]);
      }
    }

    // Timers
    B.t -= dt;

    // Switch states
    if (B.mode === 'wandering') {
      B.walkS += dt;
      if (!shouldFollow && B.walkS > PERSONALITY.restAfterWalkS && Math.random() < PERSONALITY.restChancePerS * dt) {
        B.mode = 'resting';
        B.t = randRange(PERSONALITY.restDuration[0], PERSONALITY.restDuration[1]);
        B.walkS = 0;
        const spot = pick(rugs);
        B.restSpot.set(spot[0], BASE_Y, spot[1]);
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

    // Boid separation (simple repulsion from other pets)
    sep.set(0, 0, 0);
    const map = getPosMap?.();
    if (map) {
      for (const [id, p2] of map) {
        if (id === pet.id) continue;
        const ox = pos.current.x - p2.x;
        const oz = pos.current.z - p2.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 2.2 * 2.2 && d2 > 0.0001) {
          const inv = 1 / (Math.sqrt(d2) || 1);
          const push = (1.0 - Math.sqrt(d2) / 2.2) * 0.018;
          sep.x += ox * inv * push;
          sep.z += oz * inv * push;
        }
      }
    }

    // AI motion based on state
    if (B.mode === 'socializing') {
      vel.current.multiplyScalar(Math.pow(0.72, dt * 60));
      yaw.current = dampAngle(yaw.current, social.current.facePartnerYaw, 0.14);
    } else if (B.mode === 'curious') {
      // Soft stop + look at player
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
      // Move toward player, but keep a small offset behind
      tmp.set(dxp, 0, dzp);
      const d = tmp.length();
      if (d > 0.001) tmp.multiplyScalar(1 / d);
      const speed = isMobile ? 1.55 : 1.75;
      vel.current.x += tmp.x * speed * dt * 3.2;
      vel.current.z += tmp.z * speed * dt * 3.2;
      vel.current.x *= Math.pow(0.86, dt * 60);
      vel.current.z *= Math.pow(0.86, dt * 60);
      const targetYaw = Math.atan2(vel.current.x, vel.current.z);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.11);
    } else if (B.mode === 'chasing') {
      // Chase runner
      tmp.set(B.target.x - pos.current.x, 0, B.target.z - pos.current.z);
      const d = tmp.length();
      if (d > 0.001) tmp.multiplyScalar(1 / d);
      const speed = 2.10;
      vel.current.x += tmp.x * speed * dt * 3.0;
      vel.current.z += tmp.z * speed * dt * 3.0;
      vel.current.x *= Math.pow(0.86, dt * 60);
      vel.current.z *= Math.pow(0.86, dt * 60);
      const targetYaw = Math.atan2(vel.current.x, vel.current.z);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.13);
    } else if (B.mode === 'running') {
      // Run away from chaser
      const ch = chase?.chaserPos;
      if (ch) {
        tmp.set(pos.current.x - ch.x, 0, pos.current.z - ch.z);
        const d = tmp.length();
        if (d > 0.001) tmp.multiplyScalar(1 / d);
        const speed = 2.15;
        vel.current.x += tmp.x * speed * dt * 3.0;
        vel.current.z += tmp.z * speed * dt * 3.0;
        vel.current.x *= Math.pow(0.86, dt * 60);
        vel.current.z *= Math.pow(0.86, dt * 60);
        const targetYaw = Math.atan2(vel.current.x, vel.current.z);
        if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.13);
      }
    } else {
      // Wandering: perlin-ish direction + wall avoidance
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

      tmp.addScaledVector(steer, 1.35);
      tmp.addScaledVector(sep, 1.0);
      const l2 = tmp.length();
      if (l2 > 0.001) tmp.multiplyScalar(1 / l2);

      const speed = 1.25;
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
    pos.current.y = BASE_Y;

    // Waddle locomotion
    const speed2 = vel.current.x * vel.current.x + vel.current.z * vel.current.z;
    const moving = speed2 > 0.0008 && !social.current.active && B.mode !== 'curious' && B.mode !== 'sleeping';
    const bob = moving ? Math.sin(t * 6.0 + pet.seed) * 0.045 : Math.sin(t * 2.0 + pet.seed) * 0.016;
    const rock = moving ? Math.sin(t * 6.0 + pet.seed) * 0.06 : 0;

    // Sit/sleep scale
    const nearRest = (B.mode === 'resting' || B.mode === 'sleeping') && tmp.set(B.restSpot.x - pos.current.x, 0, B.restSpot.z - pos.current.z).length() < 0.25;
    const sit = nearRest && (B.mode === 'resting');
    const sleep = nearRest && (B.mode === 'sleeping');
    const sitScale = sit ? [1.06, 0.84, 1.06] : sleep ? [1.10, 0.78, 1.10] : [1, 1, 1];

    api.start({ p: [pos.current.x, BASE_Y + bob, pos.current.z], r: [rock, yaw.current, 0], s: sitScale, immediate: true });

    // Face expression: blink + happy from petting
    // Soft idle blink
    const blinkBase = 0.5 + 0.5 * Math.sin(t * 0.9 + pet.seed);
    const blinkPulse = smoothstep(0.94, 1.0, blinkBase) * 0.9;

    const love = petting.current.love;
    const happy = clamp((love - 0.25) * 1.4, 0, 1);

    // Sleep closes eyes
    const targetBlink = sleep ? 1.0 : Math.max(blinkPulse, clamp(love * 0.4, 0, 0.35));
    eyeMat.uniforms.uBlink.value = lerp(eyeMat.uniforms.uBlink.value, targetBlink, 0.18);
    eyeMat.uniforms.uHappy.value = lerp(eyeMat.uniforms.uHappy.value, happy, 0.12);
    eyeMat.uniforms.uWide.value = lerp(eyeMat.uniforms.uWide.value, 0.0, 0.12);

    // Look direction: towards camera when curious or hover, towards partner when social
    let lookX = 0;
    let lookY = 0;
    if (social.current.active) {
      tmp.set(social.current.partnerPos.x - pos.current.x, 0.2, social.current.partnerPos.z - pos.current.z).normalize();
      lookX = tmp.x;
      lookY = -tmp.y;
    } else if (B.mode === 'curious' || hoverRef.current || petting.current.love > 0.25) {
      tmp.set(dxp, camera.position.y - (pos.current.y + 0.9), dzp).normalize();
      lookX = tmp.x;
      lookY = -tmp.y;
    }
    eyeMat.uniforms.uLook.value.set(lerp(eyeMat.uniforms.uLook.value.x, lookX, 0.10), lerp(eyeMat.uniforms.uLook.value.y, lookY, 0.10));

    // Head tilt
    if (headRef.current) {
      const wantsTilt = (B.mode === 'curious') || hoverRef.current || (love > 0.25);
      const tilt = wantsTilt ? 0.22 : 0.10;
      headRef.current.rotation.z = lerp(headRef.current.rotation.z, rock * 0.35, 0.16);
      headRef.current.rotation.x = lerp(headRef.current.rotation.x, (B.mode === 'curious' ? -tilt : -0.08) + (hoverRef.current ? 0.06 : 0) + (love > 0.25 ? 0.05 : 0), 0.18);
    }

    // Tail wag
    if (tailRef.current) {
      const wagSpeed = moving ? 7.2 : 4.2;
      const wagAmp = moving ? 0.70 : 0.45;
      tailRef.current.rotation.y = Math.sin(t * wagSpeed) * wagAmp;
      tailRef.current.rotation.x = Math.cos(t * wagSpeed * 0.5) * 0.12;
    }

    // Ear twitch (instanced matrices)
    if (earsRef.current) {
      const twitch = Math.sin(t * 6.5 + pet.seed) * 0.12;
      const m1 = new THREE.Matrix4();
      const m2 = new THREE.Matrix4();
      const left = new THREE.Object3D();
      const right = new THREE.Object3D();

      const sp = SPECIES[pet.speciesKey] || SPECIES.cat;
      const earY = sp.ear === 'long' ? 1.55 : 1.35;
      const earZ = sp.ear === 'floppy' ? 0.10 : 0.16;
      const earSX = sp.ear === 'long' ? 0.85 : 1.0;
      const earSY = sp.ear === 'long' ? 1.75 : 1.0;

      left.position.set(-0.30, earY, earZ);
      right.position.set(0.30, earY, earZ);
      left.scale.set(earSX, earSY, 0.95);
      right.scale.set(earSX, earSY, 0.95);

      if (sp.ear === 'pointy') {
        left.rotation.set(0, 0, 0.45 + twitch * 0.35);
        right.rotation.set(0, 0, -0.45 - twitch * 0.35);
      } else if (sp.ear === 'floppy') {
        left.rotation.set(0.2, 0, 0.85 + twitch * 0.25);
        right.rotation.set(0.2, 0, -0.85 - twitch * 0.25);
      } else {
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

  // Petting detection via pointer move over hitbox
  const onPetMove = useCallback((e) => {
    if (heldRef.current) return;
    // Track local X motion as a proxy for "rubbing"
    const localX = e.point.x;
    const dx = localX - petting.current.lastX;
    petting.current.lastX = localX;

    const dir = dx > 0.003 ? 1 : dx < -0.003 ? -1 : 0;
    if (dir !== 0 && petting.current.lastDir !== 0 && dir !== petting.current.lastDir) {
      petting.current.flips++;
    }
    if (dir !== 0) petting.current.lastDir = dir;

    petting.current.t += e.delta ? e.delta : 0;

    // If enough back-and-forth flips quickly, increase love
    if (petting.current.flips >= 3) {
      petting.current.flips = 0;
      petting.current.love = clamp(petting.current.love + 0.22, 0, 1);
      brain.current.lastInteractAt = performance.now() * 0.001;

      // Gentle relax squash
      api.start({ s: [1.06, 0.90, 1.06], config: { mass: 1.0, tension: 200, friction: 22 } });
      setTimeout(() => api.start({ s: [1, 1, 1], config: { mass: 1.0, tension: 240, friction: 26 } }), 160);
    }
  }, [api]);

  return (
    <a.group
      {...bind()}
      position={p.to((x, y, z) => [x, y + lift.get(), z])}
      rotation={r}
      scale={s}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverRef.current = true;
        document.body.style.cursor = 'pointer';
        onHover?.(pet);
      }}
      onPointerOut={() => {
        hoverRef.current = false;
        document.body.style.cursor = 'default';
        onHover?.(null);
      }}
    >
      {/* Blob shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} material={blobMat}>
        <planeGeometry args={[1.75, 1.75]} />
      </mesh>

      {/* Body + details (2 draw calls) */}
      <mesh geometry={bodyGeo} material={bodyMat} />
      <mesh geometry={detailGeo} material={detailMat} />

      {/* Head group for tilt */}
      <group ref={headRef}>
        <mesh geometry={headGeo} material={bodyMat} />

        {/* Eyes plane (shader) */}
        <mesh
          geometry={faceGeo}
          material={eyeMat}
          position={[0, 1.02, 0.63]}
          rotation={[0, 0, 0]}
        />

        {/* Ears instanced (1 draw call) */}
        <instancedMesh ref={earsRef} args={[earGeo, bodyMat, 2]} />
      </group>

      {/* Tail group for wag */}
      <group ref={tailRef}>
        <mesh geometry={tailGeo} material={bodyMat} />
      </group>

      {/* Hitbox: easier interaction + petting detection */}
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
// PetManager (persistence + social + chase system)
// -----------------------------

function PetManager({ bounds, rugs, isMobile, rampTex, blobTex, joystickRef, draggingIdRef, cameraRef }) {
  const maxPets = isMobile ? 5 : 10;

  const [pets, setPets] = useState(() => safeLoadPets() ?? defaultPets());
  const petsRef = useRef(pets);

  // Pet APIs for manager
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

  // Chase mode (proxemics upgrade)
  const chaseModeRef = useRef({ active: false, until: 0, chaserId: null, runnerId: null, runnerPos: new THREE.Vector3(), chaserPos: new THREE.Vector3() });

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

  const addPet = useCallback(() => {
    setPets((prev) => {
      if (prev.length >= maxPets) return prev;
      return [...prev, makePet(prev.length + 1)];
    });
  }, [maxPets]);

  const resetPets = useCallback(() => {
    setPets(defaultPets());
  }, []);

  // Social cooldown
  const pairCooldown = useRef(new Map());
  const frameCounter = useRef(0);

  useFrame((state) => {
    frameCounter.current++;
    const t = state.clock.getElapsedTime();

    // Snapshot poses each frame (for separation + chasing)
    const arr = petsRef.current;
    posMapRef.current.clear();
    for (const p of arr) {
      const api = apiRef.current.get(p.id);
      const pose = api?.getPose?.();
      if (!pose) continue;
      posMapRef.current.set(p.id, { x: pose.x, z: pose.z, yaw: pose.yaw, mode: pose.mode });
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
      // Occasionally start a chase burst (proxemics)
      if (arr.length >= 2 && Math.random() < PERSONALITY.chaseChancePerS * (1 / 60)) {
        const a = pick(arr);
        let b = pick(arr);
        let guard = 0;
        while (b.id === a.id && guard++ < 5) b = pick(arr);
        chaseModeRef.current.active = true;
        chaseModeRef.current.chaserId = a.id;
        chaseModeRef.current.runnerId = b.id;
        chaseModeRef.current.until = t + randRange(PERSONALITY.chaseDuration[0], PERSONALITY.chaseDuration[1]);
      }
    }

    // Social proximity checks (every N frames)
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

        // Ignore if either is being dragged or chasing
        if (draggingIdRef?.current && (draggingIdRef.current === a.id || draggingIdRef.current === b.id)) continue;
        if (chaseModeRef.current.active && (a.id === chaseModeRef.current.chaserId || a.id === chaseModeRef.current.runnerId || b.id === chaseModeRef.current.chaserId || b.id === chaseModeRef.current.runnerId)) continue;

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

          // Bonus: if they greet, emit a few hearts
          heartEmitterRef.current?.emit?.(new THREE.Vector3((pa.x + pb.x) * 0.5, BASE_Y, (pa.z + pb.z) * 0.5), 2);
        }
      }
    }
  });

  // Accurate persistence sampling
  useFrame((state, dt) => {
    const saver = (PetManager._saver ||= { t: 0 });
    saver.t += dt;
    if (saver.t < 1.5) return;
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

  return (
    <>
      <Html fullscreen style={{ pointerEvents: 'none' }}>
        {/* HUD */}
        <div className="fixed top-3 left-3 z-[60] max-w-[92vw] text-white pointer-events-auto">
          <div className="rounded-2xl border border-white/10 bg-white/10 backdrop-blur-md px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold leading-tight">Palace Pets</div>
                <div className="text-xs text-white/70">Free-roam Mind Palace companions</div>
                <div className="mt-1 text-[11px] text-white/50">Saved to localStorage • {pets.length} pet(s)</div>
              </div>
              <div className="text-[11px] rounded-full px-2 py-1 border border-white/10 bg-white/10">
                {isMobile ? 'MOBILE LITE' : 'DESKTOP'}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm"
                onClick={addPet}
              >
                + Add Pet
              </button>
              <button
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-sm"
                onClick={resetPets}
              >
                Reset
              </button>
            </div>

            <div className="mt-3 text-[11px] text-white/60 space-y-1">
              <div><b>Desktop</b>: Click canvas to lock mouse • WASD to walk • Shift to sprint</div>
              <div><b>Mobile</b>: Joystick to move • Drag empty space to look</div>
              <div><b>Pet</b>: Tap = hop + hearts • Drag = carry • Rub = purr + love</div>
              <div><b>Social</b>: greet within {SOCIAL_DISTANCE}u (check {SOCIAL_CHECK_EVERY_FRAMES} frames), cooldown {SOCIAL_COOLDOWN_S}s</div>
            </div>

            <div className="mt-2 text-[12px] text-cyan-200 min-h-[16px]">
              {hovered ? (
                <span><b>{SPECIES[hovered.speciesKey]?.label ?? 'Pet'}</b> — {hovered.name}</span>
              ) : (
                <span className="text-white/50">Hover a pet to see its name</span>
              )}
            </div>
          </div>
        </div>

        {/* Vignette */}
        <div
          className="fixed inset-0 pointer-events-none z-[55]"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)'
          }}
        />
      </Html>

      {/* Hearts pool */}
      <HeartPool getEmitterRef={(api) => (heartEmitterRef.current = api)} />

      {pets.map((p) => (
        <PalacePet
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
            if (draggingIdRef) draggingIdRef.current = idOrNull;
          }}
          getPosMap={getPosMap}
          getHeartEmitter={() => heartEmitterRef.current}
          chaseModeRef={chaseModeRef}
        />
      ))}
    </>
  );
}

// -----------------------------
// Main export
// -----------------------------

export default function SpacePets() {
  const isMobile = useIsMobile();

  const bounds = useMemo(() => ({ ...ROOM_BOUNDS }), []);

  // Rugs = rest spots
  const rugs = useMemo(() => {
    return [
      [-6, -6],
      [6, -6],
      [-6, 6],
      [6, 6],
      [0, 0]
    ];
  }, []);

  // Shared textures
  const rampTex = useToonRampTexture();
  const blobTex = useBlobShadowTexture();

  // Mobile joystick state
  const joystickRef = useRef({ x: 0, y: 0 });
  const draggingIdRef = useRef(null);

  return (
    <div className="w-screen h-screen overflow-hidden bg-gradient-to-b from-[#1a1a4a] via-[#07071c] to-black">
      {/* Mobile joystick */}
      {isMobile && (
        <VirtualJoystick
          onChange={(v) => {
            joystickRef.current = v;
          }}
        />
      )}

      <Canvas
        dpr={isMobile ? 1 : [1, 2]}
        gl={{ antialias: !isMobile, powerPreference: 'high-performance', alpha: false }}
        camera={{ position: [0, 1.65, 6.5], fov: 60, near: 0.1, far: 80 }}
      >
        <color attach="background" args={['#050510']} />
        <fog attach="fog" args={['#050510', 10, 42]} />

        {/* Toony lighting (no shadows) */}
        <ambientLight intensity={0.85} color={'#8899ff'} />
        <directionalLight intensity={1.0} position={[7, 10, 5]} color={'#ffffff'} />
        <directionalLight intensity={0.40} position={[-6, 7, -8]} color={'#6688ff'} />

        {/* Stars */}
        <Stars radius={55} depth={28} count={isMobile ? 300 : 900} factor={isMobile ? 2 : 2.4} saturation={0} fade speed={0.35} />

        <MindPalaceRoom bounds={bounds} rampTex={rampTex} />

        {/* Player controller */}
        <PlayerController dragging={!!draggingIdRef.current} joystickRef={joystickRef} />

        {/* Pets */}
        <PetManager
          bounds={bounds}
          rugs={rugs}
          isMobile={isMobile}
          rampTex={rampTex}
          blobTex={blobTex}
          joystickRef={joystickRef}
          draggingIdRef={draggingIdRef}
        />
      </Canvas>
    </div>
  );
}