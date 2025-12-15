/**
 * @fileoverview Procedural accessory geometry generation
 * @module pets-core/customization/accessories
 */

import * as THREE from 'three';

/**
 * @typedef {Object} AccessoryConfig
 * @property {string} id - Accessory ID
 * @property {string} name - Display name
 * @property {'hat'|'collar'|'wings'|'bow'|'glasses'} slot - Accessory slot
 * @property {string} variant - Style variant
 * @property {number} [color] - Custom color (optional)
 */

/**
 * Accessory definitions
 */
export const ACCESSORIES = {
  // Hats
  topHat: { id: 'topHat', name: 'Top Hat', slot: 'hat', variant: 'cylinder' },
  partyHat: { id: 'partyHat', name: 'Party Hat', slot: 'hat', variant: 'cone' },
  crown: { id: 'crown', name: 'Crown', slot: 'hat', variant: 'crown' },
  beret: { id: 'beret', name: 'Beret', slot: 'hat', variant: 'beret' },
  wizardHat: { id: 'wizardHat', name: 'Wizard Hat', slot: 'hat', variant: 'wizard' },
  
  // Collars
  basicCollar: { id: 'basicCollar', name: 'Basic Collar', slot: 'collar', variant: 'basic' },
  bellCollar: { id: 'bellCollar', name: 'Bell Collar', slot: 'collar', variant: 'bell' },
  spikeCollar: { id: 'spikeCollar', name: 'Spike Collar', slot: 'collar', variant: 'spike' },
  bowtie: { id: 'bowtie', name: 'Bow Tie', slot: 'collar', variant: 'bowtie' },
  
  // Wings
  angelWings: { id: 'angelWings', name: 'Angel Wings', slot: 'wings', variant: 'angel' },
  batWings: { id: 'batWings', name: 'Bat Wings', slot: 'wings', variant: 'bat' },
  butterflyWings: { id: 'butterflyWings', name: 'Butterfly Wings', slot: 'wings', variant: 'butterfly' },
  
  // Bows
  headBow: { id: 'headBow', name: 'Head Bow', slot: 'bow', variant: 'ribbon' },
  
  // Glasses
  roundGlasses: { id: 'roundGlasses', name: 'Round Glasses', slot: 'glasses', variant: 'round' },
  starGlasses: { id: 'starGlasses', name: 'Star Glasses', slot: 'glasses', variant: 'star' }
};

// Geometry cache
const GEO_CACHE = new Map();

/**
 * Get or create cached geometry
 * @param {string} key - Cache key
 * @param {Function} createFn - Factory function
 * @returns {THREE.BufferGeometry} Geometry
 */
function getCachedGeo(key, createFn) {
  if (!GEO_CACHE.has(key)) {
    GEO_CACHE.set(key, createFn());
  }
  return GEO_CACHE.get(key);
}

/**
 * Create hat geometry
 * @param {string} variant - Hat variant
 * @returns {THREE.BufferGeometry} Hat geometry
 */
export function createHatGeometry(variant = 'cone') {
  return getCachedGeo(`hat_${variant}`, () => {
    switch (variant) {
      case 'cylinder': // Top hat
        const brim = new THREE.CylinderGeometry(0.28, 0.28, 0.04, 12);
        brim.translate(0, 0.02, 0);
        const top = new THREE.CylinderGeometry(0.18, 0.20, 0.30, 12);
        top.translate(0, 0.19, 0);
        return mergeGeos([brim, top]);
        
      case 'cone': // Party hat
        const cone = new THREE.ConeGeometry(0.18, 0.35, 12);
        cone.translate(0, 0.175, 0);
        return cone;
        
      case 'crown': // Crown
        const base = new THREE.CylinderGeometry(0.20, 0.22, 0.12, 6);
        base.translate(0, 0.06, 0);
        // Add points
        const points = [];
        for (let i = 0; i < 5; i++) {
          const point = new THREE.ConeGeometry(0.04, 0.10, 4);
          const angle = (i / 5) * Math.PI * 2;
          point.translate(Math.cos(angle) * 0.16, 0.17, Math.sin(angle) * 0.16);
          points.push(point);
        }
        return mergeGeos([base, ...points]);
        
      case 'beret': // Beret
        const beret = new THREE.SphereGeometry(0.20, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        beret.scale(1, 0.4, 1);
        beret.translate(0.05, 0.02, 0);
        return beret;
        
      case 'wizard': // Wizard hat
        const wizardCone = new THREE.ConeGeometry(0.22, 0.50, 12);
        wizardCone.translate(0, 0.25, 0);
        // Bend the tip
        const positions = wizardCone.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i);
          if (y > 0.3) {
            positions.setX(i, positions.getX(i) + (y - 0.3) * 0.3);
          }
        }
        positions.needsUpdate = true;
        return wizardCone;
        
      default:
        return new THREE.ConeGeometry(0.18, 0.30, 12);
    }
  });
}

/**
 * Create collar geometry
 * @param {string} variant - Collar variant
 * @returns {THREE.BufferGeometry} Collar geometry
 */
export function createCollarGeometry(variant = 'basic') {
  return getCachedGeo(`collar_${variant}`, () => {
    switch (variant) {
      case 'basic':
        return new THREE.TorusGeometry(0.22, 0.03, 8, 24);
        
      case 'bell':
        const ring = new THREE.TorusGeometry(0.22, 0.025, 8, 24);
        const bell = new THREE.SphereGeometry(0.06, 8, 6);
        bell.translate(0, -0.08, 0.20);
        return mergeGeos([ring, bell]);
        
      case 'spike':
        const spikeRing = new THREE.TorusGeometry(0.23, 0.03, 8, 24);
        const spikes = [];
        for (let i = 0; i < 6; i++) {
          const spike = new THREE.ConeGeometry(0.025, 0.08, 4);
          const angle = (i / 6) * Math.PI * 2;
          spike.rotateZ(-Math.PI / 2);
          spike.rotateY(angle);
          spike.translate(Math.cos(angle) * 0.27, 0, Math.sin(angle) * 0.27);
          spikes.push(spike);
        }
        return mergeGeos([spikeRing, ...spikes]);
        
      case 'bowtie':
        const left = new THREE.BoxGeometry(0.12, 0.08, 0.03);
        left.translate(-0.06, 0, 0.22);
        left.rotateY(0.3);
        const right = new THREE.BoxGeometry(0.12, 0.08, 0.03);
        right.translate(0.06, 0, 0.22);
        right.rotateY(-0.3);
        const knot = new THREE.SphereGeometry(0.03, 6, 4);
        knot.translate(0, 0, 0.22);
        return mergeGeos([left, right, knot]);
        
      default:
        return new THREE.TorusGeometry(0.22, 0.03, 8, 24);
    }
  });
}

/**
 * Create wing geometry
 * @param {string} variant - Wing variant
 * @returns {{left: THREE.BufferGeometry, right: THREE.BufferGeometry}} Wing geometries
 */
export function createWingGeometry(variant = 'angel') {
  const leftKey = `wing_${variant}_left`;
  const rightKey = `wing_${variant}_right`;
  
  const createWing = (side) => {
    const flip = side === 'left' ? 1 : -1;
    
    switch (variant) {
      case 'angel': {
        // Feathered wing shape
        const wing = new THREE.PlaneGeometry(0.35, 0.25, 4, 3);
        const pos = wing.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          // Curve the wing
          pos.setZ(i, Math.abs(x) * 0.15);
          // Feather edges
          if (Math.abs(x) > 0.12) {
            pos.setY(i, y + Math.sin(x * 8) * 0.03);
          }
        }
        pos.needsUpdate = true;
        wing.translate(flip * 0.25, 0, 0);
        return wing;
      }
      case 'bat': {
        // Bat wing with webbing
        const wing = new THREE.PlaneGeometry(0.40, 0.30, 5, 3);
        const pos = wing.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          // Scalloped edge
          if (y < -0.08) {
            pos.setY(i, y + Math.sin(x * 12) * 0.05);
          }
          pos.setZ(i, Math.abs(x) * 0.1);
        }
        pos.needsUpdate = true;
        wing.translate(flip * 0.28, 0, 0);
        return wing;
      }
      case 'butterfly': {
        // Rounded butterfly wing
        const wing = new THREE.CircleGeometry(0.22, 16, 0, Math.PI);
        wing.rotateZ(flip * Math.PI / 2);
        wing.translate(flip * 0.20, 0.05, 0);
        return wing;
      }
      default:
        return new THREE.PlaneGeometry(0.30, 0.20);
    }
  };
  
  return {
    left: getCachedGeo(leftKey, () => createWing('left')),
    right: getCachedGeo(rightKey, () => createWing('right'))
  };
}

/**
 * Create glasses geometry
 * @param {string} variant - Glasses variant
 * @returns {THREE.BufferGeometry} Glasses geometry
 */
export function createGlassesGeometry(variant = 'round') {
  return getCachedGeo(`glasses_${variant}`, () => {
    switch (variant) {
      case 'round': {
        const leftLens = new THREE.TorusGeometry(0.08, 0.012, 6, 16);
        leftLens.translate(-0.11, 0, 0);
        const rightLens = new THREE.TorusGeometry(0.08, 0.012, 6, 16);
        rightLens.translate(0.11, 0, 0);
        const bridge = new THREE.CylinderGeometry(0.01, 0.01, 0.06, 6);
        bridge.rotateZ(Math.PI / 2);
        return mergeGeos([leftLens, rightLens, bridge]);
      }
      case 'star': {
        const createStar = (x) => {
          const star = new THREE.CircleGeometry(0.09, 5);
          star.rotateZ(Math.PI / 2);
          star.translate(x, 0, 0);
          return star;
        };
        const bridge = new THREE.CylinderGeometry(0.01, 0.01, 0.05, 6);
        bridge.rotateZ(Math.PI / 2);
        return mergeGeos([createStar(-0.11), createStar(0.11), bridge]);
      }
      default:
        return new THREE.TorusGeometry(0.08, 0.012, 6, 16);
    }
  });
}

/**
 * Create bow geometry
 * @returns {THREE.BufferGeometry} Bow geometry
 */
export function createBowGeometry() {
  return getCachedGeo('bow_ribbon', () => {
    const left = new THREE.BoxGeometry(0.10, 0.06, 0.02);
    left.rotateZ(0.4);
    left.translate(-0.05, 0.02, 0);
    const right = new THREE.BoxGeometry(0.10, 0.06, 0.02);
    right.rotateZ(-0.4);
    right.translate(0.05, 0.02, 0);
    const knot = new THREE.SphereGeometry(0.025, 6, 4);
    return mergeGeos([left, right, knot]);
  });
}

/**
 * Merge multiple geometries
 * @param {THREE.BufferGeometry[]} geometries - Array of geometries
 * @returns {THREE.BufferGeometry} Merged geometry
 */
function mergeGeos(geometries) {
  // Simple merge without BufferGeometryUtils (for standalone use)
  const positions = [];
  const normals = [];
  const indices = [];
  let offset = 0;
  
  for (const geo of geometries) {
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const idx = geo.index;
    
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (norm) {
        normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      }
    }
    
    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices.push(idx.getX(i) + offset);
      }
    }
    
    offset += pos.count;
  }
  
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length > 0) {
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  }
  if (indices.length > 0) {
    merged.setIndex(indices);
  }
  merged.computeVertexNormals();
  
  return merged;
}

/**
 * Get accessory attachment position for a slot
 * @param {'hat'|'collar'|'wings'|'bow'|'glasses'} slot - Accessory slot
 * @param {number} scale - Pet scale
 * @returns {{position: [number, number, number], rotation: [number, number, number]}} Attachment transform
 */
export function getAccessoryAttachment(slot, scale = 1) {
  const s = scale;
  switch (slot) {
    case 'hat':
      return { position: [0, 1.35 * s, 0.05 * s], rotation: [0, 0, 0] };
    case 'collar':
      return { position: [0, 0.65 * s, 0], rotation: [Math.PI / 2, 0, 0] };
    case 'wings':
      return { position: [0, 0.85 * s, -0.15 * s], rotation: [0, 0, 0] };
    case 'bow':
      return { position: [0.18 * s, 1.25 * s, 0.12 * s], rotation: [0, 0, 0.2] };
    case 'glasses':
      return { position: [0, 1.08 * s, 0.42 * s], rotation: [0, 0, 0] };
    default:
      return { position: [0, 1, 0], rotation: [0, 0, 0] };
  }
}

/**
 * Clear geometry cache
 */
export function clearAccessoryCache() {
  GEO_CACHE.clear();
}
