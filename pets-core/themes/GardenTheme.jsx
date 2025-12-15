/**
 * @fileoverview Zen Garden theme environment wrapper
 * @module pets-core/themes/GardenTheme
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Instances, Instance, Sparkles, Grid } from '@react-three/drei';

/**
 * Zen Garden theme environment component
 * @param {Object} props - Component props
 * @param {THREE.Texture} props.rampTex - Toon ramp texture
 * @param {boolean} [props.isMobile] - Is mobile device
 */
export function GardenEnvironment({ rampTex, isMobile = false }) {
  // Materials
  const floorMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#7bcf7a'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const pathMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#e6d7b8'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const trunkMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#8b5a2b'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const leafMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#2f7d4f'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const rockMat = useMemo(() => {
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color('#a9b3bb'), gradientMap: rampTex });
    m.dithering = true;
    return m;
  }, [rampTex]);

  const rayMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffd89a'),
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
  }, []);

  // Geometries
  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.12, 0.16, 1.6, 7, 1), []);
  const leafGeo = useMemo(() => new THREE.IcosahedronGeometry(0.75, 0), []);
  const rockGeo = useMemo(() => new THREE.DodecahedronGeometry(0.55, 0), []);

  // Tree positions
  const treePoints = useMemo(() => {
    const pts = [];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 11.6 + Math.sin(i * 2.1) * 0.35 + Math.random() * 0.35;
      pts.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        s: 0.8 + Math.random() * 0.55,
        ry: Math.random() * Math.PI * 2
      });
    }
    return pts;
  }, []);

  // Rock positions
  const rockPoints = useMemo(() => {
    const pts = [];
    const n = 10;
    for (let i = 0; i < n; i++) {
      pts.push({
        x: (Math.random() * 2 - 1) * 7.8,
        z: (Math.random() * 2 - 1) * 7.8,
        s: 0.7 + Math.random() * 1.3,
        ry: Math.random() * Math.PI * 2
      });
    }
    return pts;
  }, []);

  const sparkleCount = isMobile ? 60 : 80;

  return (
    <group>
      {/* Grass floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} material={floorMat}>
        <circleGeometry args={[18, 48]} />
      </mesh>

      {/* Path ring */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} material={pathMat}>
        <ringGeometry args={[3.2, 3.9, 48]} />
      </mesh>

      {/* Soft grid */}
      <Grid
        position={[0, 0.02, 0]}
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.6}
        cellColor={'#ffffff'}
        sectionSize={5}
        sectionThickness={1}
        sectionColor={'#ffffff'}
        fadeDistance={18}
        fadeStrength={1}
        infiniteGrid={false}
      />

      {/* Tree trunks */}
      <Instances limit={treePoints.length} geometry={trunkGeo} material={trunkMat}>
        {treePoints.map((p, i) => (
          <Instance 
            key={i} 
            position={[p.x, 0.8, p.z]} 
            rotation={[0, p.ry, 0]} 
            scale={[p.s, 1.2 * p.s, p.s]} 
          />
        ))}
      </Instances>

      {/* Tree foliage */}
      <Instances limit={treePoints.length} geometry={leafGeo} material={leafMat}>
        {treePoints.map((p, i) => (
          <Instance 
            key={i} 
            position={[p.x, 2.1 * p.s, p.z]} 
            rotation={[0, p.ry * 0.7, 0]} 
            scale={[p.s * 1.2, p.s * 1.1, p.s * 1.2]} 
          />
        ))}
      </Instances>

      {/* Rocks */}
      <Instances limit={rockPoints.length} geometry={rockGeo} material={rockMat}>
        {rockPoints.map((p, i) => (
          <Instance 
            key={i} 
            position={[p.x, 0.32, p.z]} 
            rotation={[0, p.ry, 0]} 
            scale={[p.s, p.s * 0.7, p.s]} 
          />
        ))}
      </Instances>

      {/* God rays */}
      <mesh position={[4.5, 4.0, 1.5]} rotation={[Math.PI, 0.4, 0]} material={rayMat}>
        <coneGeometry args={[3.4, 7.0, 18, 1, true]} />
      </mesh>
      <mesh position={[-4.2, 4.1, -2.5]} rotation={[Math.PI, -0.55, 0]} material={rayMat}>
        <coneGeometry args={[3.0, 6.2, 18, 1, true]} />
      </mesh>
      <mesh position={[0.5, 3.8, -5.8]} rotation={[Math.PI, 0.1, 0]} material={rayMat}>
        <coneGeometry args={[3.2, 6.8, 18, 1, true]} />
      </mesh>

      {/* Pollen/Fireflies */}
      <Sparkles 
        count={sparkleCount} 
        speed={0.25} 
        opacity={0.35} 
        scale={[22, 4.2, 22]} 
        size={1.6} 
        color={'#ffdca8'} 
      />
    </group>
  );
}

/**
 * Garden theme configuration
 */
export const GARDEN_CONFIG = {
  background: '#e8f6ff',
  fog: { color: '#e2f0ff', near: 8, far: 38 },
  lighting: {
    hemisphere: { intensity: 0.85, skyColor: '#b7d8ff', groundColor: '#ffe5b8' },
    directional: { intensity: 1.5, position: [7, 10, 5], color: '#ffd700' }
  },
  bounds: { minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5 },
  rugs: [
    [-3.5, -3.5],
    [3.5, -3.5],
    [-3.5, 3.5],
    [3.5, 3.5],
    [0, 0]
  ]
};

export default GardenEnvironment;
