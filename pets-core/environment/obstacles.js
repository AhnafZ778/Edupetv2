/**
 * @fileoverview Obstacle avoidance system for pets in Mind Palace
 * @module pets-core/environment/obstacles
 */

import * as THREE from 'three';

/**
 * @typedef {Object} Obstacle
 * @property {string} id - Unique obstacle ID
 * @property {THREE.Vector3} position - Center position
 * @property {THREE.Vector3} size - Bounding box size (width, height, depth)
 * @property {'box'|'cylinder'|'sphere'} shape - Collision shape type
 * @property {number} [radius] - Radius for cylinder/sphere shapes
 * @property {boolean} [walkable] - Can pets walk on top (for tables, etc.)
 */

// Pre-allocated vectors for calculations
const _obstacleToPos = new THREE.Vector3();
const _avoidDir = new THREE.Vector3();
const _closest = new THREE.Vector3();

/**
 * Obstacle registry for the current scene
 */
class ObstacleRegistry {
  constructor() {
    /** @type {Map<string, Obstacle>} */
    this.obstacles = new Map();
    /** @type {THREE.Box3} */
    this._tempBox = new THREE.Box3();
  }

  /**
   * Register an obstacle
   * @param {Obstacle} obstacle - Obstacle to register
   */
  add(obstacle) {
    this.obstacles.set(obstacle.id, obstacle);
  }

  /**
   * Remove an obstacle
   * @param {string} id - Obstacle ID
   */
  remove(id) {
    this.obstacles.delete(id);
  }

  /**
   * Clear all obstacles
   */
  clear() {
    this.obstacles.clear();
  }

  /**
   * Get all obstacles
   * @returns {Obstacle[]} Array of obstacles
   */
  getAll() {
    return Array.from(this.obstacles.values());
  }

  /**
   * Check if position collides with any obstacle
   * @param {THREE.Vector3} pos - Position to check
   * @param {number} radius - Pet collision radius
   * @returns {Obstacle|null} Colliding obstacle or null
   */
  checkCollision(pos, radius = 0.5) {
    for (const obs of this.obstacles.values()) {
      if (this._intersects(pos, radius, obs)) {
        return obs;
      }
    }
    return null;
  }

  /**
   * Check intersection between position and obstacle
   * @private
   */
  _intersects(pos, radius, obs) {
    if (obs.shape === 'sphere') {
      const r = obs.radius || obs.size.x / 2;
      const dist2 = pos.distanceToSquared(obs.position);
      return dist2 < (r + radius) * (r + radius);
    } else if (obs.shape === 'cylinder') {
      const r = obs.radius || obs.size.x / 2;
      const dx = pos.x - obs.position.x;
      const dz = pos.z - obs.position.z;
      const dist2 = dx * dx + dz * dz;
      const inHeight = pos.y >= obs.position.y - obs.size.y / 2 && 
                       pos.y <= obs.position.y + obs.size.y / 2;
      return inHeight && dist2 < (r + radius) * (r + radius);
    } else {
      // Box collision
      this._tempBox.setFromCenterAndSize(obs.position, obs.size);
      this._tempBox.expandByScalar(radius);
      return this._tempBox.containsPoint(pos);
    }
  }
}

/**
 * Global obstacle registry singleton
 * @type {ObstacleRegistry}
 */
export const obstacleRegistry = new ObstacleRegistry();

/**
 * Calculate avoidance steering force
 * @param {THREE.Vector3} petPos - Current pet position
 * @param {THREE.Vector3} petVel - Current pet velocity
 * @param {number} lookAhead - How far ahead to look for obstacles
 * @param {number} petRadius - Pet collision radius
 * @returns {THREE.Vector3} Steering force to avoid obstacles
 */
export function calculateObstacleAvoidance(petPos, petVel, lookAhead = 2.0, petRadius = 0.5) {
  _avoidDir.set(0, 0, 0);
  
  const speed = petVel.length();
  if (speed < 0.01) return _avoidDir;
  
  // Normalize velocity for direction
  const dirX = petVel.x / speed;
  const dirZ = petVel.z / speed;
  
  // Check obstacles
  for (const obs of obstacleRegistry.getAll()) {
    _obstacleToPos.copy(obs.position).sub(petPos);
    _obstacleToPos.y = 0; // Flatten to XZ plane
    
    const distToObs = _obstacleToPos.length();
    const obsRadius = obs.radius || Math.max(obs.size.x, obs.size.z) / 2;
    const avoidRadius = obsRadius + petRadius + 0.3; // Extra margin
    
    // Skip if too far away
    if (distToObs > lookAhead + avoidRadius) continue;
    
    // Check if obstacle is ahead of us
    const dot = dirX * _obstacleToPos.x + dirZ * _obstacleToPos.z;
    if (dot < 0) continue; // Behind us
    
    // Calculate closest point on velocity ray to obstacle center
    const t = Math.min(dot, lookAhead);
    _closest.set(
      petPos.x + dirX * t,
      petPos.y,
      petPos.z + dirZ * t
    );
    
    // Distance from closest point to obstacle center
    const closestDist = _closest.distanceTo(obs.position);
    
    if (closestDist < avoidRadius) {
      // Calculate avoidance direction (perpendicular to velocity)
      // Choose the side that's more open
      const perpX = -dirZ;
      const perpZ = dirX;
      
      // Check which side has more space
      const leftCheck = petPos.x + perpX - obs.position.x;
      const rightCheck = petPos.x - perpX - obs.position.x;
      const side = (leftCheck * leftCheck + (petPos.z + perpZ - obs.position.z) ** 2) >
                   (rightCheck * rightCheck + (petPos.z - perpZ - obs.position.z) ** 2) ? 1 : -1;
      
      // Stronger steering when closer
      const urgency = 1 - (closestDist / avoidRadius);
      const strength = urgency * 0.08;
      
      _avoidDir.x += perpX * side * strength;
      _avoidDir.z += perpZ * side * strength;
    }
  }
  
  return _avoidDir;
}

/**
 * Check if a position is valid (not inside any obstacle)
 * @param {THREE.Vector3} pos - Position to validate
 * @param {number} radius - Collision radius
 * @returns {boolean} True if position is valid
 */
export function isPositionValid(pos, radius = 0.5) {
  return obstacleRegistry.checkCollision(pos, radius) === null;
}

/**
 * Find nearest valid position from a given position
 * @param {THREE.Vector3} pos - Starting position
 * @param {number} radius - Collision radius
 * @param {number} maxIterations - Max search iterations
 * @returns {THREE.Vector3} Valid position
 */
export function findNearestValidPosition(pos, radius = 0.5, maxIterations = 8) {
  if (isPositionValid(pos, radius)) return pos.clone();
  
  const result = pos.clone();
  const step = 0.3;
  
  // Try moving in a spiral pattern
  for (let i = 1; i <= maxIterations; i++) {
    const r = step * i;
    for (let a = 0; a < 8; a++) {
      const angle = (a / 8) * Math.PI * 2;
      result.x = pos.x + Math.cos(angle) * r;
      result.z = pos.z + Math.sin(angle) * r;
      if (isPositionValid(result, radius)) {
        return result;
      }
    }
  }
  
  return pos.clone(); // Fallback to original
}

/**
 * Register furniture as obstacles from Three.js objects
 * @param {THREE.Object3D} object - Three.js object to register
 * @param {string} [id] - Optional ID (uses object.uuid if not provided)
 */
export function registerFurnitureObstacle(object, id) {
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  
  obstacleRegistry.add({
    id: id || object.uuid,
    position: center,
    size: size,
    shape: 'box',
    walkable: false
  });
}

/**
 * Create obstacle from position and dimensions
 * @param {string} id - Obstacle ID
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} z - Z position
 * @param {number} width - Width (X)
 * @param {number} height - Height (Y)
 * @param {number} depth - Depth (Z)
 * @param {'box'|'cylinder'|'sphere'} [shape='box'] - Shape type
 */
export function createObstacle(id, x, y, z, width, height, depth, shape = 'box') {
  obstacleRegistry.add({
    id,
    position: new THREE.Vector3(x, y, z),
    size: new THREE.Vector3(width, height, depth),
    shape,
    radius: shape === 'cylinder' || shape === 'sphere' ? width / 2 : undefined
  });
}
