/**
 * @fileoverview Space theme environment wrapper
 * @module pets-core/themes/SpaceTheme
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Grid, Stars, Sparkles } from '@react-three/drei';

/**
 * Space theme environment component
 * @param {Object} props - Component props
 * @param {Object} props.bounds - Room bounds {minX, maxX, minZ, maxZ}
 * @param {THREE.Texture} props.rampTex - Toon ramp texture
 * @param {boolean} [props.isMobile] - Is mobile device
 */
export function SpaceEnvironment({ bounds, rampTex, isMobile = false }) {
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;

  const floorMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: 0x07071c, gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const wallMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: 0x0e0e2a, gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const rayMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x9ab0ff),
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }, []);

  return (
    <group>
      {/* Floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} material={floorMat}>
        <planeGeometry args={[w + 6, d + 6]} />
      </mesh>

      {/* Grid */}
      <Grid
        position={[0, 0.02, 0]}
        args={[w + 2, d + 2]}
        cellSize={1}
        cellThickness={0.75}
        cellColor={'#3b4bff'}
        sectionSize={5}
        sectionThickness={1.15}
        sectionColor={'#1a1a44'}
        fadeDistance={22}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* Walls */}
      <mesh position={[0, 1.0, bounds.maxZ + 0.30]} material={wallMat}>
        <boxGeometry args={[w + 2.2, 2, 0.6]} />
      </mesh>
      <mesh position={[0, 1.0, bounds.minZ - 0.30]} material={wallMat}>
        <boxGeometry args={[w + 2.2, 2, 0.6]} />
      </mesh>
      <mesh position={[bounds.maxX + 0.30, 1.0, 0]} material={wallMat}>
        <boxGeometry args={[0.6, 2, d + 2.2]} />
      </mesh>
      <mesh position={[bounds.minX - 0.30, 1.0, 0]} material={wallMat}>
        <boxGeometry args={[0.6, 2, d + 2.2]} />
      </mesh>

      {/* God rays */}
      <mesh position={[3.5, 2.4, 2.0]} rotation={[Math.PI, 0.4, 0]} material={rayMat}>
        <coneGeometry args={[2.8, 4.8, 18, 1, true]} />
      </mesh>
      <mesh position={[-3.8, 2.5, -1.0]} rotation={[Math.PI, -0.6, 0]} material={rayMat}>
        <coneGeometry args={[2.6, 4.2, 18, 1, true]} />
      </mesh>
      <mesh position={[0.0, 2.3, -4.2]} rotation={[Math.PI, 0.05, 0]} material={rayMat}>
        <coneGeometry args={[2.9, 5.0, 18, 1, true]} />
      </mesh>

      {/* Dust motes */}
      <Sparkles
        count={isMobile ? 80 : 120}
        speed={0.25}
        opacity={0.30}
        scale={[w + 8, 2.8, d + 8]}
        size={1.4}
        color={'#cbd7ff'}
      />

      {/* Stars */}
      <Stars 
        radius={55} 
        depth={28} 
        count={isMobile ? 300 : 900} 
        factor={isMobile ? 2 : 2.4} 
        saturation={0} 
        fade 
        speed={0.35} 
      />
    </group>
  );
}

/**
 * Space theme configuration
 */
export const SPACE_CONFIG = {
  background: '#050510',
  fog: { color: '#050510', near: 10, far: 42 },
  lighting: {
    ambient: { intensity: 0.85, color: '#8899ff' },
    directional1: { intensity: 1.0, position: [7, 10, 5], color: '#ffffff' },
    directional2: { intensity: 0.40, position: [-6, 7, -8], color: '#6688ff' }
  },
  bounds: { minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 },
  rugs: [
    [-6, -6],
    [6, -6],
    [-6, 6],
    [6, 6],
    [0, 0]
  ]
};

export default SpaceEnvironment;
