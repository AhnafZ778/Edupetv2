/**
 * @fileoverview Rest spot detection and management for pets
 * @module pets-core/environment/restSpots
 */

import * as THREE from 'three';
import { pick, randRange } from '../utils.js';

/**
 * @typedef {Object} RestSpot
 * @property {string} id - Unique spot ID
 * @property {THREE.Vector3} position - Spot center position
 * @property {number} radius - Spot radius
 * @property {'rug'|'cushion'|'bed'|'sunbeam'|'generic'} type - Spot type
 * @property {number} priority - Higher priority spots are preferred
 * @property {number} warmth - Warmth level (0-1, affects cat preference)
 * @property {boolean} occupied - Is currently occupied by a pet
 * @property {string|null} occupantId - ID of occupying pet
 */

/**
 * Rest spot registry
 */
class RestSpotRegistry {
  constructor() {
    /** @type {Map<string, RestSpot>} */
    this.spots = new Map();
  }

  /**
   * Register a rest spot
   * @param {RestSpot} spot - Spot to register
   */
  add(spot) {
    this.spots.set(spot.id, {
      ...spot,
      occupied: spot.occupied ?? false,
      occupantId: spot.occupantId ?? null
    });
  }

  /**
   * Remove a rest spot
   * @param {string} id - Spot ID
   */
  remove(id) {
    this.spots.delete(id);
  }

  /**
   * Clear all spots
   */
  clear() {
    this.spots.clear();
  }

  /**
   * Get all rest spots
   * @returns {RestSpot[]} Array of spots
   */
  getAll() {
    return Array.from(this.spots.values());
  }

  /**
   * Get available (unoccupied) spots
   * @returns {RestSpot[]} Available spots
   */
  getAvailable() {
    return this.getAll().filter(s => !s.occupied);
  }

  /**
   * Find nearest available rest spot
   * @param {THREE.Vector3} pos - Reference position
   * @param {string} [preferType] - Preferred spot type
   * @returns {RestSpot|null} Nearest available spot
   */
  findNearest(pos, preferType) {
    const available = this.getAvailable();
    if (available.length === 0) return null;

    let best = null;
    let bestScore = Infinity;

    for (const spot of available) {
      const dist = pos.distanceTo(spot.position);
      // Reduce distance for preferred type
      const typeBonus = preferType && spot.type === preferType ? 0.5 : 1.0;
      // Reduce distance for higher priority
      const priorityBonus = 1 - spot.priority * 0.1;
      const score = dist * typeBonus * priorityBonus;

      if (score < bestScore) {
        bestScore = score;
        best = spot;
      }
    }

    return best;
  }

  /**
   * Find a random available spot
   * @param {string} [preferType] - Preferred type (weighted)
   * @returns {RestSpot|null} Random spot
   */
  findRandom(preferType) {
    const available = this.getAvailable();
    if (available.length === 0) return null;

    // Weight preferred type higher
    if (preferType) {
      const preferred = available.filter(s => s.type === preferType);
      if (preferred.length > 0 && Math.random() < 0.7) {
        return pick(preferred);
      }
    }

    return pick(available);
  }

  /**
   * Occupy a spot
   * @param {string} spotId - Spot ID
   * @param {string} petId - Pet ID
   * @returns {boolean} Success
   */
  occupy(spotId, petId) {
    const spot = this.spots.get(spotId);
    if (!spot || spot.occupied) return false;
    
    spot.occupied = true;
    spot.occupantId = petId;
    return true;
  }

  /**
   * Release a spot
   * @param {string} spotId - Spot ID
   */
  release(spotId) {
    const spot = this.spots.get(spotId);
    if (spot) {
      spot.occupied = false;
      spot.occupantId = null;
    }
  }

  /**
   * Release all spots occupied by a pet
   * @param {string} petId - Pet ID
   */
  releaseByPet(petId) {
    for (const spot of this.spots.values()) {
      if (spot.occupantId === petId) {
        spot.occupied = false;
        spot.occupantId = null;
      }
    }
  }

  /**
   * Check if position is within any rest spot
   * @param {THREE.Vector3} pos - Position to check
   * @returns {RestSpot|null} Containing spot or null
   */
  getSpotAt(pos) {
    for (const spot of this.spots.values()) {
      const dx = pos.x - spot.position.x;
      const dz = pos.z - spot.position.z;
      if (dx * dx + dz * dz < spot.radius * spot.radius) {
        return spot;
      }
    }
    return null;
  }
}

/**
 * Global rest spot registry singleton
 * @type {RestSpotRegistry}
 */
export const restSpotRegistry = new RestSpotRegistry();

/**
 * Create a rest spot from parameters
 * @param {string} id - Spot ID
 * @param {number} x - X position
 * @param {number} z - Z position
 * @param {number} [radius=1.0] - Spot radius
 * @param {'rug'|'cushion'|'bed'|'sunbeam'|'generic'} [type='generic'] - Spot type
 * @param {number} [priority=0.5] - Priority (0-1)
 * @param {number} [warmth=0.5] - Warmth level (0-1)
 */
export function createRestSpot(id, x, z, radius = 1.0, type = 'generic', priority = 0.5, warmth = 0.5) {
  restSpotRegistry.add({
    id,
    position: new THREE.Vector3(x, 0, z),
    radius,
    type,
    priority,
    warmth,
    occupied: false,
    occupantId: null
  });
}

/**
 * Register rest spots from coordinate array
 * @param {Array<[number, number]>} coords - Array of [x, z] coordinates
 * @param {string} [prefix='spot'] - ID prefix
 * @param {'rug'|'cushion'|'bed'|'sunbeam'|'generic'} [type='generic'] - Spot type
 */
export function createRestSpotsFromArray(coords, prefix = 'spot', type = 'generic') {
  coords.forEach(([x, z], i) => {
    createRestSpot(`${prefix}_${i}`, x, z, 1.0, type, 0.5 + Math.random() * 0.3, 0.5);
  });
}

/**
 * Get species-preferred rest spot type
 * @param {string} speciesKey - Species key
 * @returns {string} Preferred spot type
 */
export function getSpeciesPreferredSpot(speciesKey) {
  const prefs = {
    cat: 'sunbeam',
    dog: 'bed',
    bunny: 'rug',
    tiger: 'rug',
    wolf: 'bed',
    dragon: 'sunbeam'
  };
  return prefs[speciesKey] || 'generic';
}
