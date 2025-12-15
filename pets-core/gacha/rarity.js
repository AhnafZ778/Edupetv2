/**
 * @fileoverview Gacha rarity system and probability weights
 * @module pets-core/gacha/rarity
 */

/**
 * Rarity tier definitions
 */
export const RARITY_TIERS = {
  common: {
    id: 'common',
    name: 'Common',
    color: 0x9ca3af, // Gray
    glowColor: 0xd1d5db,
    weight: 70,
    species: ['cat', 'dog', 'bunny'],
    starCount: 1
  },
  rare: {
    id: 'rare',
    name: 'Rare',
    color: 0x3b82f6, // Blue
    glowColor: 0x60a5fa,
    weight: 25,
    species: ['tiger', 'wolf'],
    starCount: 2
  },
  legendary: {
    id: 'legendary',
    name: 'Legendary',
    color: 0xfbbf24, // Gold
    glowColor: 0xfcd34d,
    weight: 5,
    species: ['dragon'],
    starCount: 3
  }
};

/**
 * Gacha configuration
 */
export const GACHA_CONFIG = {
  // First-time guarantee
  guaranteeRareWithinFirst: 3,
  
  // Pity system (guaranteed legendary)
  pityCounter: 50,
  pityRarityBoost: 'legendary',
  
  // Cost (for future currency system)
  summonCost: 100,
  
  // Animation timing (ms)
  revealDelay: 1500,
  starAnimationDelay: 200
};

/**
 * @typedef {Object} GachaPull
 * @property {string} speciesKey - Selected species
 * @property {string} rarity - Rarity tier
 * @property {boolean} isGuaranteed - Was this a guaranteed pull
 * @property {boolean} isPity - Was this a pity pull
 */

/**
 * Get species list by rarity
 * @param {string} rarity - Rarity tier
 * @returns {string[]} Species keys
 */
export function getSpeciesByRarity(rarity) {
  return RARITY_TIERS[rarity]?.species || RARITY_TIERS.common.species;
}

/**
 * Get rarity of a species
 * @param {string} speciesKey - Species key
 * @returns {string} Rarity tier
 */
export function getSpeciesRarity(speciesKey) {
  for (const [rarity, tier] of Object.entries(RARITY_TIERS)) {
    if (tier.species.includes(speciesKey)) {
      return rarity;
    }
  }
  return 'common';
}

/**
 * Calculate total weight for probability
 * @returns {number} Total weight
 */
function getTotalWeight() {
  return Object.values(RARITY_TIERS).reduce((sum, t) => sum + t.weight, 0);
}

/**
 * Roll a random rarity based on weights
 * @param {Object} [modifiers] - Optional modifiers
 * @param {number} [modifiers.luckBoost=0] - Increase rare/legendary chance (0-1)
 * @returns {string} Selected rarity
 */
export function rollRarity(modifiers = {}) {
  const { luckBoost = 0 } = modifiers;
  
  // Adjust weights with luck boost
  const adjustedWeights = {};
  let remainingBoost = luckBoost * 100;
  
  // Take from common, give to rare/legendary
  const commonReduction = Math.min(RARITY_TIERS.common.weight * 0.5, remainingBoost);
  adjustedWeights.common = RARITY_TIERS.common.weight - commonReduction;
  adjustedWeights.rare = RARITY_TIERS.rare.weight + commonReduction * 0.7;
  adjustedWeights.legendary = RARITY_TIERS.legendary.weight + commonReduction * 0.3;
  
  const total = adjustedWeights.common + adjustedWeights.rare + adjustedWeights.legendary;
  const roll = Math.random() * total;
  
  let cumulative = 0;
  for (const [rarity, weight] of Object.entries(adjustedWeights)) {
    cumulative += weight;
    if (roll < cumulative) {
      return rarity;
    }
  }
  
  return 'common';
}

/**
 * Select a random species from a rarity tier
 * @param {string} rarity - Rarity tier
 * @returns {string} Species key
 */
export function rollSpecies(rarity) {
  const species = getSpeciesByRarity(rarity);
  return species[Math.floor(Math.random() * species.length)];
}

/**
 * Gacha state manager
 */
export class GachaManager {
  constructor() {
    this.pullCount = 0;
    this.pullHistory = [];
    this.pityCounter = 0;
    this.hasReceivedFirstRare = false;
    
    // Load state from localStorage
    this.loadState();
  }
  
  /**
   * Load state from localStorage
   */
  loadState() {
    try {
      const saved = localStorage.getItem('mindPalace:gacha:v1');
      if (saved) {
        const data = JSON.parse(saved);
        this.pullCount = data.pullCount || 0;
        this.pityCounter = data.pityCounter || 0;
        this.hasReceivedFirstRare = data.hasReceivedFirstRare || false;
        this.pullHistory = data.pullHistory || [];
      }
    } catch {}
  }
  
  /**
   * Save state to localStorage
   */
  saveState() {
    try {
      localStorage.setItem('mindPalace:gacha:v1', JSON.stringify({
        pullCount: this.pullCount,
        pityCounter: this.pityCounter,
        hasReceivedFirstRare: this.hasReceivedFirstRare,
        pullHistory: this.pullHistory.slice(-100) // Keep last 100
      }));
    } catch {}
  }
  
  /**
   * Perform a gacha pull
   * @returns {GachaPull} Pull result
   */
  pull() {
    this.pullCount++;
    this.pityCounter++;
    
    let rarity;
    let isGuaranteed = false;
    let isPity = false;
    
    // Check pity (guaranteed legendary)
    if (this.pityCounter >= GACHA_CONFIG.pityCounter) {
      rarity = 'legendary';
      isPity = true;
      this.pityCounter = 0;
    }
    // Check first-time rare guarantee
    else if (!this.hasReceivedFirstRare && 
             this.pullCount <= GACHA_CONFIG.guaranteeRareWithinFirst) {
      // Force at least rare on the guarantee pull
      if (this.pullCount === GACHA_CONFIG.guaranteeRareWithinFirst) {
        rarity = Math.random() < 0.2 ? 'legendary' : 'rare';
        isGuaranteed = true;
      } else {
        rarity = rollRarity();
      }
    }
    // Normal roll
    else {
      rarity = rollRarity();
    }
    
    // Update rare tracking
    if (rarity !== 'common') {
      this.hasReceivedFirstRare = true;
      if (rarity === 'legendary') {
        this.pityCounter = 0;
      }
    }
    
    const speciesKey = rollSpecies(rarity);
    
    const result = {
      speciesKey,
      rarity,
      isGuaranteed,
      isPity,
      timestamp: Date.now()
    };
    
    this.pullHistory.push(result);
    this.saveState();
    
    return result;
  }
  
  /**
   * Get pull statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const counts = { common: 0, rare: 0, legendary: 0 };
    for (const pull of this.pullHistory) {
      counts[pull.rarity] = (counts[pull.rarity] || 0) + 1;
    }
    
    return {
      totalPulls: this.pullCount,
      pityCounter: this.pityCounter,
      untilPity: GACHA_CONFIG.pityCounter - this.pityCounter,
      counts,
      rates: {
        common: this.pullCount ? (counts.common / this.pullCount * 100).toFixed(1) : 0,
        rare: this.pullCount ? (counts.rare / this.pullCount * 100).toFixed(1) : 0,
        legendary: this.pullCount ? (counts.legendary / this.pullCount * 100).toFixed(1) : 0
      }
    };
  }
  
  /**
   * Reset gacha state (for testing)
   */
  reset() {
    this.pullCount = 0;
    this.pityCounter = 0;
    this.hasReceivedFirstRare = false;
    this.pullHistory = [];
    this.saveState();
  }
}

/**
 * Global gacha manager singleton
 */
export const gachaManager = new GachaManager();
