/**
 * packages/workspaces/src/design/animation-panel/PoseViewport.tsx
 *
 * Purpose: Plan 063 §063.5 — the puppet surface: the character
 * frozen at the composed base pose with draggable handles at the
 * wrists. Dragging a wrist pivots the WHOLE arm at the shoulder
 * (shortest-arc rotation of the upper arm; elbow angle preserved)
 * — single-joint puppet semantics, not chain IK. Mirroring is on
 * by default: one wrist drives both arms.
 *
 * Bones are posed exactly like clip playback poses them (absolute
 * contract-local rotations: rest * base * override), so the pose
 * you sculpt here is byte-for-byte the pose generation layers
 * motion onto.
 *
 * Status: active
 */

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STANDARD_RIG_CORE } from "@sugarmagic/domain";

type Quad = [number, number, number, number];

export interface PoseViewportProps {
  /** The rigged model GLB (blob URL). */
  modelUrl: string;
  /** Relaxed base pose per bone (before user overrides). */
  relaxedPose: Readonly<Record<string, readonly number[]>>;
  /** Current user overrides (bone -> quat, xyzw). */
  overrides: Readonly<Record<string, Quad>>;
  mirroring: boolean;
  /** Fired on drag END with the updated full override map. */
  onChange: (overrides: Record<string, Quad>) => void;
}

const HANDLES: Array<{
  /** The bone whose position the handle sits on. */
  handleBone: string;
  /** The bone the drag rotates. */
  pivotBone: string;
  /** The joint the rotation pivots around (pivotBone's head). */
  label: string;
  mirror: { handleBone: string; pivotBone: string };
}> = [
  {
    handleBone: "DEF-hand.L",
    pivotBone: "DEF-upper_arm.L",
    label: "Left wrist",
    mirror: { handleBone: "DEF-hand.R", pivotBone: "DEF-upper_arm.R" }
  },
  {
    handleBone: "DEF-hand.R",
    pivotBone: "DEF-upper_arm.R",
    label: "Right wrist",
    mirror: { handleBone: "DEF-hand.L", pivotBone: "DEF-upper_arm.L" }
  }
];

/** Mirror a bone-local rotation across the sagittal plane (valid
 *  for this rig's mirrored .L/.R rest frames). */
function mirrorQuat(q: Quad): Quad {
  return [q[0], -q[1], -q[2], q[3]];
}

export function PoseViewport(props: PoseViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const applyPoseRef = useRef<() => void>(() => {});

  // External override changes re-pose the skeleton.
  useEffect(() => {
    applyPoseRef.current();
  }, [props.overrides]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x14141f);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2, 4, 3);
    scene.add(key);

    const orbit = { yaw: Math.PI / 8, pitch: 0.15, radius: 3, targetY: 0.8 };
    const applyCamera = () => {
      camera.position.set(
        Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius,
        orbit.targetY + Math.sin(orbit.pitch) * orbit.radius,
        Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius
      );
      camera.lookAt(0, orbit.targetY, 0);
    };

    const restByName = new Map(
      STANDARD_RIG_CORE.bones.map((bone) => [bone.name, bone.restRotation])
    );

    let disposed = false;
    const bonesByName = new Map<string, THREE.Bone>();
    const handleMeshes: Array<{
      mesh: THREE.Mesh;
      config: (typeof HANDLES)[number];
    }> = [];

    // Pose = rest * relaxed * override, matching clip playback.
    function applyPose() {
      const { relaxedPose, overrides } = propsRef.current;
      for (const [name, bone] of bonesByName) {
        const rest = restByName.get(name);
        if (!rest) continue;
        const q = new THREE.Quaternion(rest[0], rest[1], rest[2], rest[3]);
        const relaxed = relaxedPose[name];
        if (relaxed) {
          q.multiply(
            new THREE.Quaternion(relaxed[0], relaxed[1], relaxed[2], relaxed[3])
          );
        }
        const override = overrides[name];
        if (override) {
          q.multiply(
            new THREE.Quaternion(override[0], override[1], override[2], override[3])
          );
        }
        bone.quaternion.copy(q);
      }
      scene.updateMatrixWorld(true);
      for (const handle of handleMeshes) {
        const bone = bonesByName.get(handle.config.handleBone);
        if (bone) bone.getWorldPosition(handle.mesh.position);
      }
    }
    applyPoseRef.current = applyPose;

    const loader = new GLTFLoader();
    loader.load(propsRef.current.modelUrl, (gltf) => {
      if (disposed) return;
      scene.add(gltf.scene);
      gltf.scene.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          bonesByName.set(child.name, child as THREE.Bone);
        }
        const mesh = child as THREE.SkinnedMesh;
        if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
      });
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const size = bounds.getSize(new THREE.Vector3());
      orbit.targetY = bounds.min.y + size.y / 2;
      orbit.radius = Math.max(2, size.y * 2.4);
      applyCamera();

      // Handles.
      const handleGeometry = new THREE.SphereGeometry(size.y * 0.035, 16, 12);
      for (const config of HANDLES) {
        const mesh = new THREE.Mesh(
          handleGeometry,
          new THREE.MeshBasicMaterial({
            color: 0x4dd2ff,
            transparent: true,
            opacity: 0.85,
            depthTest: false
          })
        );
        mesh.renderOrder = 30;
        scene.add(mesh);
        handleMeshes.push({ mesh, config });
      }
      applyPose();
    });

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging: (typeof handleMeshes)[number] | null = null;
    let orbiting = false;
    let lastPointer: [number, number] = [0, 0];
    const dragPlane = new THREE.Plane();
    const dragPoint = new THREE.Vector3();

    function pointerToNdc(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    }

    /** Rotate `pivotBone` so `handleBone`'s head follows target. */
    function pivotToward(
      pivotBoneName: string,
      handleBoneName: string,
      target: THREE.Vector3,
      recordInto: Record<string, Quad>
    ) {
      const pivotBone = bonesByName.get(pivotBoneName);
      const handleBone = bonesByName.get(handleBoneName);
      if (!pivotBone || !handleBone) return;
      const pivotPos = pivotBone.getWorldPosition(new THREE.Vector3());
      const handlePos = handleBone.getWorldPosition(new THREE.Vector3());
      const from = handlePos.clone().sub(pivotPos).normalize();
      const to = target.clone().sub(pivotPos).normalize();
      if (from.lengthSq() < 1e-9 || to.lengthSq() < 1e-9) return;
      const arcWorld = new THREE.Quaternion().setFromUnitVectors(from, to);
      // World premultiply expressed in the bone's local frame:
      // q_local' = (P^-1 * arc * P) * q_local
      const parentWorld = pivotBone.parent!.getWorldQuaternion(
        new THREE.Quaternion()
      );
      const localDelta = parentWorld
        .clone()
        .invert()
        .multiply(arcWorld)
        .multiply(parentWorld);
      // Override' = override * (poseLocal^-1 * delta * poseLocal)
      // is equivalent to appending the delta in pose-local space;
      // simpler: recompute override = (rest*relaxed)^-1 * newLocal.
      const newLocal = localDelta.multiply(pivotBone.quaternion);
      const rest = restByName.get(pivotBoneName)!;
      const relaxed = propsRef.current.relaxedPose[pivotBoneName];
      const baseQ = new THREE.Quaternion(rest[0], rest[1], rest[2], rest[3]);
      if (relaxed) {
        baseQ.multiply(
          new THREE.Quaternion(relaxed[0], relaxed[1], relaxed[2], relaxed[3])
        );
      }
      const override = baseQ.invert().multiply(newLocal);
      recordInto[pivotBoneName] = [override.x, override.y, override.z, override.w];
    }

    function currentOverrides(): Record<string, Quad> {
      const copy: Record<string, Quad> = {};
      for (const [bone, q] of Object.entries(propsRef.current.overrides)) {
        copy[bone] = [...q] as Quad;
      }
      return copy;
    }

    function handlePointerDown(event: PointerEvent) {
      renderer.domElement.setPointerCapture(event.pointerId);
      if (event.button === 2) {
        orbiting = true;
        lastPointer = [event.clientX, event.clientY];
        return;
      }
      pointerToNdc(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        handleMeshes.map((handle) => handle.mesh)
      )[0];
      if (!hit) return;
      dragging = handleMeshes.find((handle) => handle.mesh === hit.object) ?? null;
      if (dragging) {
        // Camera-parallel drag plane through the handle.
        const normal = camera.getWorldDirection(new THREE.Vector3()).negate();
        dragPlane.setFromNormalAndCoplanarPoint(normal, dragging.mesh.position);
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (orbiting) {
        const dx = event.clientX - lastPointer[0];
        const dy = event.clientY - lastPointer[1];
        lastPointer = [event.clientX, event.clientY];
        orbit.yaw -= dx * 0.008;
        orbit.pitch = Math.min(1.3, Math.max(-0.4, orbit.pitch + dy * 0.006));
        applyCamera();
        return;
      }
      if (!dragging) return;
      pointerToNdc(event);
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      const overrides = currentOverrides();
      pivotToward(
        dragging.config.pivotBone,
        dragging.config.handleBone,
        dragPoint,
        overrides
      );
      if (propsRef.current.mirroring) {
        // Mirror the PRIMARY side's resulting override onto the twin
        // (sagittal reflection of the local rotation).
        const primary = overrides[dragging.config.pivotBone];
        if (primary) {
          overrides[dragging.config.mirror.pivotBone] = mirrorQuat(primary);
        }
      }
      // Live-pose without notifying (commit on release).
      propsRef.current = { ...propsRef.current, overrides };
      applyPose();
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture(event.pointerId);
      orbiting = false;
      if (dragging) {
        dragging = null;
        propsRef.current.onChange(
          propsRef.current.overrides as Record<string, Quad>
        );
      }
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      orbit.radius = Math.min(
        12,
        Math.max(0.6, orbit.radius * (1 + event.deltaY * 0.001))
      );
      applyCamera();
    }
    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);

    let frame = 0;
    function renderLoop() {
      frame = requestAnimationFrame(renderLoop);
      const width = container!.clientWidth;
      const height = container!.clientHeight;
      if (width > 0 && height > 0) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      renderer.render(scene, camera);
    }
    applyCamera();
    renderLoop();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.modelUrl]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", borderRadius: 8, overflow: "hidden" }}
    />
  );
}
