/**
 * @fileoverview Color palettes and customization utilities
 * @module pets-core/customization/colors
 */

/**
 * Predefined color palettes for each species
 * Each palette has a name and array of hex colors
 */
export const COLOR_PALETTES = {
  // Classic/Natural palettes
  natural: {
    name: 'Natural',
    colors: [0xf5e6d3, 0xd4a574, 0x8b6914, 0x5c4033, 0x2c1810, 0x1a1a1a]
  },
  pastel: {
    name: 'Pastel',
    colors: [0xffc8dd, 0xffafcc, 0xbde0fe, 0xa2d2ff, 0xcdb4db, 0xffd6a5]
  },
  candy: {
    name: 'Candy',
    colors: [0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0x9b59b6, 0xff85a1]
  },
  cosmic: {
    name: 'Cosmic',
    colors: [0x7b2cbf, 0x9d4edd, 0xc77dff, 0xe0aaff, 0x10002b, 0x240046]
  },
  ocean: {
    name: 'Ocean',
    colors: [0x0077b6, 0x00b4d8, 0x90e0ef, 0xcaf0f8, 0x03045e, 0x023e8a]
  },
  sunset: {
    name: 'Sunset',
    colors: [0xffbe0b, 0xfb5607, 0xff006e, 0x8338ec, 0x3a0ca3, 0xf72585]
  },
  forest: {
    name: 'Forest',
    colors: [0x2d6a4f, 0x40916c, 0x52b788, 0x74c69d, 0x95d5b2, 0xb7e4c7]
  },
  monochrome: {
    name: 'Monochrome',
    colors: [0xffffff, 0xd9d9d9, 0xa6a6a6, 0x737373, 0x404040, 0x1a1a1a]
  }
};

/**
 * Species-specific recommended palettes
 */
export const SPECIES_PALETTES = {
  cat: ['natural', 'pastel', 'monochrome'],
  dog: ['natural', 'pastel', 'candy'],
  bunny: ['pastel', 'candy', 'natural'],
  tiger: ['sunset', 'natural', 'cosmic'],
  wolf: ['monochrome', 'forest', 'cosmic'],
  dragon: ['cosmic', 'sunset', 'ocean']
};

/**
 * Get all colors from a palette
 * @param {string} paletteKey - Palette key
 * @returns {number[]} Array of hex colors
 */
export function getPaletteColors(paletteKey) {
  return COLOR_PALETTES[paletteKey]?.colors || COLOR_PALETTES.pastel.colors;
}

/**
 * Get recommended palettes for a species
 * @param {string} speciesKey - Species key
 * @returns {string[]} Array of palette keys
 */
export function getRecommendedPalettes(speciesKey) {
  return SPECIES_PALETTES[speciesKey] || ['pastel', 'natural', 'candy'];
}

/**
 * Convert hex color to RGB object
 * @param {number} hex - Hex color value
 * @returns {{r: number, g: number, b: number}} RGB values (0-255)
 */
export function hexToRgb(hex) {
  return {
    r: (hex >> 16) & 255,
    g: (hex >> 8) & 255,
    b: hex & 255
  };
}

/**
 * Convert RGB to hex color
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {number} Hex color value
 */
export function rgbToHex(r, g, b) {
  return (r << 16) | (g << 8) | b;
}

/**
 * Convert hex to CSS color string
 * @param {number} hex - Hex color value
 * @returns {string} CSS color string (e.g., "#ff0000")
 */
export function hexToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/**
 * Convert CSS color to hex number
 * @param {string} css - CSS color string
 * @returns {number} Hex color value
 */
export function cssToHex(css) {
  return parseInt(css.replace('#', ''), 16);
}

/**
 * Lighten a color
 * @param {number} hex - Hex color
 * @param {number} amount - Amount to lighten (0-1)
 * @returns {number} Lightened hex color
 */
export function lightenColor(hex, amount = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.min(255, Math.round(r + (255 - r) * amount)),
    Math.min(255, Math.round(g + (255 - g) * amount)),
    Math.min(255, Math.round(b + (255 - b) * amount))
  );
}

/**
 * Darken a color
 * @param {number} hex - Hex color
 * @param {number} amount - Amount to darken (0-1)
 * @returns {number} Darkened hex color
 */
export function darkenColor(hex, amount = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(
    Math.round(r * (1 - amount)),
    Math.round(g * (1 - amount)),
    Math.round(b * (1 - amount))
  );
}

/**
 * Generate a random color from all palettes
 * @returns {number} Random hex color
 */
export function getRandomColor() {
  const palettes = Object.values(COLOR_PALETTES);
  const palette = palettes[Math.floor(Math.random() * palettes.length)];
  return palette.colors[Math.floor(Math.random() * palette.colors.length)];
}

/**
 * Get complementary color for details/accents
 * @param {number} bodyColor - Main body color
 * @returns {number} Complementary accent color
 */
export function getAccentColor(bodyColor) {
  const { r, g, b } = hexToRgb(bodyColor);
  // Simple complementary: invert and adjust
  const avgBrightness = (r + g + b) / 3;
  if (avgBrightness > 127) {
    return darkenColor(bodyColor, 0.4);
  } else {
    return lightenColor(bodyColor, 0.4);
  }
}
