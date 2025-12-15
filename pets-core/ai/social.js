/**
 * @fileoverview Social proxemics and interaction logic for Mind Palace Pets
 * @module pets-core/ai/social
 */

import * as THREE from 'three';
import { randRange, pick } from '../utils.js';
import { PERSONALITY } from './brain.js';

/**
 * Social interaction configuration
 * @type {Object}
 */
export const SOCIAL_CONFIG = {
  distance: 2.0,          // Distance to trigger greeting
  cooldownS: 10,          // Seconds before same pair can greet again
  checkEveryFrames: 30,   // How often to run proximity checks
  greetDuration: [1.05, 1.5]
};

/**
 * @typedef {Object} SocialState
 * @property {boolean} active - Is currently in social interaction
 * @property {number} until - Timestamp when interaction ends
 * @property {string|null} partnerId - ID of interaction partner
 * @property {THREE.Vector3} partnerPos - Partner position
 * @property {number} facePartnerYaw - Yaw to face partner
 */

/**
 * Create initial social state
 * @returns {SocialState} Initial social state
 */
export function createSocialState() {
  return {
    active: false,
    until: 0,
    partnerId: null,
    partnerPos: new THREE.Vector3(),
    facePartnerYaw: 0
  };
}

/**
 * @typedef {Object} ChaseMode
 * @property {boolean} active - Is chase active
 * @property {number} until - End timestamp
 * @property {string|null} chaserId - Chaser pet ID
 * @property {string|null} runnerId - Runner pet ID
 * @property {THREE.Vector3} runnerPos - Runner position
 * @property {THREE.Vector3} chaserPos - Chaser position
 */

/**
 * Create initial chase mode state
 * @returns {ChaseMode} Initial chase mode
 */
export function createChaseMode() {
  return {
    active: false,
    until: 0,
    chaserId: null,
    runnerId: null,
    runnerPos: new THREE.Vector3(),
    chaserPos: new THREE.Vector3()
  };
}

/**
 * Update social state (check for expiry)
 * @param {SocialState} social - Current social state
 * @param {number} time - Current elapsed time
 * @returns {boolean} True if social just ended
 */
export function updateSocialState(social, time) {
  if (social.active && time > social.until) {
    social.active = false;
    social.partnerId = null;
    return true; // Social ended
  }
  return false;
}

/**
 * Start social interaction between two pets
 * @param {SocialState} socialA - First pet's social state
 * @param {SocialState} socialB - Second pet's social state
 * @param {Object} posA - First pet position {x, z}
 * @param {Object} posB - Second pet position {x, z}
 * @param {string} idA - First pet ID
 * @param {string} idB - Second pet ID
 * @param {number} time - Current elapsed time
 * @param {number} baseY - Base Y position
 */
export function startSocialInteraction(socialA, socialB, posA, posB, idA, idB, time, baseY) {
  const duration = randRange(SOCIAL_CONFIG.greetDuration[0], SOCIAL_CONFIG.greetDuration[1]);
  const until = time + duration;
  
  // Set up A's social state
  socialA.active = true;
  socialA.until = until;
  socialA.partnerId = idB;
  socialA.partnerPos.set(posB.x, baseY, posB.z);
  socialA.facePartnerYaw = Math.atan2(posB.x - posA.x, posB.z - posA.z);
  
  // Set up B's social state
  socialB.active = true;
  socialB.until = until;
  socialB.partnerId = idA;
  socialB.partnerPos.set(posA.x, baseY, posA.z);
  socialB.facePartnerYaw = Math.atan2(posA.x - posB.x, posA.z - posB.z);
}

/**
 * Check if chase should be triggered
 * @param {ChaseMode} chaseMode - Current chase mode
 * @param {Object[]} pets - Array of pet data
 * @param {number} time - Current elapsed time
 * @returns {boolean} True if chase was started
 */
export function maybeStartChase(chaseMode, pets, time) {
  if (chaseMode.active) return false;
  if (pets.length < 2) return false;
  
  // Low probability check
  if (Math.random() >= PERSONALITY.chaseChancePerS * (1 / 60)) return false;
  
  const a = pick(pets);
  let b = pick(pets);
  let guard = 0;
  while (b.id === a.id && guard++ < 6) {
    b = pick(pets);
  }
  
  if (b.id === a.id) return false;
  
  chaseMode.active = true;
  chaseMode.chaserId = a.id;
  chaseMode.runnerId = b.id;
  chaseMode.until = time + randRange(PERSONALITY.chaseDuration[0], PERSONALITY.chaseDuration[1]);
  
  return true;
}

/**
 * Update chase mode positions
 * @param {ChaseMode} chaseMode - Chase mode state
 * @param {Map} posMap - Map of pet ID to position
 * @param {number} time - Current elapsed time
 * @param {number} baseY - Base Y position
 */
export function updateChaseMode(chaseMode, posMap, time, baseY) {
  if (!chaseMode.active) return;
  
  // Update positions
  const chaserPos = posMap.get(chaseMode.chaserId);
  const runnerPos = posMap.get(chaseMode.runnerId);
  
  if (chaserPos) {
    chaseMode.chaserPos.set(chaserPos.x, baseY, chaserPos.z);
  }
  if (runnerPos) {
    chaseMode.runnerPos.set(runnerPos.x, baseY, runnerPos.z);
  }
  
  // Check expiry
  if (time > chaseMode.until) {
    chaseMode.active = false;
    chaseMode.chaserId = null;
    chaseMode.runnerId = null;
  }
}

/**
 * Calculate separation vector from nearby pets
 * @param {Object} pos - Current position {x, z}
 * @param {Map} posMap - Map of pet ID to position
 * @param {string} selfId - This pet's ID
 * @param {number} [radius=2.2] - Separation radius
 * @returns {Object} Separation vector {x, z}
 */
export function calculateSeparation(pos, posMap, selfId, radius = 2.2) {
  let sepX = 0;
  let sepZ = 0;
  
  for (const [id, p2] of posMap) {
    if (id === selfId) continue;
    
    const ox = pos.x - p2.x;
    const oz = pos.z - p2.z;
    const d2 = ox * ox + oz * oz;
    
    if (d2 < radius * radius && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const inv = 1 / d;
      const push = (1.0 - d / radius) * 0.018;
      sepX += ox * inv * push;
      sepZ += oz * inv * push;
    }
  }
  
  return { x: sepX, z: sepZ };
}

/**
 * Calculate separation from player
 * @param {Object} petPos - Pet position {x, z}
 * @param {Object} playerPos - Player position {x, z}
 * @param {number} [radius=1.6] - Personal space radius
 * @returns {Object} Separation vector {x, z}
 */
export function calculatePlayerSeparation(petPos, playerPos, radius = 1.6) {
  const ox = petPos.x - playerPos.x;
  const oz = petPos.z - playerPos.z;
  const d2 = ox * ox + oz * oz;
  
  if (d2 < radius * radius && d2 > 0.0001) {
    const d = Math.sqrt(d2);
    const inv = 1 / d;
    return {
      x: ox * inv * 0.022,
      z: oz * inv * 0.022
    };
  }
  
  return { x: 0, z: 0 };
}

/**
 * Check if two positions are within social distance
 * @param {Object} posA - First position {x, z}
 * @param {Object} posB - Second position {x, z}
 * @returns {boolean} True if within social distance
 */
export function isWithinSocialDistance(posA, posB) {
  const dx = posA.x - posB.x;
  const dz = posA.z - posB.z;
  const d2 = dx * dx + dz * dz;
  return d2 < SOCIAL_CONFIG.distance * SOCIAL_CONFIG.distance;
}

/**
 * Generate pair cooldown key
 * @param {string} idA - First pet ID
 * @param {string} idB - Second pet ID
 * @returns {string} Cooldown key
 */
export function getPairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}
