/**
 * @fileoverview Pet AI brain state machine for Mind Palace Pets
 * @module pets-core/ai/brain
 */

import { noise1D, randRange, pick, clamp, dampAngle } from '../utils.js';

/**
 * Personality configuration - controls AI behavior rarity
 * @type {Object}
 */
export const PERSONALITY = {
  curiosityChancePerS: 0.11,
  curiosityDuration: [1.2, 2.2],
  restChancePerS: 0.10,
  restDuration: [2.6, 4.8],
  restAfterWalkS: 10,
  chaseChancePerS: 0.04,
  chaseDuration: [3.8, 5.2],
  sleepAfterNoInteractS: 22
};

/**
 * @typedef {Object} BrainState
 * @property {'wandering'|'socializing'|'resting'|'curious'|'held'|'chasing'|'running'|'sleeping'|'following'} mode
 * @property {number} t - Timer for current state
 * @property {number} seed - Random seed for noise
 * @property {number} walkS - Time spent walking
 * @property {Object} restSpot - Rest target position
 * @property {number} lastInteractAt - Last interaction timestamp
 */

/**
 * Create initial brain state
 * @param {number} [seed] - Random seed
 * @returns {BrainState} Initial brain state
 */
export function createBrainState(seed = Math.random() * 10000) {
  return {
    mode: 'wandering',
    t: 0,
    seed: Math.floor(seed) % 10000,
    walkS: 0,
    restSpot: { x: 0, y: 0, z: 0 },
    lastInteractAt: 0
  };
}

/**
 * Update brain AI state
 * @param {BrainState} brain - Current brain state
 * @param {Object} params - Update parameters
 * @param {number} params.dt - Delta time
 * @param {number} params.time - Elapsed time
 * @param {boolean} params.isHeld - Is pet being held
 * @param {boolean} params.socialActive - Is social interaction active
 * @param {number} params.playerDist2 - Squared distance to player
 * @param {Object} params.chaseMode - Chase mode state from manager
 * @param {string} params.petId - Pet ID
 * @param {Object[]} params.rugs - Rest spot positions
 * @returns {BrainState} Updated brain state
 */
export function updateBrain(brain, params) {
  const { dt, time, isHeld, socialActive, playerDist2, chaseMode, petId, rugs = [] } = params;
  
  // Decrement timer
  brain.t -= dt;
  
  // If held, stay in held mode
  if (isHeld) {
    brain.mode = 'held';
    return brain;
  }
  
  // Chase mode from manager
  if (chaseMode?.active) {
    if (chaseMode.chaserId === petId) {
      brain.mode = 'chasing';
      brain.t = chaseMode.until - time;
    } else if (chaseMode.runnerId === petId) {
      brain.mode = 'running';
      brain.t = chaseMode.until - time;
    }
    return brain;
  }
  
  // Social stops movement
  if (socialActive) {
    brain.mode = 'socializing';
    return brain;
  }
  
  // Sleep check (if not interacted for a while)
  const sinceInteract = (performance.now() * 0.001) - (brain.lastInteractAt || 0);
  if (brain.mode !== 'sleeping' && playerDist2 <= 64) {
    if (sinceInteract > PERSONALITY.sleepAfterNoInteractS && Math.random() < 0.035 * dt) {
      brain.mode = 'sleeping';
      brain.t = randRange(3.0, 6.0);
      if (rugs.length > 0) {
        const spot = pick(rugs);
        brain.restSpot = { x: spot[0], y: 0, z: spot[1] };
      }
    }
  }
  
  // Wandering state transitions
  if (brain.mode === 'wandering') {
    brain.walkS += dt;
    
    const shouldFollow = playerDist2 > 64; // > 8 units away
    
    if (shouldFollow) {
      brain.mode = 'following';
    } else if (brain.walkS > PERSONALITY.restAfterWalkS && Math.random() < PERSONALITY.restChancePerS * dt) {
      brain.mode = 'resting';
      brain.t = randRange(PERSONALITY.restDuration[0], PERSONALITY.restDuration[1]);
      brain.walkS = 0;
      if (rugs.length > 0) {
        const spot = pick(rugs);
        brain.restSpot = { x: spot[0], y: 0, z: spot[1] };
      }
    } else if (Math.random() < PERSONALITY.curiosityChancePerS * dt) {
      brain.mode = 'curious';
      brain.t = randRange(PERSONALITY.curiosityDuration[0], PERSONALITY.curiosityDuration[1]);
    }
  }
  
  // Following -> wandering when close again
  if (brain.mode === 'following' && playerDist2 <= 64) {
    brain.mode = 'wandering';
    brain.walkS = 0;
  }
  
  // Curious/resting/sleeping timer expiry
  if ((brain.mode === 'curious' || brain.mode === 'resting' || brain.mode === 'sleeping') && brain.t <= 0) {
    brain.mode = 'wandering';
  }
  
  return brain;
}

/**
 * Calculate movement velocity based on brain state
 * @param {BrainState} brain - Current brain state
 * @param {Object} pos - Current position {x, z}
 * @param {Object} vel - Current velocity {x, z}
 * @param {Object} params - Movement parameters
 * @returns {Object} Updated velocity {x, z}
 */
export function calculateMovement(brain, pos, vel, params) {
  const { dt, time, bounds, playerPos, chaseMode, separationVec, isMobile, baseY } = params;
  
  let vx = vel.x;
  let vz = vel.z;
  
  if (brain.mode === 'socializing') {
    // Slow down during social
    vx *= Math.pow(0.72, dt * 60);
    vz *= Math.pow(0.72, dt * 60);
  } else if (brain.mode === 'curious') {
    // Stop and look at player
    vx *= Math.pow(0.70, dt * 60);
    vz *= Math.pow(0.70, dt * 60);
  } else if (brain.mode === 'resting' || brain.mode === 'sleeping') {
    // Move toward rest spot
    const dx = brain.restSpot.x - pos.x;
    const dz = brain.restSpot.z - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.20) {
      const nx = dx / d;
      const nz = dz / d;
      vx += nx * dt * 2.2;
      vz += nz * dt * 2.2;
    } else {
      vx *= Math.pow(0.70, dt * 60);
      vz *= Math.pow(0.70, dt * 60);
    }
  } else if (brain.mode === 'following') {
    // Move toward player
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      const nx = dx / d;
      const nz = dz / d;
      const speed = isMobile ? 1.55 : 1.75;
      vx += nx * speed * dt * 3.2;
      vz += nz * speed * dt * 3.2;
    }
    vx *= Math.pow(0.86, dt * 60);
    vz *= Math.pow(0.86, dt * 60);
  } else if (brain.mode === 'chasing' && chaseMode?.runnerPos) {
    // Chase runner
    const dx = chaseMode.runnerPos.x - pos.x;
    const dz = chaseMode.runnerPos.z - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      const nx = dx / d;
      const nz = dz / d;
      vx += nx * 2.05 * dt * 3.0;
      vz += nz * 2.05 * dt * 3.0;
    }
    vx *= Math.pow(0.86, dt * 60);
    vz *= Math.pow(0.86, dt * 60);
  } else if (brain.mode === 'running' && chaseMode?.chaserPos) {
    // Run away from chaser
    const dx = pos.x - chaseMode.chaserPos.x;
    const dz = pos.z - chaseMode.chaserPos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.001) {
      const nx = dx / d;
      const nz = dz / d;
      vx += nx * 2.1 * dt * 3.0;
      vz += nz * 2.1 * dt * 3.0;
    }
    vx *= Math.pow(0.86, dt * 60);
    vz *= Math.pow(0.86, dt * 60);
  } else {
    // Wandering with noise + wall steering
    const nx = noise1D(time * 0.55, brain.seed);
    const nz = noise1D(time * 0.55 + 100, brain.seed);
    let dirX = nx;
    let dirZ = nz;
    
    // Wall avoidance
    const margin = 1.25;
    if (pos.x > bounds.maxX - margin) dirX -= (pos.x - (bounds.maxX - margin)) / margin;
    if (pos.x < bounds.minX + margin) dirX += ((bounds.minX + margin) - pos.x) / margin;
    if (pos.z > bounds.maxZ - margin) dirZ -= (pos.z - (bounds.maxZ - margin)) / margin;
    if (pos.z < bounds.minZ + margin) dirZ += ((bounds.minZ + margin) - pos.z) / margin;
    
    // Add separation
    if (separationVec) {
      dirX += separationVec.x;
      dirZ += separationVec.z;
    }
    
    // Normalize
    const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (l > 0.001) {
      dirX /= l;
      dirZ /= l;
    }
    
    const speed = 1.25;
    vx += dirX * speed * dt * 2.6;
    vz += dirZ * speed * dt * 2.6;
    
    vx *= Math.pow(0.88, dt * 60);
    vz *= Math.pow(0.88, dt * 60);
  }
  
  return { x: vx, z: vz };
}

/**
 * Calculate target yaw based on movement
 * @param {Object} vel - Velocity {x, z}
 * @param {number} currentYaw - Current yaw angle
 * @param {number} dampingFactor - Damping factor for interpolation
 * @returns {number} New yaw angle
 */
export function calculateYaw(vel, currentYaw, dampingFactor = 0.09) {
  const targetYaw = Math.atan2(vel.x, vel.z);
  if (!isFinite(targetYaw)) return currentYaw;
  return dampAngle(currentYaw, targetYaw, dampingFactor);
}
