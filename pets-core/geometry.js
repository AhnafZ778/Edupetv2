/**
 * @fileoverview Procedural geometry generation with caching for Mind Palace Pets
 * @module pets-core/geometry
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getSpecies } from './species.js';

/** @type {Map<string, Object>} Global geometry cache */
const GEO_CACHE = new Map();

/**
 * Get the merge function from BufferGeometryUtils
 * @returns {Function} Merge geometries function
 */
function getMergeFn() {
  return BufferGeometryUtils.mergeGeometries || BufferGeometryUtils.mergeBufferGeometries;
}

/**
 * Apply vertex colors to a geometry
 * @param {THREE.BufferGeometry} geo - Geometry to color
 * @param {number} hex - Hex color value
 * @returns {THREE.BufferGeometry} Colored geometry
 */
export function applyVertexColor(geo, hex) {
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

/**
 * Ensure wing attributes exist on geometry (for dragon flapping)
 * @param {THREE.BufferGeometry} geo - Geometry
 * @returns {THREE.BufferGeometry} Geometry with wing attributes
 */
function ensureWingAttrs(geo) {
  const pos = geo.getAttribute('position');
  if (!geo.getAttribute('aWing')) {
    geo.setAttribute('aWing', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  }
  if (!geo.getAttribute('aSide')) {
    geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(pos.count), 1));
  }
  return geo;
}

/**
 * Set wing attributes for dragon wing geometry
 * @param {THREE.BufferGeometry} geo - Wing geometry
 * @param {number} wingFlag - Wing flag (0 or 1)
 * @param {number} sideVal - Side value (-1 for left, 1 for right)
 * @returns {THREE.BufferGeometry} Geometry with wing attributes
 */
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

/**
 * Get cached pet geometries for a species
 * @param {string} speciesKey - Species key
 * @returns {Object} Object containing all geometry parts
 */
export function getPetGeometries(speciesKey) {
  const key = speciesKey || 'cat';
  const cached = GEO_CACHE.get(key);
  if (cached) return cached;

  const sp = getSpecies(key);
  const merge = getMergeFn();
  const scale = sp.scale || 1;
  const seg = 2; // Low-poly for mobile

  // Body parts
  const bodyParts = [];
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

  // Head parts
  const headParts = [];
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

  // Detail parts (vertex colors)
  const detailParts = [];

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

  // Species-specific details
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

    // Sideburns
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

  if (key === 'wolf') {
    // Ruff spikes
    const spike = new THREE.ConeGeometry(0.10 * scale, 0.22 * scale, 6, 1);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const s = spike.clone();
      s.rotateX(Math.PI);
      s.translate(Math.cos(a) * 0.42 * scale, 0.90 * scale, Math.sin(a) * 0.20 * scale);
      applyVertexColor(s, i % 2 === 0 ? 0xcfe9ff : 0xb8c0c8);
      detailParts.push(s);
    }

    // Muzzle
    const muzzle = new RoundedBoxGeometry(0.34 * scale, 0.20 * scale, 0.44 * scale, seg, 0.10 * scale);
    muzzle.translate(0, 0.92 * scale, 0.68 * scale);
    applyVertexColor(muzzle, 0xfefae0);
    detailParts.push(muzzle);
  }

  // Dragon wings and horns
  const isDragon = key === 'dragon';
  if (isDragon) {
    for (const g of bodyParts) ensureWingAttrs(g);
    for (const g of headParts) ensureWingAttrs(g);
    for (const g of detailParts) ensureWingAttrs(g);

    const wing = new RoundedBoxGeometry(0.90 * scale, 0.08 * scale, 0.55 * scale, seg, 0.06 * scale);
    const wL = wing.clone();
    wL.translate(-0.85 * scale, 0.92 * scale, -0.15 * scale);
    setWingAttributes(wL, 1, -1);
    bodyParts.push(wL);
    const wR = wing.clone();
    wR.translate(0.85 * scale, 0.92 * scale, -0.15 * scale);
    setWingAttributes(wR, 1, 1);
    bodyParts.push(wR);

    // Horns
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
    for (const g of bodyParts) ensureWingAttrs(g);
    for (const g of headParts) ensureWingAttrs(g);
    for (const g of detailParts) ensureWingAttrs(g);
  }

  // Tail
  let tailGeo;
  if (sp.tail === 'pom') {
    tailGeo = new THREE.SphereGeometry(0.14 * scale, 8, 6);
    tailGeo.translate(0, 0.82 * scale, -0.44 * scale);
  } else {
    const long = sp.tail === 'long';
    const tail = new RoundedBoxGeometry(
      long ? 0.16 * scale : 0.18 * scale, 
      long ? 0.56 * scale : 0.36 * scale, 
      0.16 * scale, seg, 0.10 * scale
    );
    tail.rotateX(Math.PI * 0.18);
    tail.translate(0, 0.80 * scale, -0.46 * scale);
    tailGeo = tail;
  }

  // Ears (instanced)
  const earGeo = new RoundedBoxGeometry(0.18 * scale, 0.32 * scale, 0.14 * scale, seg, 0.10 * scale);

  // Face plane for eyes shader
  const faceGeo = new THREE.PlaneGeometry(0.95 * scale, 0.60 * scale, 1, 1);

  // Hitbox for interaction
  const hitGeo = new RoundedBoxGeometry(1.55 * scale, 1.35 * scale, 1.55 * scale, 1, 0.25 * scale);
  hitGeo.translate(0, 0.90 * scale, 0.15 * scale);

  // Merge geometries
  const bodyGeo = merge ? merge(bodyParts, false) : new THREE.BoxGeometry(1, 1, 1);
  const headGeo = merge ? merge(headParts, false) : new THREE.BoxGeometry(1, 1, 1);
  const detailGeo = merge ? merge(detailParts, false) : new THREE.BoxGeometry(0.01, 0.01, 0.01);

  if (bodyGeo.computeVertexNormals) {
    bodyGeo.computeVertexNormals();
    headGeo.computeVertexNormals();
    detailGeo.computeVertexNormals();
  }

  if (bodyGeo.computeBoundingSphere) {
    bodyGeo.computeBoundingSphere();
    headGeo.computeBoundingSphere();
  }

  const result = { bodyGeo, headGeo, detailGeo, tailGeo, earGeo, faceGeo, hitGeo };
  GEO_CACHE.set(key, result);
  return result;
}

/**
 * Clear geometry cache (for hot-reload scenarios)
 */
export function clearGeometryCache() {
  for (const [, geos] of GEO_CACHE) {
    Object.values(geos).forEach(geo => geo?.dispose?.());
  }
  GEO_CACHE.clear();
}
