/**
 * @fileoverview Ground detection and surface positioning for pets
 * @module pets-core/environment/ground
 */

import * as THREE from 'three';

// Pre-allocated objects for raycasting
const _raycaster = new THREE.Raycaster();
const _downDir = new THREE.Vector3(0, -1, 0);
const _upDir = new THREE.Vector3(0, 1, 0);
const _origin = new THREE.Vector3();

/**
 * Ground detection configuration
 */
export const GROUND_CONFIG = {
  maxRayDistance: 10,
  defaultY: 0.55,
  rayOffset: 2.0 // Start ray from this height above expected ground
};

/**
 * Registered ground meshes for raycasting
 * @type {THREE.Mesh[]}
 */
let groundMeshes = [];

/**
 * Register a mesh as walkable ground
 * @param {THREE.Mesh} mesh - Ground mesh
 */
export function registerGroundMesh(mesh) {
  if (!groundMeshes.includes(mesh)) {
    groundMeshes.push(mesh);
  }
}

/**
 * Unregister a ground mesh
 * @param {THREE.Mesh} mesh - Mesh to remove
 */
export function unregisterGroundMesh(mesh) {
  const idx = groundMeshes.indexOf(mesh);
  if (idx >= 0) groundMeshes.splice(idx, 1);
}

/**
 * Clear all ground meshes
 */
export function clearGroundMeshes() {
  groundMeshes = [];
}

/**
 * Get ground height at position
 * @param {number} x - X position
 * @param {number} z - Z position
 * @param {number} [defaultY=GROUND_CONFIG.defaultY] - Default if no ground found
 * @returns {number} Ground Y position
 */
export function getGroundHeight(x, z, defaultY = GROUND_CONFIG.defaultY) {
  if (groundMeshes.length === 0) return defaultY;

  _origin.set(x, defaultY + GROUND_CONFIG.rayOffset, z);
  _raycaster.set(_origin, _downDir);
  _raycaster.far = GROUND_CONFIG.maxRayDistance;

  const hits = _raycaster.intersectObjects(groundMeshes, false);
  if (hits.length > 0) {
    return hits[0].point.y;
  }

  return defaultY;
}

/**
 * Get ground normal at position
 * @param {number} x - X position
 * @param {number} z - Z position
 * @returns {THREE.Vector3|null} Normal vector or null
 */
export function getGroundNormal(x, z) {
  if (groundMeshes.length === 0) return null;

  _origin.set(x, GROUND_CONFIG.defaultY + GROUND_CONFIG.rayOffset, z);
  _raycaster.set(_origin, _downDir);
  _raycaster.far = GROUND_CONFIG.maxRayDistance;

  const hits = _raycaster.intersectObjects(groundMeshes, false);
  if (hits.length > 0 && hits[0].face) {
    return hits[0].face.normal.clone();
  }

  return null;
}

/**
 * Check if position is above valid ground
 * @param {number} x - X position
 * @param {number} z - Z position
 * @returns {boolean} True if ground exists below
 */
export function isOverGround(x, z) {
  if (groundMeshes.length === 0) return true; // Assume flat ground if none registered

  _origin.set(x, GROUND_CONFIG.defaultY + GROUND_CONFIG.rayOffset, z);
  _raycaster.set(_origin, _downDir);
  _raycaster.far = GROUND_CONFIG.maxRayDistance;

  return _raycaster.intersectObjects(groundMeshes, false).length > 0;
}

/**
 * Snap position to ground
 * @param {THREE.Vector3} pos - Position to snap (modified in place)
 * @param {number} [offset=0] - Height offset above ground
 * @returns {THREE.Vector3} Snapped position
 */
export function snapToGround(pos, offset = 0) {
  const groundY = getGroundHeight(pos.x, pos.z);
  pos.y = groundY + offset;
  return pos;
}

/**
 * Calculate proper shadow scale based on height
 * @param {number} objectY - Object Y position
 * @param {number} groundY - Ground Y position
 * @param {number} baseScale - Base shadow scale
 * @returns {number} Adjusted shadow scale
 */
export function calculateShadowScale(objectY, groundY, baseScale = 1.0) {
  const height = objectY - groundY;
  // Shadow gets larger and fainter as height increases
  const heightFactor = 1 + height * 0.15;
  return baseScale * heightFactor;
}

/**
 * Calculate shadow opacity based on height
 * @param {number} objectY - Object Y position
 * @param {number} groundY - Ground Y position
 * @param {number} baseOpacity - Base shadow opacity
 * @returns {number} Adjusted opacity (0-1)
 */
export function calculateShadowOpacity(objectY, groundY, baseOpacity = 0.8) {
  const height = objectY - groundY;
  // Fade shadow as height increases
  const fade = Math.max(0, 1 - height * 0.2);
  return baseOpacity * fade;
}

/**
 * Get lighting intensity at position (for pet reactions)
 * @param {THREE.Vector3} pos - Position to check
 * @param {THREE.Light[]} lights - Array of lights to check
 * @returns {number} Combined light intensity (0-1)
 */
export function getLightingAtPosition(pos, lights) {
  if (!lights || lights.length === 0) return 0.5;

  let totalIntensity = 0;

  for (const light of lights) {
    if (light.isAmbientLight || light.isHemisphereLight) {
      totalIntensity += light.intensity * 0.3;
    } else if (light.isDirectionalLight) {
      totalIntensity += light.intensity * 0.5;
    } else if (light.isPointLight) {
      const dist = pos.distanceTo(light.position);
      const falloff = Math.max(0, 1 - dist / (light.distance || 10));
      totalIntensity += light.intensity * falloff * 0.8;
    } else if (light.isSpotLight) {
      const dist = pos.distanceTo(light.position);
      const falloff = Math.max(0, 1 - dist / (light.distance || 10));
      totalIntensity += light.intensity * falloff * 0.6;
    }
  }

  return Math.min(1, totalIntensity);
}

/**
 * Check if position is in a sunbeam (based on directional lights)
 * @param {THREE.Vector3} pos - Position to check
 * @param {THREE.DirectionalLight[]} lights - Directional lights
 * @param {number} threshold - Intensity threshold
 * @returns {boolean} True if in sunbeam
 */
export function isInSunbeam(pos, lights, threshold = 0.7) {
  if (!lights || lights.length === 0) return false;

  for (const light of lights) {
    if (light.isDirectionalLight && light.intensity > threshold) {
      // Simple check: assume vertical sunbeam in defined regions
      // A more complex implementation would use shadow maps
      return true;
    }
  }

  return false;
}
