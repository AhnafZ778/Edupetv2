/**
 * @fileoverview Heart particle pool component
 * @module pets-core/components/HeartPool
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createHeartMaterial } from '../materials.js';
import { randRange, smoothstep, clamp } from '../utils.js';

/** Pool size for hearts */
const POOL_SIZE = 50;

// Pre-allocated objects for animation (avoid per-frame allocation)
const _tmpObj = new THREE.Object3D();

/**
 * Heart particle pool using instanced rendering
 * @param {Object} props - Component props
 * @param {Function} props.getEmitterRef - Callback to receive emitter API
 * @returns {JSX.Element} Instanced mesh
 */
export function HeartPool({ getEmitterRef }) {
  const meshRef = useRef();
  const hearts = useRef([]);

  const geometry = useMemo(() => new THREE.PlaneGeometry(0.22, 0.22, 1, 1), []);
  const material = useMemo(() => createHeartMaterial(), []);

  // Initialize pool
  useEffect(() => {
    hearts.current = new Array(POOL_SIZE).fill(0).map(() => ({
      active: false,
      pos: new THREE.Vector3(0, -999, 0),
      vel: new THREE.Vector3(0, 0, 0),
      life: 0,
      maxLife: 1,
      scale: 1
    }));
  }, []);

  /**
   * Emit hearts at a world position
   * @param {THREE.Vector3} worldPos - Emission position
   * @param {number} [n=2] - Number of hearts to emit
   */
  const emit = useCallback((worldPos, n = 2) => {
    const arr = hearts.current;
    for (let k = 0; k < n; k++) {
      const i = arr.findIndex((h) => !h.active);
      if (i < 0) break;
      const h = arr[i];
      h.active = true;
      h.life = 0;
      h.maxLife = randRange(0.75, 1.25);
      h.pos.copy(worldPos);
      h.pos.y += randRange(0.45, 0.75);
      h.vel.set(
        randRange(-0.006, 0.006), 
        randRange(0.010, 0.018), 
        randRange(-0.006, 0.006)
      );
      h.scale = randRange(0.8, 1.3);
    }
  }, []);

  // Expose emitter API
  useEffect(() => {
    getEmitterRef?.({ emit });
  }, [emit, getEmitterRef]);

  useFrame((_, dt) => {
    if (!meshRef.current) return;
    const arr = hearts.current;

    for (let i = 0; i < arr.length; i++) {
      const h = arr[i];
      if (!h.active) {
        _tmpObj.position.set(0, -999, 0);
        _tmpObj.scale.set(0.001, 0.001, 0.001);
        _tmpObj.rotation.set(0, 0, 0);
        _tmpObj.updateMatrix();
        meshRef.current.setMatrixAt(i, _tmpObj.matrix);
        continue;
      }

      h.life += dt;
      const t = h.life / h.maxLife;
      if (t >= 1) {
        h.active = false;
        continue;
      }

      // Physics update
      h.vel.y -= 0.002 * dt * 60;
      h.pos.addScaledVector(h.vel, dt * 60);

      // Fade out
      const fade = 1.0 - smoothstep(clamp((t - 0.55) / 0.45, 0, 1));
      const s = h.scale * (0.9 + t * 0.3);

      _tmpObj.position.copy(h.pos);
      _tmpObj.scale.set(s, s, s);
      _tmpObj.rotation.set(0, 0, Math.sin((i + t) * 7.0) * 0.25);
      _tmpObj.updateMatrix();
      meshRef.current.setMatrixAt(i, _tmpObj.matrix);

      material.uniforms.uOpacity.value = 0.95 * fade;
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh 
      ref={meshRef} 
      args={[geometry, material, POOL_SIZE]} 
      frustumCulled={false} 
    />
  );
}

export default HeartPool;
