/**
 * @fileoverview React context provider for pet state
 * @module pets-core/context/PetContext
 */

import React, { createContext, useContext, useCallback, useRef, useEffect, useState } from 'react';
import { petEvents, PET_EVENTS } from '../events/PetEventEmitter.js';
import { memoryRegistry } from '../memory/guardian.js';
import { obstacleRegistry } from '../environment/obstacles.js';
import { restSpotRegistry } from '../environment/restSpots.js';

/**
 * @typedef {Object} PetContextValue
 * @property {Object[]} pets - Array of pet data
 * @property {Function} addPet - Add a new pet
 * @property {Function} removePet - Remove a pet
 * @property {Function} updatePet - Update pet properties
 * @property {Function} getPet - Get pet by ID
 * @property {Function} assignToMemory - Assign pet as memory guardian
 * @property {Function} unassignFromMemory - Remove guardian assignment
 * @property {Function} getAssignedMemory - Get pet's assigned memory
 * @property {Object} registries - Access to registries
 */

const PetContext = createContext(null);

/**
 * Pet context provider component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 * @param {string} [props.storageKey='mindPalace:pets:v2'] - localStorage key
 * @param {number} [props.maxPets=12] - Maximum allowed pets
 */
export function PetProvider({ children, storageKey = 'mindPalace:pets:v2', maxPets = 12 }) {
  // Pet state
  const [pets, setPets] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const petsRef = useRef(pets);
  useEffect(() => {
    petsRef.current = pets;
  }, [pets]);

  // Persist on change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pets));
    } catch {}
  }, [pets, storageKey]);

  // Pet API maps
  const petAPIs = useRef(new Map());

  /**
   * Register a pet's runtime API
   */
  const registerPetAPI = useCallback((petId, api) => {
    petAPIs.current.set(petId, api);
    return () => petAPIs.current.delete(petId);
  }, []);

  /**
   * Add a new pet
   */
  const addPet = useCallback((petData) => {
    if (petsRef.current.length >= maxPets) return null;
    const newPet = {
      id: `pet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ...petData,
      bondLevel: 0,
      happiness: 0.5,
      activityHistory: [],
      assignedMemoryId: null,
      createdAt: Date.now()
    };
    setPets(prev => [...prev, newPet]);
    petEvents.emit(PET_EVENTS.PET_SPAWNED, { petId: newPet.id, pet: newPet });
    return newPet;
  }, [maxPets]);

  /**
   * Remove a pet
   */
  const removePet = useCallback((petId) => {
    // Cleanup assignments
    memoryRegistry.unassignGuardian(petId);
    restSpotRegistry.releaseByPet(petId);
    
    setPets(prev => prev.filter(p => p.id !== petId));
    petEvents.emit(PET_EVENTS.PET_REMOVED, { petId });
  }, []);

  /**
   * Update pet properties
   */
  const updatePet = useCallback((petId, patch) => {
    setPets(prev => {
      const idx = prev.findIndex(p => p.id === petId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  /**
   * Get pet by ID
   */
  const getPet = useCallback((petId) => {
    return petsRef.current.find(p => p.id === petId);
  }, []);

  /**
   * Assign pet as memory guardian
   */
  const assignToMemory = useCallback((petId, memoryId) => {
    const success = memoryRegistry.assignGuardian(petId, memoryId);
    if (success) {
      updatePet(petId, { assignedMemoryId: memoryId });
      logActivity(petId, 'assignedToMemory', { memoryId });
    }
    return success;
  }, [updatePet]);

  /**
   * Remove guardian assignment
   */
  const unassignFromMemory = useCallback((petId) => {
    memoryRegistry.unassignGuardian(petId);
    updatePet(petId, { assignedMemoryId: null });
  }, [updatePet]);

  /**
   * Get pet's assigned memory
   */
  const getAssignedMemory = useCallback((petId) => {
    return memoryRegistry.getAssignedMemory(petId);
  }, []);

  /**
   * Increase pet happiness
   */
  const increaseHappiness = useCallback((petId, amount = 0.1) => {
    const pet = getPet(petId);
    if (!pet) return;
    const newHappiness = Math.min(1, (pet.happiness || 0.5) + amount);
    updatePet(petId, { happiness: newHappiness });
    petEvents.emit(PET_EVENTS.HAPPINESS_CHANGED, { petId, value: newHappiness });
  }, [getPet, updatePet]);

  /**
   * Increase pet bond level
   */
  const increaseBond = useCallback((petId, amount = 0.05) => {
    const pet = getPet(petId);
    if (!pet) return;
    const newBond = Math.min(1, (pet.bondLevel || 0) + amount);
    updatePet(petId, { bondLevel: newBond });
    memoryRegistry.updateBond(petId, amount);
    petEvents.emit(PET_EVENTS.BOND_INCREASED, { petId, value: newBond });
  }, [getPet, updatePet]);

  /**
   * Log activity to pet's history
   */
  const logActivity = useCallback((petId, action, data = {}) => {
    const pet = getPet(petId);
    if (!pet) return;
    
    const history = pet.activityHistory || [];
    const entry = { action, ...data, timestamp: Date.now() };
    
    // Keep last 50 entries
    const newHistory = [...history.slice(-49), entry];
    updatePet(petId, { activityHistory: newHistory });
  }, [getPet, updatePet]);

  /**
   * Get pet runtime API
   */
  const getPetAPI = useCallback((petId) => {
    return petAPIs.current.get(petId);
  }, []);

  const contextValue = {
    // State
    pets,
    petsRef,
    
    // CRUD
    addPet,
    removePet,
    updatePet,
    getPet,
    
    // Memory
    assignToMemory,
    unassignFromMemory,
    getAssignedMemory,
    
    // Stats
    increaseHappiness,
    increaseBond,
    logActivity,
    
    // Runtime
    registerPetAPI,
    getPetAPI,
    
    // Registries
    registries: {
      memory: memoryRegistry,
      obstacles: obstacleRegistry,
      restSpots: restSpotRegistry
    },
    
    // Events
    events: petEvents,
    PET_EVENTS
  };

  return (
    <PetContext.Provider value={contextValue}>
      {children}
    </PetContext.Provider>
  );
}

/**
 * Hook to access pet context
 * @returns {PetContextValue} Pet context value
 */
export function usePetContext() {
  const context = useContext(PetContext);
  if (!context) {
    throw new Error('usePetContext must be used within a PetProvider');
  }
  return context;
}

/**
 * Hook to subscribe to pet events
 * @param {string} event - Event type
 * @param {Function} handler - Event handler
 */
export function usePetEvent(event, handler) {
  useEffect(() => {
    return petEvents.on(event, handler);
  }, [event, handler]);
}

export default PetContext;
