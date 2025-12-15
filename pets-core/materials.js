/**
 * @fileoverview Toon materials and shader definitions for Mind Palace Pets
 * @module pets-core/materials
 */

import * as THREE from 'three';

/** @type {Map<string, THREE.Material>} Global material cache */
const MAT_CACHE = new Map();

/**
 * Create eye shader material with SDF-based rendering
 * @returns {THREE.ShaderMaterial} Eye material with uniforms
 */
export function createEyeShaderMaterial() {
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

/**
 * Create heart particle shader material
 * @returns {THREE.ShaderMaterial} Heart material
 */
export function createHeartMaterial() {
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

/**
 * Get cached toon material
 * @param {THREE.Texture} rampTex - Gradient ramp texture
 * @param {number} hex - Color hex value
 * @param {string} [keyExtra=''] - Extra cache key identifier
 * @returns {THREE.MeshToonMaterial} Cached toon material
 */
export function getToonMat(rampTex, hex, keyExtra = '') {
  const k = String(hex) + '|' + keyExtra;
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

/**
 * Get cached detail material (vertex colors)
 * @param {THREE.Texture} rampTex - Gradient ramp texture
 * @returns {THREE.MeshToonMaterial} Detail material
 */
export function getDetailMat(rampTex) {
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

/**
 * Get cached blob shadow material
 * @param {THREE.Texture} blobTex - Blob shadow texture
 * @returns {THREE.MeshBasicMaterial} Blob material
 */
export function getBlobMat(blobTex) {
  const k = 'blob|' + blobTex.uuid;
  const cached = MAT_CACHE.get(k);
  if (cached) return cached;
  
  const m = new THREE.MeshBasicMaterial({ 
    map: blobTex, 
    transparent: true, 
    opacity: 0.8, 
    depthWrite: false 
  });
  MAT_CACHE.set(k, m);
  return m;
}

/**
 * Patch material for dragon wing flapping animation
 * @param {THREE.MeshToonMaterial} mat - Material to patch
 */
export function patchDragonFlapMaterial(mat) {
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

/**
 * Clear material cache
 */
export function clearMaterialCache() {
  for (const [, mat] of MAT_CACHE) {
    mat?.dispose?.();
  }
  MAT_CACHE.clear();
}
