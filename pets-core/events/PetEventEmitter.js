/**
 * @fileoverview Pet event emitter system
 * @module pets-core/events/PetEventEmitter
 */

/**
 * Event types for pet system
 * @enum {string}
 */
export const PET_EVENTS = {
  // Pet actions
  PET_SPAWNED: 'pet:spawned',
  PET_REMOVED: 'pet:removed',
  PET_GREET: 'pet:greet',
  PET_REST: 'pet:rest',
  PET_WAKE: 'pet:wake',
  PET_HELD: 'pet:held',
  PET_RELEASED: 'pet:released',
  PET_PETTED: 'pet:petted',
  PET_TAP: 'pet:tap',
  
  // Social events
  SOCIAL_START: 'social:start',
  SOCIAL_END: 'social:end',
  CHASE_START: 'chase:start',
  CHASE_END: 'chase:end',
  
  // Memory events
  ASSIGNED_TO_MEMORY: 'pet:assignedToMemory',
  UNASSIGNED_FROM_MEMORY: 'pet:unassignedFromMemory',
  MEMORY_ADDED: 'memory:added',
  MEMORY_REMOVED: 'memory:removed',
  PET_NEAR_MEMORY: 'pet:nearMemory',
  PET_LEFT_MEMORY: 'pet:leftMemory',
  
  // State events
  BOND_INCREASED: 'pet:bondIncreased',
  HAPPINESS_CHANGED: 'pet:happinessChanged',
  MODE_CHANGED: 'pet:modeChanged'
};

/**
 * @typedef {Object} PetEventData
 * @property {string} [petId] - Pet ID
 * @property {string} [memoryId] - Memory ID
 * @property {Object} [pet] - Pet object
 * @property {Object} [memory] - Memory object
 * @property {string} [mode] - AI mode
 * @property {number} [value] - Numeric value
 */

/**
 * Simple event emitter for pet system
 */
class PetEventEmitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event type
   * @param {Function} callback - Event handler
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  /**
   * Subscribe to an event once
   * @param {string} event - Event type
   * @param {Function} callback - Event handler
   */
  once(event, callback) {
    const wrapper = (data) => {
      callback(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - Event type
   * @param {Function} callback - Event handler to remove
   */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Emit an event
   * @param {string} event - Event type
   * @param {PetEventData} [data] - Event data
   */
  emit(event, data = {}) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler({ type: event, ...data, timestamp: Date.now() });
      } catch (err) {
        console.error(`Error in pet event handler for ${event}:`, err);
      }
    }
  }

  /**
   * Remove all listeners for an event
   * @param {string} [event] - Event type (all if not specified)
   */
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   * @param {string} event - Event type
   * @returns {number} Listener count
   */
  listenerCount(event) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/**
 * Global pet event emitter singleton
 * @type {PetEventEmitter}
 */
export const petEvents = new PetEventEmitter();

/**
 * Log all events (for debugging)
 * @param {boolean} [enable=true] - Enable logging
 * @returns {Function} Cleanup function
 */
export function enableEventLogging(enable = true) {
  if (!enable) return () => {};

  const unsubs = [];
  for (const event of Object.values(PET_EVENTS)) {
    unsubs.push(petEvents.on(event, (data) => {
      console.log(`[PetEvent] ${event}`, data);
    }));
  }

  return () => unsubs.forEach(fn => fn());
}

export default petEvents;
