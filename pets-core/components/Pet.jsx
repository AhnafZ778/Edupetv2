/**
 * @fileoverview Main Pet component with AI, animation, and interaction
 * @module pets-core/components/Pet
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { a, useSpring } from '@react-spring/three';
import { useDrag } from '@use-gesture/react';

import { getSpecies } from '../species.js';
import { getPetGeometries } from '../geometry.js';
import { 
  createEyeShaderMaterial, 
  getToonMat, 
  getDetailMat, 
  getBlobMat, 
  patchDragonFlapMaterial 
} from '../materials.js';
import { clamp, lerp, dampAngle, smoothstep } from '../utils.js';
import { createBrainState, updateBrain, calculateMovement, calculateYaw } from '../ai/brain.js';
import { createSocialState, updateSocialState, calculateSeparation, calculatePlayerSeparation } from '../ai/social.js';
import { useIsMobile } from '../hooks/useToonTextures.js';

/** Base Y position for pets */
const BASE_Y = 0.55;

// Pre-allocated vectors (avoid per-frame allocation)
const _tmp = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _leftEar = new THREE.Object3D();
const _rightEar = new THREE.Object3D();

/**
 * Pet component with full AI, animation, and interaction system
 * @param {Object} props - Component props
 */
export function Pet({
  pet,
  bounds,
  rugs,
  rampTex,
  blobTex,
  registerAPI,
  onCommit,
  onHover,
  setDragging,
  getPosMap,
  getHeartEmitter,
  chaseModeRef,
  isDraggingRef
}) {
  const { size, camera } = useThree();
  const isMobile = useIsMobile();

  const sp = getSpecies(pet.speciesKey);

  // Get cached geometries
  const { bodyGeo, headGeo, detailGeo, tailGeo, earGeo, faceGeo, hitGeo } = useMemo(
    () => getPetGeometries(pet.speciesKey),
    [pet.speciesKey]
  );

  // Materials
  const bodyMat = useMemo(() => {
    const m = getToonMat(rampTex, pet.bodyColor, pet.speciesKey);
    if (pet.speciesKey === 'dragon') patchDragonFlapMaterial(m);
    return m;
  }, [pet.bodyColor, pet.speciesKey, rampTex]);

  const detailMat = useMemo(() => getDetailMat(rampTex), [rampTex]);
  const blobMat = useMemo(() => getBlobMat(blobTex), [blobTex]);
  const hitMat = useMemo(() => new THREE.MeshBasicMaterial({ 
    transparent: true, 
    opacity: 0.0, 
    depthWrite: false 
  }), []);
  const eyeMat = useMemo(() => createEyeShaderMaterial(), []);

  // Refs
  const headRef = useRef();
  const tailRef = useRef();
  const earsRef = useRef();

  // Calculate hover height
  const hoverBaseY = sp.hover ? 1.50 : BASE_Y;

  // State refs
  const pos = useRef(new THREE.Vector3(pet.position[0], hoverBaseY, pet.position[1]));
  const vel = useRef(new THREE.Vector3());
  const yaw = useRef(pet.yaw ?? 0);

  const heldRef = useRef(false);
  const hoverRef = useRef(false);

  // Petting state
  const petting = useRef({ lastX: 0, lastDir: 0, flips: 0, love: 0, emitT: 0 });

  // AI state
  const brain = useRef(createBrainState(pet.seed));
  const social = useRef(createSocialState());

  // Spring animation
  const [{ p, r, s, lift }, api] = useSpring(() => ({
    p: [pos.current.x, pos.current.y, pos.current.z],
    r: [0, yaw.current, 0],
    s: [1, 1, 1],
    lift: 0,
    config: { mass: 1.0, tension: 240, friction: 26 }
  }));

  // Expose API to manager
  useEffect(() => {
    registerAPI?.(pet.id, {
      getPose: () => ({ 
        x: pos.current.x, 
        z: pos.current.z, 
        yaw: yaw.current, 
        mode: brain.current.mode, 
        speciesKey: pet.speciesKey 
      }),
      setSocial: ({ active, until, partnerId, partnerPos }) => {
        social.current.active = active;
        social.current.until = until;
        social.current.partnerId = partnerId;
        if (partnerPos) {
          social.current.partnerPos.copy(partnerPos);
          const dx = partnerPos.x - pos.current.x;
          const dz = partnerPos.z - pos.current.z;
          social.current.facePartnerYaw = Math.atan2(dx, dz);
        }
      },
      greet: () => {
        api.start({ 
          lift: 0.42, 
          s: [1.14, 0.86, 1.14], 
          config: { mass: 1.0, tension: 320, friction: 22 } 
        });
        setTimeout(() => api.start({ 
          lift: 0, 
          s: [1, 1, 1], 
          config: { mass: 1.0, tension: 240, friction: 26 } 
        }), 220);
      },
      nudgeToSleepSpot: (spot) => {
        brain.current.mode = 'sleeping';
        brain.current.t = lerp(3.0, 6.0, Math.random());
        brain.current.restSpot = { x: spot.x, y: spot.y, z: spot.z };
      }
    });
  }, [api, pet.id, pet.speciesKey, registerAPI]);

  // Drag plane helpers (pre-allocated)
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const setFromClient = useCallback((clientX, clientY) => {
    const ndc = {
      x: (clientX / size.width) * 2 - 1,
      y: -(clientY / size.height) * 2 + 1
    };
    raycaster.setFromCamera(ndc, camera);
  }, [camera, raycaster, size.height, size.width]);

  // Tap interaction
  const doTap = useCallback(() => {
    brain.current.lastInteractAt = performance.now() * 0.001;

    api.start({
      lift: sp.hover ? 0.35 : 0.58,
      r: [0, yaw.current + Math.PI * 2, 0],
      s: [1.18, 0.82, 1.18],
      config: { mass: 1.0, tension: 340, friction: 22 }
    });

    const emitter = getHeartEmitter?.();
    if (emitter?.emit) {
      emitter.emit(pos.current.clone(), sp.highTier || sp.mythical ? 3 : 2);
    }

    setTimeout(() => {
      api.start({ 
        lift: 0, 
        s: [1, 1, 1], 
        config: { mass: 1.0, tension: 240, friction: 26 } 
      });
    }, 240);
  }, [api, getHeartEmitter, sp.highTier, sp.hover, sp.mythical]);

  // Drag gesture
  const bind = useDrag(
    ({ first, last, active, tap, event, canceled }) => {
      if (tap) {
        event?.stopPropagation?.();
        doTap();
        return;
      }

      if (first) {
        event?.stopPropagation?.();
        heldRef.current = true;
        brain.current.mode = 'held';
        brain.current.lastInteractAt = performance.now() * 0.001;
        setDragging?.(pet.id);
        if (isDraggingRef) isDraggingRef.current = true;

        api.start({ 
          s: [0.92, 1.10, 0.92], 
          config: { mass: 1.05, tension: 360, friction: 24 } 
        });
      }

      if (active && event?.clientX != null && event?.clientY != null) {
        const liftY = sp.hover ? 2.3 : 1.5;
        plane.constant = -liftY;
        setFromClient(event.clientX, event.clientY);
        if (raycaster.ray.intersectPlane(plane, hit)) {
          const x = clamp(hit.x, bounds.minX, bounds.maxX);
          const z = clamp(hit.z, bounds.minZ, bounds.maxZ);
          pos.current.set(x, liftY, z);
          vel.current.set(0, 0, 0);
          api.start({
            p: [x, liftY, z],
            config: { mass: 1.25, tension: 280, friction: 30 }
          });
        }
      }

      if (last || canceled) {
        heldRef.current = false;
        setDragging?.(null);
        if (isDraggingRef) isDraggingRef.current = false;

        pos.current.y = hoverBaseY;
        brain.current.mode = social.current.active ? 'socializing' : 'wandering';

        api.start({
          p: [pos.current.x, hoverBaseY, pos.current.z],
          s: [1.22, 0.78, 1.22],
          config: { mass: 1.0, tension: 280, friction: 18 }
        });
        setTimeout(() => api.start({ 
          s: [1, 1, 1], 
          config: { mass: 1.0, tension: 240, friction: 26 } 
        }), 160);

        onCommit?.(pet.id, { position: [pos.current.x, pos.current.z], yaw: yaw.current });
      }

      if (active && event?.cancelable) event.preventDefault();
    },
    { pointer: { touch: true }, eventOptions: { passive: false } }
  );

  // Main update loop
  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const B = brain.current;

    // Update dragon wing flap
    if (pet.speciesKey === 'dragon' && bodyMat.userData?.uTime) {
      bodyMat.userData.uTime.value = t;
    }

    // Update social state
    if (updateSocialState(social.current, t)) {
      if (!heldRef.current && B.mode === 'socializing') {
        B.mode = 'wandering';
      }
    }

    // Love decay
    petting.current.love = Math.max(0, petting.current.love - dt * 0.55);
    if (petting.current.love > 0.2) {
      petting.current.emitT -= dt;
      if (petting.current.emitT <= 0) {
        petting.current.emitT = lerp(0.14, 0.22, Math.random());
        getHeartEmitter?.()?.emit?.(pos.current.clone(), 1);
      }
    }

    // Chase mode
    const chase = chaseModeRef?.current;
    if (!heldRef.current && chase?.active) {
      if (chase.chaserId === pet.id) {
        B.mode = 'chasing';
        B.t = chase.until - t;
        B.restSpot = { x: chase.runnerPos.x, y: hoverBaseY, z: chase.runnerPos.z };
      } else if (chase.runnerId === pet.id) {
        B.mode = 'running';
        B.t = chase.until - t;
      }
    }

    // Held behavior
    if (heldRef.current) {
      eyeMat.uniforms.uWide.value = lerp(eyeMat.uniforms.uWide.value, 1.0, 0.18);
      eyeMat.uniforms.uHappy.value = lerp(eyeMat.uniforms.uHappy.value, 0.0, 0.12);
      eyeMat.uniforms.uBlink.value = lerp(eyeMat.uniforms.uBlink.value, 0.0, 0.25);

      _tmp.set(
        camera.position.x - pos.current.x, 
        camera.position.y - (pos.current.y + 0.9), 
        camera.position.z - pos.current.z
      );
      _tmp.normalize();
      eyeMat.uniforms.uLook.value.set(_tmp.x, -_tmp.y);

      if (headRef.current) {
        headRef.current.rotation.x = lerp(headRef.current.rotation.x, -0.25, 0.18);
        headRef.current.rotation.z = lerp(
          headRef.current.rotation.z, 
          Math.sin(t * 10.0 + pet.seed) * 0.22, 
          0.22
        );
      }
      if (tailRef.current) {
        tailRef.current.rotation.y = Math.sin(t * 10.5) * 1.0;
        tailRef.current.rotation.x = Math.cos(t * 5.0) * 0.14;
      }
      return;
    }

    // Calculate player distance
    const dxp = camera.position.x - pos.current.x;
    const dzp = camera.position.z - pos.current.z;
    const dPlayer2 = dxp * dxp + dzp * dzp;

    // Update brain
    updateBrain(B, {
      dt,
      time: t,
      isHeld: heldRef.current,
      socialActive: social.current.active,
      playerDist2: dPlayer2,
      chaseMode: chase,
      petId: pet.id,
      rugs
    });

    // Handle social mode
    if (social.current.active) {
      B.mode = 'socializing';
    }

    // Calculate separation
    _sep.set(0, 0, 0);
    const map = getPosMap?.();
    if (map) {
      const sepVec = calculateSeparation(
        { x: pos.current.x, z: pos.current.z }, 
        map, 
        pet.id
      );
      _sep.x = sepVec.x;
      _sep.z = sepVec.z;
    }
    
    // Player separation
    const playerSep = calculatePlayerSeparation(
      { x: pos.current.x, z: pos.current.z },
      { x: camera.position.x, z: camera.position.z }
    );
    _sep.x += playerSep.x;
    _sep.z += playerSep.z;

    // Calculate movement
    const newVel = calculateMovement(
      B,
      { x: pos.current.x, z: pos.current.z },
      { x: vel.current.x, z: vel.current.z },
      {
        dt,
        time: t,
        bounds,
        playerPos: { x: camera.position.x, z: camera.position.z },
        chaseMode: chase,
        separationVec: { x: _sep.x, z: _sep.z },
        isMobile,
        baseY: BASE_Y
      }
    );

    vel.current.x = newVel.x;
    vel.current.z = newVel.z;

    // Integrate position
    pos.current.x += vel.current.x * dt * 60;
    pos.current.z += vel.current.z * dt * 60;
    pos.current.x = clamp(pos.current.x, bounds.minX, bounds.maxX);
    pos.current.z = clamp(pos.current.z, bounds.minZ, bounds.maxZ);

    // Hover for dragon
    if (sp.hover) {
      pos.current.y = hoverBaseY + Math.sin(t * 1.15 + pet.seed) * 0.12;
    } else {
      pos.current.y = hoverBaseY;
    }

    // Calculate yaw based on mode
    if (B.mode === 'socializing') {
      yaw.current = dampAngle(yaw.current, social.current.facePartnerYaw, 0.14);
    } else if (B.mode === 'curious') {
      const targetYaw = Math.atan2(dxp, dzp);
      if (isFinite(targetYaw)) yaw.current = dampAngle(yaw.current, targetYaw, 0.12);
    } else if (vel.current.x * vel.current.x + vel.current.z * vel.current.z > 0.0001) {
      yaw.current = calculateYaw(vel.current, yaw.current, 0.09);
    }

    // Animation
    const speed2 = vel.current.x * vel.current.x + vel.current.z * vel.current.z;
    const moving = speed2 > 0.0008 && !social.current.active && B.mode !== 'curious' && B.mode !== 'sleeping';
    const bob = moving 
      ? Math.sin(t * 6.0 + pet.seed) * 0.045 
      : Math.sin(t * 2.0 + pet.seed) * 0.016;
    const rock = moving ? Math.sin(t * 6.0 + pet.seed) * 0.06 : 0;

    // Sit/sleep scaling
    const nearRest = (B.mode === 'resting' || B.mode === 'sleeping') && 
      Math.sqrt(
        Math.pow(B.restSpot.x - pos.current.x, 2) + 
        Math.pow(B.restSpot.z - pos.current.z, 2)
      ) < 0.28;
    const sit = nearRest && B.mode === 'resting';
    const sleep = nearRest && B.mode === 'sleeping';
    const sitScale = sit ? [1.06, 0.84, 1.06] : sleep ? [1.10, 0.78, 1.10] : [1, 1, 1];

    api.start({
      p: [pos.current.x, pos.current.y + bob, pos.current.z],
      r: [rock, yaw.current, 0],
      s: sitScale,
      immediate: true
    });

    // Eye expression
    const blinkBase = 0.5 + 0.5 * Math.sin(t * 0.9 + pet.seed);
    const blinkPulse = smoothstep(clamp((blinkBase - 0.94) / 0.06, 0, 1)) * 0.9;
    const love = petting.current.love;
    const happy = clamp((love - 0.25) * 1.4, 0, 1);

    const targetBlink = sleep ? 1.0 : Math.max(blinkPulse, clamp(love * 0.4, 0, 0.35));
    eyeMat.uniforms.uBlink.value = lerp(eyeMat.uniforms.uBlink.value, targetBlink, 0.18);
    eyeMat.uniforms.uHappy.value = lerp(eyeMat.uniforms.uHappy.value, happy, 0.12);
    eyeMat.uniforms.uWide.value = lerp(eyeMat.uniforms.uWide.value, 0.0, 0.12);

    // Look direction
    let lookX = 0;
    let lookY = 0;
    if (social.current.active) {
      _tmp.set(
        social.current.partnerPos.x - pos.current.x, 
        0.2, 
        social.current.partnerPos.z - pos.current.z
      ).normalize();
      lookX = _tmp.x;
      lookY = -_tmp.y;
    } else if (B.mode === 'curious' || hoverRef.current || love > 0.25) {
      _tmp.set(dxp, camera.position.y - (pos.current.y + 0.9), dzp).normalize();
      lookX = _tmp.x;
      lookY = -_tmp.y;
    }
    eyeMat.uniforms.uLook.value.set(
      lerp(eyeMat.uniforms.uLook.value.x, lookX, 0.10),
      lerp(eyeMat.uniforms.uLook.value.y, lookY, 0.10)
    );

    // Head tilt
    if (headRef.current) {
      const wantsTilt = B.mode === 'curious' || hoverRef.current || love > 0.25;
      const tilt = wantsTilt ? 0.22 : 0.10;
      headRef.current.rotation.z = lerp(headRef.current.rotation.z, rock * 0.35, 0.16);
      headRef.current.rotation.x = lerp(
        headRef.current.rotation.x,
        (B.mode === 'curious' ? -tilt : -0.08) + (hoverRef.current ? 0.06 : 0) + (love > 0.25 ? 0.05 : 0),
        0.18
      );
    }

    // Tail wag
    if (tailRef.current) {
      const wagSpeed = moving ? 7.2 : 4.2;
      const wagAmp = moving ? 0.70 : 0.45;
      tailRef.current.rotation.y = Math.sin(t * wagSpeed) * wagAmp;
      tailRef.current.rotation.x = Math.cos(t * wagSpeed * 0.5) * 0.12;
    }

    // Ear twitch (using pre-allocated objects)
    if (earsRef.current) {
      const twitch = Math.sin(t * 6.5 + pet.seed) * 0.12;
      const scale = sp.scale || 1;

      const earY = sp.ear === 'long' ? 1.55 * scale : 1.35 * scale;
      const earZ = sp.ear === 'floppy' ? 0.10 * scale : 0.16 * scale;
      const earSX = sp.ear === 'long' ? 0.85 : 1.0;
      const earSY = sp.ear === 'long' ? 1.75 : 1.0;

      _leftEar.position.set(-0.30 * scale, earY, earZ);
      _rightEar.position.set(0.30 * scale, earY, earZ);
      _leftEar.scale.set(earSX, earSY, 0.95);
      _rightEar.scale.set(earSX, earSY, 0.95);

      if (sp.ear === 'pointy') {
        _leftEar.rotation.set(0, 0, 0.45 + twitch * 0.35);
        _rightEar.rotation.set(0, 0, -0.45 - twitch * 0.35);
      } else if (sp.ear === 'floppy') {
        _leftEar.rotation.set(0.2, 0, 0.85 + twitch * 0.25);
        _rightEar.rotation.set(0.2, 0, -0.85 - twitch * 0.25);
      } else if (sp.ear === 'sharp') {
        _leftEar.rotation.set(-0.05, 0, 0.55 + twitch * 0.25);
        _rightEar.rotation.set(-0.05, 0, -0.55 - twitch * 0.25);
      } else {
        _leftEar.rotation.set(-0.1, 0, 0.18 + twitch * 0.25);
        _rightEar.rotation.set(-0.1, 0, -0.18 - twitch * 0.25);
      }

      _leftEar.updateMatrix();
      _rightEar.updateMatrix();
      _m1.copy(_leftEar.matrix);
      _m2.copy(_rightEar.matrix);
      earsRef.current.setMatrixAt(0, _m1);
      earsRef.current.setMatrixAt(1, _m2);
      earsRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  // Petting detection
  const onPetMove = useCallback((e) => {
    if (heldRef.current) return;
    const localX = e.point.x;
    const dx = localX - petting.current.lastX;
    petting.current.lastX = localX;

    const dir = dx > 0.003 ? 1 : dx < -0.003 ? -1 : 0;
    if (dir !== 0 && petting.current.lastDir !== 0 && dir !== petting.current.lastDir) {
      petting.current.flips++;
    }
    if (dir !== 0) petting.current.lastDir = dir;

    if (petting.current.flips >= 3) {
      petting.current.flips = 0;
      petting.current.love = clamp(petting.current.love + 0.22, 0, 1);
      brain.current.lastInteractAt = performance.now() * 0.001;

      api.start({ 
        s: [1.06, 0.90, 1.06], 
        config: { mass: 1.0, tension: 200, friction: 22 } 
      });
      setTimeout(() => api.start({ 
        s: [1, 1, 1], 
        config: { mass: 1.0, tension: 240, friction: 26 } 
      }), 160);

      getHeartEmitter?.()?.emit?.(pos.current.clone(), 1);
    }
  }, [api, getHeartEmitter]);

  const scale = sp.scale || 1;

  return (
    <a.group
      {...bind()}
      position={p.to((x, y, z) => [x, y + lift.get(), z])}
      rotation={r}
      scale={s}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoverRef.current = true;
        onHover?.(pet);
      }}
      onPointerOut={() => {
        hoverRef.current = false;
        onHover?.(null);
      }}
    >
      {/* Blob shadow */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.01, 0]} material={blobMat}>
        <planeGeometry args={[1.75 * scale, 1.75 * scale]} />
      </mesh>

      {/* Body + details */}
      <mesh geometry={bodyGeo} material={bodyMat} />
      <mesh geometry={detailGeo} material={detailMat} />

      {/* Head group */}
      <group ref={headRef}>
        <mesh geometry={headGeo} material={bodyMat} />
        <mesh 
          geometry={faceGeo} 
          material={eyeMat} 
          position={[0, 1.02 * scale, 0.63 * scale]} 
        />
        <instancedMesh ref={earsRef} args={[earGeo, bodyMat, 2]} />
      </group>

      {/* Tail */}
      <group ref={tailRef}>
        <mesh geometry={tailGeo} material={bodyMat} />
      </group>

      {/* Hitbox */}
      <mesh
        geometry={hitGeo}
        material={hitMat}
        onPointerMove={(e) => {
          e.stopPropagation();
          onPetMove(e);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      />
    </a.group>
  );
}

export default Pet;
