/**
 * @fileoverview React hooks for procedural texture generation
 * @module pets-core/hooks/useToonTextures
 */

import { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Create toon ramp texture for cel-shading
 * @returns {THREE.CanvasTexture} 3-step luminance ramp texture
 */
export function useToonRampTexture() {
  return useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 3;
    c.height = 1;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(3, 1);
    
    // 3-step luminance values: dark, mid, light
    const vals = [70, 160, 255];
    for (let i = 0; i < 3; i++) {
      const v = vals[i];
      img.data[i * 4 + 0] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

/**
 * Create blob shadow texture
 * @returns {THREE.CanvasTexture} Radial gradient shadow texture
 */
export function useBlobShadowTexture() {
  return useMemo(() => {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');

    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(
      size / 2, size / 2, 6, 
      size / 2, size / 2, size / 2
    );
    g.addColorStop(0, 'rgba(0,0,0,0.28)');
    g.addColorStop(0.60, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }, []);
}

/**
 * Hook to detect if running on mobile device
 * @returns {boolean} True if mobile device
 */
export function useIsMobile() {
  return useMemo(() => {
    if (typeof window === 'undefined') return false;
    return matchMedia('(pointer: coarse)').matches || 
           Math.min(window.innerWidth, window.innerHeight) < 720;
  }, []);
}
