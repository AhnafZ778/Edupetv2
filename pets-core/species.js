/**
 * @fileoverview Species definitions and configurations for Mind Palace Pets
 * @module pets-core/species
 */

/**
 * @typedef {Object} SpeciesConfig
 * @property {string} label - Display name
 * @property {string} [emoji] - Emoji representation
 * @property {number} [scale] - Size multiplier (default 1.0)
 * @property {'pointy'|'floppy'|'long'|'sharp'|'horn'} ear - Ear style
 * @property {'long'|'short'|'pom'} tail - Tail style
 * @property {boolean} [highTier] - Is this a rare species
 * @property {boolean} [mythical] - Is this a mythical species
 * @property {boolean} [hover] - Does this species hover/fly
 */

/**
 * Species registry with configurations
 * @type {Object.<string, SpeciesConfig>}
 */
export const SPECIES = {
  cat: { 
    label: 'Cat', 
    emoji: '🐱', 
    scale: 1.0, 
    ear: 'pointy', 
    tail: 'long' 
  },
  dog: { 
    label: 'Dog', 
    emoji: '🐶', 
    scale: 1.0, 
    ear: 'floppy', 
    tail: 'short' 
  },
  bunny: { 
    label: 'Bunny', 
    emoji: '🐰', 
    scale: 1.0, 
    ear: 'long', 
    tail: 'pom' 
  },
  tiger: { 
    label: 'Tiger', 
    emoji: '🐯', 
    scale: 1.5, 
    ear: 'pointy', 
    tail: 'long', 
    highTier: true 
  },
  wolf: { 
    label: 'Dire Wolf', 
    emoji: '🐺', 
    scale: 1.8, 
    ear: 'sharp', 
    tail: 'long', 
    highTier: true 
  },
  dragon: { 
    label: 'Dragon', 
    emoji: '🐲', 
    scale: 2.2, 
    ear: 'horn', 
    tail: 'long', 
    mythical: true, 
    hover: true 
  }
};

/**
 * Base species only (common tier)
 * @type {Object.<string, SpeciesConfig>}
 */
export const BASE_SPECIES = {
  cat: SPECIES.cat,
  dog: SPECIES.dog,
  bunny: SPECIES.bunny
};

/**
 * Cozy color palettes per species (hex values)
 * @type {Object.<string, number[]>}
 */
export const COLOR_PALETTES = {
  cat: [0xcdb4db, 0xbde0fe, 0xa2d2ff, 0xffc8dd],
  dog: [0xffd6a5, 0xfec89a, 0xfde4cf, 0xcdeac0],
  bunny: [0xd0f4de, 0xa9def9, 0xe4c1f9, 0xfcf6bd],
  tiger: [0xf4a261, 0xf6bd60, 0xfefae0],
  wolf: [0xb8c0c8, 0x7f8c99, 0xcfe9ff],
  dragon: [0x6ee7b7, 0x60a5fa, 0xa7f3d0]
};

/**
 * Pet name options for random generation
 * @type {string[]}
 */
export const PET_NAMES = [
  'Nova', 'Mochi', 'Cosmo', 'Luna', 'Pip', 'Byte', 
  'Orion', 'Echo', 'Comet', 'Bean', 'Nori', 'Pebble', 
  'Sprout', 'Kumo', 'Yuzu', 'Hana', 'Sora', 'Miso', 
  'Kiki', 'Taro'
];

/**
 * Get species configuration by key
 * @param {string} key - Species key
 * @returns {SpeciesConfig} Species configuration
 */
export function getSpecies(key) {
  return SPECIES[key] || SPECIES.cat;
}

/**
 * Pick random color from species palette
 * @param {string} speciesKey - Species key
 * @returns {number} Hex color value
 */
export function pickSpeciesColor(speciesKey) {
  const palette = COLOR_PALETTES[speciesKey] || COLOR_PALETTES.cat;
  return palette[Math.floor(Math.random() * palette.length)];
}

/**
 * Pick random pet name
 * @returns {string} Random name with number suffix
 */
export function pickPetName() {
  const name = PET_NAMES[Math.floor(Math.random() * PET_NAMES.length)];
  const num = Math.floor(Math.random() * 100);
  return `${name} ${num}`;
}

/**
 * Pick random species key
 * @param {boolean} [includeHighTier=false] - Include rare/mythical species
 * @returns {string} Species key
 */
export function pickRandomSpecies(includeHighTier = false) {
  const keys = includeHighTier 
    ? Object.keys(SPECIES) 
    : Object.keys(BASE_SPECIES);
  return keys[Math.floor(Math.random() * keys.length)];
}
