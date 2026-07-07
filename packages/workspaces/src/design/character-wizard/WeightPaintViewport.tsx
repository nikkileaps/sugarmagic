/**
 * packages/workspaces/src/design/character-wizard/WeightPaintViewport.tsx
 *
 * Purpose: Plan 062 §062.8 — the weight-paint surface: the
 * SKINNED model with a per-vertex heatmap of the selected bone's
 * influence, a world-space brush (left-drag paints, right-drag
 * orbits, wheel zooms), and OPTIONAL live idle playback so edits
 * are judged in motion — the brush writes both the SkinWeights
 * arrays (via the pure character-rig ops the caller invokes) and
 * the live geometry's skinIndex/skinWeight attributes, so
 * deformation updates in real time.
 *
 * The viewport maps flattened solver-vertex indices to the loaded
 * three.js primitives via GLTFLoader's parser associations and
 * the extraction ranges — the same (meshIndex, primitiveIndex)
 * identity both sides derived from the GLB document.
 *
 * Status: active
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { SkinWeights } from "@sugarmagic/character-rig";
import { MAX_INFLUENCES, boneWeightOfVertex } from "@sugarmagic/character-rig";

export interface WeightPaintRange {
  meshIndex: number;
  primitiveIndex: number;
  vertexStart: number;
  vertexCount: number;
}

export interface WeightPaintViewportProps {
  /** The SKINNED model GLB (blob URL). */
  modelUrl: string;
  /** Idle clip GLB (blob URL) for the animate toggle; optional. */
  idleClipUrl: string | null;
  weights: SkinWeights;
  ranges: WeightPaintRange[];
  /** Column into weights.boneOrder currently being painted. */
  selectedBoneColumn: number;
  /** weights.boneOrder column -> skin joint slot (the builder's
   *  mapping; root occupies slot 0, so columns are offset). */
  columnToJointSlot: number[];
  /** World-space brush radius. */
  brushRadius: number;
  animating: boolean;
  /** Paint callback: world-space point; the caller applies the
   *  pure brush op and returns affected flattened vertex indices. */
  onPaint: (point: [number, number, number]) => number[];
}

const HEAT_LOW = new THREE.Color(0x1a2340);
const HEAT_HIGH = new THREE.Color(0xff4d6d);

export function WeightPaintViewport(props: WeightPaintViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  // Imperative handles the effect exposes for prop-driven updates.
  const refreshHeatmapRef = useRef<(vertices?: number[]) => void>(() => {});
  const mixerControlRef = useRef<(playing: boolean) => void>(() => {});

  // Selected bone / weights identity changes repaint the heatmap.
  useEffect(() => {
    refreshHeatmapRef.current();
  }, [props.selectedBoneColumn, props.weights]);
  useEffect(() => {
    mixerControlRef.current(props.animating);
  }, [props.animating]);

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

    const orbit = { yaw: Math.PI / 5, pitch: 0.25, radius: 3, targetY: 0.8 };
    function applyCamera() {
      camera.position.set(
        Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius,
        orbit.targetY + Math.sin(orbit.pitch) * orbit.radius,
        Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius
      );
      camera.lookAt(0, orbit.targetY, 0);
    }

    // Brush cursor: a Blender-style circle that lies ON the
    // surface — positioned at the hit point and oriented to the
    // surface normal, with a center dot for precision.
    const ringPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i += 1) {
      const angle = (i / 64) * Math.PI * 2;
      ringPoints.push(
        new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0)
      );
    }
    const cursor = new THREE.Group();
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(ringPoints),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: false
      })
    );
    ring.renderOrder = 20;
    cursor.add(ring);
    const centerDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    centerDot.renderOrder = 20;
    cursor.add(centerDot);
    cursor.visible = false;
    scene.add(cursor);
    const surfaceNormal = new THREE.Vector3();
    const zAxis = new THREE.Vector3(0, 0, 1);
    function placeCursor(hit: THREE.Intersection) {
      // World-space surface normal from the hit face.
      if (hit.face) {
        surfaceNormal
          .copy(hit.face.normal)
          .transformDirection(hit.object.matrixWorld)
          .normalize();
      } else {
        camera.getWorldDirection(surfaceNormal).negate();
      }
      cursor.position
        .copy(hit.point)
        .addScaledVector(surfaceNormal, 0.002);
      cursor.quaternion.setFromUnitVectors(zAxis, surfaceNormal);
      cursor.scale.setScalar(propsRef.current.brushRadius);
      cursor.visible = true;
    }

    let disposed = false;
    let mixer: THREE.AnimationMixer | null = null;
    let idleAction: THREE.AnimationAction | null = null;
    /** (meshIndex:primitiveIndex) -> three mesh + its range. */
    const paintTargets: Array<{
      mesh: THREE.Mesh;
      vertexStart: number;
      vertexCount: number;
    }> = [];

    const loader = new GLTFLoader();
    loader.load(propsRef.current.modelUrl, (gltf) => {
      if (disposed) return;
      scene.add(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const size = bounds.getSize(new THREE.Vector3());
      orbit.targetY = bounds.min.y + size.y / 2;
      orbit.radius = Math.max(2, size.y * 2.2);
      applyCamera();

      // Map primitives via parser associations.
      const associations = gltf.parser.associations as Map<
        THREE.Object3D,
        { meshes?: number; primitives?: number } | undefined
      >;
      gltf.scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const association = associations.get(mesh);
        if (!association || association.meshes === undefined) return;
        const range = propsRef.current.ranges.find(
          (candidate) =>
            candidate.meshIndex === association.meshes &&
            candidate.primitiveIndex === (association.primitives ?? 0)
        );
        if (!range) return;
        // Heatmap vertex colors + a material that shows them.
        const geometry = mesh.geometry as THREE.BufferGeometry;
        const colors = new Float32Array(range.vertexCount * 3);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        mesh.material = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.9
        });
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          mesh.frustumCulled = false;
        }
        paintTargets.push({
          mesh,
          vertexStart: range.vertexStart,
          vertexCount: range.vertexCount
        });
      });
      refreshHeatmap();

      // Idle playback (optional).
      if (propsRef.current.idleClipUrl) {
        loader.load(propsRef.current.idleClipUrl, (clipGltf) => {
          if (disposed) return;
          const clip = clipGltf.animations[0];
          if (!clip) return;
          mixer = new THREE.AnimationMixer(gltf.scene);
          idleAction = mixer.clipAction(clip);
          idleAction.play();
          idleAction.paused = !propsRef.current.animating;
        });
      }
    });

    function refreshHeatmap(vertices?: number[]) {
      const column = propsRef.current.selectedBoneColumn;
      const weights = propsRef.current.weights;
      for (const target of paintTargets) {
        const colorAttribute = (
          target.mesh.geometry as THREE.BufferGeometry
        ).getAttribute("color") as THREE.BufferAttribute;
        const refresh = (local: number) => {
          const flat = target.vertexStart + local;
          const weight = boneWeightOfVertex(weights, flat, column);
          const color = HEAT_LOW.clone().lerp(HEAT_HIGH, weight);
          colorAttribute.setXYZ(local, color.r, color.g, color.b);
        };
        if (vertices) {
          for (const flat of vertices) {
            if (
              flat >= target.vertexStart &&
              flat < target.vertexStart + target.vertexCount
            ) {
              refresh(flat - target.vertexStart);
            }
          }
        } else {
          for (let local = 0; local < target.vertexCount; local += 1) {
            refresh(local);
          }
        }
        colorAttribute.needsUpdate = true;
      }
    }
    refreshHeatmapRef.current = refreshHeatmap;

    /** Push edited weights into live skin attributes. */
    function syncSkinAttributes(vertices: number[]) {
      const weights = propsRef.current.weights;
      for (const target of paintTargets) {
        const geometry = target.mesh.geometry as THREE.BufferGeometry;
        const skinIndex = geometry.getAttribute(
          "skinIndex"
        ) as THREE.BufferAttribute | null;
        const skinWeight = geometry.getAttribute(
          "skinWeight"
        ) as THREE.BufferAttribute | null;
        if (!skinIndex || !skinWeight) continue;
        let touched = false;
        for (const flat of vertices) {
          if (
            flat < target.vertexStart ||
            flat >= target.vertexStart + target.vertexCount
          ) {
            continue;
          }
          const local = flat - target.vertexStart;
          const map = propsRef.current.columnToJointSlot;
          skinIndex.setXYZW(
            local,
            map[weights.joints[flat * MAX_INFLUENCES]!]!,
            map[weights.joints[flat * MAX_INFLUENCES + 1]!]!,
            map[weights.joints[flat * MAX_INFLUENCES + 2]!]!,
            map[weights.joints[flat * MAX_INFLUENCES + 3]!]!
          );
          skinWeight.setXYZW(
            local,
            weights.weights[flat * MAX_INFLUENCES]!,
            weights.weights[flat * MAX_INFLUENCES + 1]!,
            weights.weights[flat * MAX_INFLUENCES + 2]!,
            weights.weights[flat * MAX_INFLUENCES + 3]!
          );
          touched = true;
        }
        if (touched) {
          skinIndex.needsUpdate = true;
          skinWeight.needsUpdate = true;
        }
      }
    }

    mixerControlRef.current = (playing: boolean) => {
      if (idleAction) idleAction.paused = !playing;
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let painting = false;
    let orbiting = false;
    let lastPointer: [number, number] = [0, 0];

    function pointerToNdc(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    }

    function paintAt(event: PointerEvent) {
      pointerToNdc(event);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(
        paintTargets.map((target) => target.mesh)
      );
      const hit = hits[0];
      if (!hit) return;
      placeCursor(hit);
      const affected = propsRef.current.onPaint([
        hit.point.x,
        hit.point.y,
        hit.point.z
      ]);
      if (affected.length > 0) {
        refreshHeatmap(affected);
        syncSkinAttributes(affected);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      renderer.domElement.setPointerCapture(event.pointerId);
      if (event.button === 2) {
        orbiting = true;
        lastPointer = [event.clientX, event.clientY];
        return;
      }
      painting = true;
      paintAt(event);
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
      if (painting) {
        paintAt(event);
        return;
      }
      // Hover: show the brush ring.
      pointerToNdc(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(
        paintTargets.map((target) => target.mesh)
      )[0];
      if (hit) {
        placeCursor(hit);
      } else {
        cursor.visible = false;
      }
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture(event.pointerId);
      painting = false;
      orbiting = false;
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
    renderer.domElement.addEventListener("wheel", handleWheel, {
      passive: false
    });
    renderer.domElement.addEventListener("contextmenu", handleContextMenu);

    const clock = new THREE.Clock();
    let frame = 0;
    function renderLoop() {
      frame = requestAnimationFrame(renderLoop);
      const delta = clock.getDelta();
      mixer?.update(delta);
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
