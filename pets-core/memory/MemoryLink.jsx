/**
 * @fileoverview Visual connection line/aura component for pet-memory link
 * @module pets-core/memory/MemoryLink
 */

import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';

/**
 * Visual link between a pet and its assigned memory
 * Shows a glowing line when pet is within range
 * @param {Object} props - Component props
 * @param {THREE.Vector3} props.petPosition - Current pet position
 * @param {THREE.Vector3} props.memoryPosition - Memory node position
 * @param {number} props.bondLevel - Bond strength (0-1)
 * @param {boolean} props.isNear - Is pet near the memory
 * @param {number} [props.maxDistance=10] - Max distance to show link
 */
export function MemoryLink({ 
  petPosition, 
  memoryPosition, 
  bondLevel = 0, 
  isNear = false,
  maxDistance = 10 
}) {
  const lineRef = useRef();
  const auraRef = useRef();
  const phaseRef = useRef(0);

  // Calculate distance
  const distance = useMemo(() => {
    if (!petPosition || !memoryPosition) return Infinity;
    return petPosition.distanceTo(memoryPosition);
  }, [petPosition?.x, petPosition?.z, memoryPosition?.x, memoryPosition?.z]);

  // Visibility based on distance and bond
  const visible = distance < maxDistance && bondLevel > 0.1;

  // Line color based on bond level
  const color = useMemo(() => {
    const hue = 0.55 + bondLevel * 0.15; // Cyan to blue
    return new THREE.Color().setHSL(hue, 0.8, 0.6);
  }, [bondLevel]);

  // Aura material
  const auraMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
  }, [color]);

  useFrame((_, dt) => {
    phaseRef.current += dt;

    // Animate line opacity
    if (lineRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(phaseRef.current * 2);
      const proximityBonus = isNear ? 0.3 : 0;
      lineRef.current.material.opacity = Math.min(1, (0.3 + bondLevel * 0.4 + proximityBonus) * pulse);
    }

    // Animate aura when near
    if (auraRef.current && isNear) {
      const scale = 1 + 0.15 * Math.sin(phaseRef.current * 3);
      auraRef.current.scale.setScalar(scale);
      auraMat.opacity = 0.15 + 0.15 * Math.sin(phaseRef.current * 2);
    }
  });

  if (!visible || !petPosition || !memoryPosition) return null;

  // Create curved line points
  const midY = Math.max(petPosition.y, memoryPosition.y) + 1.5 + bondLevel;
  const midPoint = new THREE.Vector3(
    (petPosition.x + memoryPosition.x) / 2,
    midY,
    (petPosition.z + memoryPosition.z) / 2
  );

  const curve = new THREE.QuadraticBezierCurve3(
    petPosition,
    midPoint,
    memoryPosition
  );
  const points = curve.getPoints(20);

  return (
    <group>
      {/* Connection line */}
      <Line
        ref={lineRef}
        points={points}
        color={color}
        lineWidth={2 + bondLevel * 2}
        transparent
        opacity={0.5}
        dashed={!isNear}
        dashScale={3}
        dashSize={0.5}
        dashOffset={phaseRef.current * 0.5}
      />

      {/* Aura ring at memory when near */}
      {isNear && (
        <mesh 
          ref={auraRef} 
          position={memoryPosition} 
          rotation={[-Math.PI / 2, 0, 0]}
          material={auraMat}
        >
          <ringGeometry args={[0.8 + bondLevel * 0.5, 1.2 + bondLevel, 32]} />
        </mesh>
      )}

      {/* Heart/bond indicator at midpoint when strong bond */}
      {bondLevel > 0.5 && (
        <mesh position={midPoint}>
          <sphereGeometry args={[0.08 + bondLevel * 0.08, 8, 6]} />
          <meshBasicMaterial 
            color={color} 
            transparent 
            opacity={0.6} 
          />
        </mesh>
      )}
    </group>
  );
}

/**
 * Simple aura effect around a memory node
 * @param {Object} props - Component props
 * @param {THREE.Vector3} props.position - Memory position
 * @param {boolean} props.hasGuardian - Has an assigned guardian
 * @param {number} props.bondLevel - Guardian bond level
 */
export function MemoryAura({ position, hasGuardian = false, bondLevel = 0 }) {
  const auraRef = useRef();
  const phaseRef = useRef(Math.random() * Math.PI * 2);

  const color = useMemo(() => {
    if (!hasGuardian) return new THREE.Color(0.5, 0.5, 0.5);
    const hue = 0.55 + bondLevel * 0.15;
    return new THREE.Color().setHSL(hue, 0.7, 0.5);
  }, [hasGuardian, bondLevel]);

  useFrame((_, dt) => {
    phaseRef.current += dt;
    if (auraRef.current) {
      const scale = 1 + 0.1 * Math.sin(phaseRef.current * 1.5);
      auraRef.current.scale.setScalar(scale);
    }
  });

  return (
    <mesh 
      ref={auraRef} 
      position={[position.x, position.y + 0.05, position.z]} 
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.3, 0.5, 24]} />
      <meshBasicMaterial 
        color={color} 
        transparent 
        opacity={hasGuardian ? 0.4 + bondLevel * 0.3 : 0.15}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

export default MemoryLink;
