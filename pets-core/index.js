/**
 * @fileoverview Main entry point for pets-core module
 * @module pets-core
 */

// Species and utilities
export * from './species.js';
export * from './utils.js';

// Geometry and materials
export * from './geometry.js';
export * from './materials.js';

// AI modules
export * from './ai/brain.js';
export * from './ai/social.js';

// Environment modules (Phase 2)
export * from './environment/obstacles.js';
export * from './environment/restSpots.js';
export * from './environment/ground.js';

// Memory modules (Phase 2)
export * from './memory/guardian.js';
export { MemoryLink, MemoryAura } from './memory/MemoryLink.jsx';

// Events system (Phase 2)
export * from './events/PetEventEmitter.js';

// Context (Phase 2)
export { PetProvider, usePetContext, usePetEvent } from './context/PetContext.jsx';

// Hooks
export * from './hooks/useToonTextures.js';
export * from './hooks/usePetState.js';

// Components
export { Pet } from './components/Pet.jsx';
export { HeartPool } from './components/HeartPool.jsx';

// Themes
export { SpaceEnvironment, SPACE_CONFIG } from './themes/SpaceTheme.jsx';
export { GardenEnvironment, GARDEN_CONFIG } from './themes/GardenTheme.jsx';
