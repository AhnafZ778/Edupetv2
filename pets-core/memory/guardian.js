/**
 * @fileoverview Pet-Memory guardian association system
 * @module pets-core/memory/guardian
 */

import * as THREE from 'three';
import { petEvents, PET_EVENTS } from '../events/PetEventEmitter.js';

/**
 * @typedef {Object} MemoryNode
 * @property {string} id - Unique memory ID
 * @property {THREE.Vector3} position - Memory position in world
 * @property {string} title - Memory title/label
 * @property {string} [guardianPetId] - Assigned guardian pet ID
 * @property {number} createdAt - Creation timestamp
 */

/**
 * @typedef {Object} GuardianAssignment
 * @property {string} petId - Pet ID
 * @property {string} memoryId - Memory ID
 * @property {number} assignedAt - Assignment timestamp
 * @property {number} bondLevel - Bond strength (0-1)
 * @property {number} lastVisit - Last time pet visited memory
 */

/**
 * Memory registry for the Mind Palace
 */
class MemoryRegistry {
  constructor() {
    /** @type {Map<string, MemoryNode>} */
    this.memories = new Map();
    /** @type {Map<string, GuardianAssignment>} Assignment by petId */
    this.assignments = new Map();
  }

  /**
   * Register a memory node
   * @param {MemoryNode} memory - Memory to register
   */
  addMemory(memory) {
    this.memories.set(memory.id, {
      ...memory,
      createdAt: memory.createdAt ?? Date.now()
    });
    
    // Emit event for curious behavior trigger
    petEvents.emit(PET_EVENTS.MEMORY_ADDED, { memory });
  }

  /**
   * Remove a memory
   * @param {string} id - Memory ID
   */
  removeMemory(id) {
    const memory = this.memories.get(id);
    if (memory?.guardianPetId) {
      this.unassignGuardian(memory.guardianPetId);
    }
    this.memories.delete(id);
  }

  /**
   * Get all memories
   * @returns {MemoryNode[]} Array of memories
   */
  getAllMemories() {
    return Array.from(this.memories.values());
  }

  /**
   * Get unguarded memories
   * @returns {MemoryNode[]} Memories without guardians
   */
  getUnguardedMemories() {
    return this.getAllMemories().filter(m => !m.guardianPetId);
  }

  /**
   * Assign a pet as guardian of a memory
   * @param {string} petId - Pet ID
   * @param {string} memoryId - Memory ID
   * @returns {boolean} Success
   */
  assignGuardian(petId, memoryId) {
    const memory = this.memories.get(memoryId);
    if (!memory) return false;

    // Remove existing assignment for this pet
    this.unassignGuardian(petId);

    // Remove existing guardian from this memory
    if (memory.guardianPetId) {
      const oldAssignment = this.assignments.get(memory.guardianPetId);
      if (oldAssignment) {
        this.assignments.delete(memory.guardianPetId);
      }
    }

    // Create new assignment
    memory.guardianPetId = petId;
    this.assignments.set(petId, {
      petId,
      memoryId,
      assignedAt: Date.now(),
      bondLevel: 0,
      lastVisit: Date.now()
    });

    petEvents.emit(PET_EVENTS.ASSIGNED_TO_MEMORY, { petId, memoryId, memory });
    return true;
  }

  /**
   * Remove guardian assignment from a pet
   * @param {string} petId - Pet ID
   */
  unassignGuardian(petId) {
    const assignment = this.assignments.get(petId);
    if (assignment) {
      const memory = this.memories.get(assignment.memoryId);
      if (memory && memory.guardianPetId === petId) {
        memory.guardianPetId = null;
      }
      this.assignments.delete(petId);
    }
  }

  /**
   * Get guardian assignment for a pet
   * @param {string} petId - Pet ID
   * @returns {GuardianAssignment|null} Assignment or null
   */
  getAssignment(petId) {
    return this.assignments.get(petId) || null;
  }

  /**
   * Get assigned memory for a pet
   * @param {string} petId - Pet ID
   * @returns {MemoryNode|null} Assigned memory or null
   */
  getAssignedMemory(petId) {
    const assignment = this.assignments.get(petId);
    if (!assignment) return null;
    return this.memories.get(assignment.memoryId) || null;
  }

  /**
   * Update bond level when pet visits its memory
   * @param {string} petId - Pet ID
   * @param {number} increase - Amount to increase (0-1)
   */
  updateBond(petId, increase = 0.05) {
    const assignment = this.assignments.get(petId);
    if (assignment) {
      assignment.bondLevel = Math.min(1, assignment.bondLevel + increase);
      assignment.lastVisit = Date.now();
    }
  }

  /**
   * Check if pet is near its assigned memory
   * @param {string} petId - Pet ID
   * @param {THREE.Vector3} petPos - Pet position
   * @param {number} radius - Detection radius
   * @returns {boolean} True if near memory
   */
  isPetNearMemory(petId, petPos, radius = 2.0) {
    const memory = this.getAssignedMemory(petId);
    if (!memory) return false;
    return petPos.distanceTo(memory.position) < radius;
  }

  /**
   * Get bond level for a pet
   * @param {string} petId - Pet ID
   * @returns {number} Bond level (0-1) or 0 if not assigned
   */
  getBondLevel(petId) {
    return this.assignments.get(petId)?.bondLevel ?? 0;
  }

  /**
   * Find nearest memory to position
   * @param {THREE.Vector3} pos - Reference position
   * @returns {MemoryNode|null} Nearest memory
   */
  findNearestMemory(pos) {
    const memories = this.getAllMemories();
    if (memories.length === 0) return null;

    let nearest = null;
    let nearestDist = Infinity;

    for (const m of memories) {
      const dist = pos.distanceTo(m.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = m;
      }
    }

    return nearest;
  }

  /**
   * Clear all memories and assignments
   */
  clear() {
    this.memories.clear();
    this.assignments.clear();
  }

  /**
   * Export state for persistence
   * @returns {Object} Serializable state
   */
  exportState() {
    return {
      memories: Array.from(this.memories.entries()),
      assignments: Array.from(this.assignments.entries())
    };
  }

  /**
   * Import state from persistence
   * @param {Object} state - Saved state
   */
  importState(state) {
    if (state.memories) {
      this.memories = new Map(state.memories.map(([id, m]) => [
        id,
        { ...m, position: new THREE.Vector3(m.position.x, m.position.y, m.position.z) }
      ]));
    }
    if (state.assignments) {
      this.assignments = new Map(state.assignments);
    }
  }
}

/**
 * Global memory registry singleton
 * @type {MemoryRegistry}
 */
export const memoryRegistry = new MemoryRegistry();

/**
 * Create a memory node
 * @param {string} id - Memory ID
 * @param {string} title - Memory title
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {number} z - Z position
 */
export function createMemory(id, title, x, y, z) {
  memoryRegistry.addMemory({
    id,
    title,
    position: new THREE.Vector3(x, y, z),
    guardianPetId: null,
    createdAt: Date.now()
  });
}

/**
 * Calculate curious behavior strength based on memory recency
 * @param {MemoryNode} memory - Memory to check
 * @param {number} maxAgeMs - Max age for full curiosity (default 5 minutes)
 * @returns {number} Curiosity strength (0-1)
 */
export function getMemoryCuriosityStrength(memory, maxAgeMs = 5 * 60 * 1000) {
  const age = Date.now() - memory.createdAt;
  if (age > maxAgeMs) return 0;
  return 1 - (age / maxAgeMs);
}
