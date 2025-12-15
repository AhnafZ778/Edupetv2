/**
 * @fileoverview Pet state management hook
 * @module pets-core/hooks/usePetState
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { randId } from '../utils.js';
import { SPECIES, pickSpeciesColor, pickPetName, pickRandomSpecies } from '../species.js';

/**
 * Storage key generator
 * @param {string} theme - Theme name
 * @returns {string} Storage key
 */
function getStorageKey(theme) {
  return `mindPalace:${theme}Pets:v1`;
}

/**
 * Safely load pets from localStorage
 * @param {string} key - Storage key
 * @returns {Object[]|null} Pets array or null
 */
function safeLoadPets(key) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Safely save pets to localStorage
 * @param {string} key - Storage key
 * @param {Object[]} pets - Pets array
 */
function safeSavePets(key, pets) {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(pets));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Create a new pet with random attributes
 * @param {string} [speciesKey] - Optional species key
 * @param {boolean} [includeHighTier=false] - Include rare species
 * @returns {Object} New pet object
 */
export function createPet(speciesKey, includeHighTier = false) {
  const key = speciesKey || pickRandomSpecies(includeHighTier);
  const x = (Math.random() * 2 - 1) * 6.8;
  const z = (Math.random() * 2 - 1) * 6.8;
  
  return {
    id: randId(),
    name: pickPetName(),
    speciesKey: key,
    bodyColor: pickSpeciesColor(key),
    position: [x, z],
    yaw: Math.random() * Math.PI * 2,
    seed: Math.random() * 10
  };
}

/**
 * Create default starting pets
 * @returns {Object[]} Default pets array
 */
export function createDefaultPets() {
  return [
    {
      id: 'pet_a',
      name: 'Nova 12',
      speciesKey: 'cat',
      bodyColor: 0xcdb4db,
      position: [-2.0, 0.5],
      yaw: 0,
      seed: 1.2
    },
    {
      id: 'pet_b',
      name: 'Mochi 7',
      speciesKey: 'dog',
      bodyColor: 0xffd6a5,
      position: [2.2, -1.1],
      yaw: Math.PI,
      seed: 2.4
    },
    {
      id: 'pet_c',
      name: 'Pip 42',
      speciesKey: 'bunny',
      bodyColor: 0xd0f4de,
      position: [0.2, 2.2],
      yaw: Math.PI * 0.5,
      seed: 3.7
    }
  ];
}

/**
 * Hook for managing pet state with persistence
 * @param {Object} options - Hook options
 * @param {string} options.theme - Theme name for storage key
 * @param {number} [options.maxPets=12] - Maximum allowed pets
 * @param {boolean} [options.includeHighTier=false] - Allow high-tier species
 * @returns {Object} Pet state and actions
 */
export function usePetState({ theme, maxPets = 12, includeHighTier = false }) {
  const storageKey = getStorageKey(theme);
  
  // Initialize from localStorage or defaults
  const [pets, setPets] = useState(() => {
    return safeLoadPets(storageKey) ?? createDefaultPets();
  });
  
  // Keep ref in sync for callbacks
  const petsRef = useRef(pets);
  useEffect(() => {
    petsRef.current = pets;
  }, [pets]);
  
  // Persist on change
  useEffect(() => {
    safeSavePets(storageKey, pets);
  }, [pets, storageKey]);
  
  /**
   * Add a new pet
   * @param {string} [speciesKey] - Optional species key
   * @returns {Object|null} New pet or null if at max
   */
  const addPet = useCallback((speciesKey) => {
    if (petsRef.current.length >= maxPets) return null;
    
    const newPet = createPet(speciesKey, includeHighTier);
    setPets(prev => [...prev, newPet]);
    return newPet;
  }, [maxPets, includeHighTier]);
  
  /**
   * Remove a pet by ID
   * @param {string} id - Pet ID
   */
  const removePet = useCallback((id) => {
    setPets(prev => prev.filter(p => p.id !== id));
  }, []);
  
  /**
   * Update pet properties
   * @param {string} id - Pet ID
   * @param {Object} patch - Properties to update
   */
  const updatePet = useCallback((id, patch) => {
    setPets(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);
  
  /**
   * Reset to default pets
   */
  const resetPets = useCallback(() => {
    setPets(createDefaultPets());
  }, []);
  
  /**
   * Get pet by ID
   * @param {string} id - Pet ID
   * @returns {Object|undefined} Pet or undefined
   */
  const getPet = useCallback((id) => {
    return petsRef.current.find(p => p.id === id);
  }, []);
  
  return {
    pets,
    petsRef,
    addPet,
    removePet,
    updatePet,
    resetPets,
    getPet,
    count: pets.length,
    maxPets,
    canAdd: pets.length < maxPets
  };
}
