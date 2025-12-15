/**
 * @fileoverview Utility functions for Mind Palace Pets
 * @module pets-core/utils
 */

/**
 * Clamp value between min and max
 * @param {number} v - Value to clamp
 * @param {number} a - Minimum
 * @param {number} b - Maximum
 * @returns {number} Clamped value
 */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Linear interpolation
 * @param {number} a - Start value
 * @param {number} b - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Smooth damp an angle (handles wraparound)
 * @param {number} a - Current angle
 * @param {number} b - Target angle
 * @param {number} t - Damping factor
 * @returns {number} Damped angle
 */
export function dampAngle(a, b, t) {
  let d = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

/**
 * Pick random element from array
 * @template T
 * @param {T[]} arr - Array to pick from
 * @returns {T} Random element
 */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Random value in range
 * @param {number} a - Minimum
 * @param {number} b - Maximum
 * @returns {number} Random value between a and b
 */
export function randRange(a, b) {
  return lerp(a, b, Math.random());
}

/**
 * Generate random ID
 * @returns {string} Random alphanumeric ID
 */
export function randId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Simple hash function for noise
 * @param {number} n - Input number
 * @returns {number} Hash value (0-1)
 */
export function hash1(n) {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
}

/**
 * Smoothstep interpolation
 * @param {number} t - Input (0-1)
 * @returns {number} Smoothed value
 */
export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * 1D value noise
 * @param {number} x - Input coordinate
 * @param {number} seed - Noise seed
 * @returns {number} Noise value (-1 to 1)
 */
export function noise1D(x, seed) {
  const i0 = Math.floor(x);
  const i1 = i0 + 1;
  const t = smoothstep(x - i0);
  const a = hash1(i0 * 127.1 + seed * 311.7);
  const b = hash1(i1 * 127.1 + seed * 311.7);
  return lerp(a, b, t) * 2 - 1;
}

/**
 * Check if device is mobile (coarse pointer or small screen)
 * @returns {boolean} True if mobile device
 */
export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  return matchMedia('(pointer: coarse)').matches || 
         Math.min(window.innerWidth, window.innerHeight) < 720;
}

/**
 * Local storage key for pet persistence
 * @param {string} theme - Theme name ('space' or 'garden')
 * @returns {string} localStorage key
 */
export function getStorageKey(theme) {
  return `mindPalace:${theme}Pets:v1`;
}

/**
 * Safely load pets from localStorage
 * @param {string} key - Storage key
 * @returns {Object[]|null} Parsed pets array or null
 */
export function safeLoadPets(key) {
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
 * @param {Object[]} pets - Pets array to save
 */
export function safeSavePets(key, pets) {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(pets));
  } catch {
    // Ignore quota errors
  }
}
