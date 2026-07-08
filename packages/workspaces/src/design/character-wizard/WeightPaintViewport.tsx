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
  /** Piece isolation: -1 = all; otherwise index into `ranges` —
   *  other pieces ghost out and stop catching brush raycasts, so
   *  layered shells (tail behind the torso) are paintable. */
  isolatedPiece: number;
  /** Region isolation (Plan 064): a virtual body-region vertex
   *  set. Cross-cuts material pieces — non-members go dark in the
   *  heatmap and stop catching raycasts/boxes. Null = off. */
  regionSet: ReadonlySet<number> | null;
  /** Bumped by out-of-band weight edits (Fill piece, Reset) so
   *  the heatmap AND the live skin attributes fully resync. */
  weightsVersion: number;
  /** Box-select mode (Plan 064): left-drag draws a screen-space
   *  box; verts inside it (piece-filtered; back-facing verts
   *  excluded unless x-ray) become the selection. Shift-drag adds
   *  to it. */
  selectMode: boolean;
  xray: boolean;
  /** Current selection (flattened vertex indices) — tinted in the
   *  heatmap. */
  selection: ReadonlySet<number>;
  onSelect: (vertices: number[], additive: boolean) => void;
  /** Paint callback: the clicked face's FLATTENED vertex indices
   *  (rest-space identity — valid even while the mesh is posed by
   *  the Animate toggle). The caller centers the brush on their
   *  rest positions and returns affected vertex indices. */
  onPaint: (faceVertices: [number, number, number]) => number[];
}

const HEAT_LOW = new THREE.Color(0x1a2340);
const GHOST = new THREE.Color(0x0d0e16);
const HEAT_HIGH = new THREE.Color(0xff4d6d);
const SELECT_TINT = new THREE.Color(0xf7d774);

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
  const isolationRef = useRef<() => void>(() => {});
  useEffect(() => {
    isolationRef.current();
  }, [props.isolatedPiece]);
  const fullSyncRef = useRef<() => void>(() => {});
  useEffect(() => {
    fullSyncRef.current();
  }, [props.weightsVersion]);
  useEffect(() => {
    refreshHeatmapRef.current();
  }, [props.selection, props.regionSet]);
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
      rangeIndex: number;
    }> = [];

    function applyIsolation() {
      const isolated = propsRef.current.isolatedPiece;
      for (const target of paintTargets) {
        const material = target.mesh.material as THREE.MeshStandardMaterial;
        const ghosted = isolated >= 0 && target.rangeIndex !== isolated;
        material.transparent = ghosted;
        material.opacity = ghosted ? 0.12 : 1;
        material.depthWrite = !ghosted;
      }
    }
    isolationRef.current = applyIsolation;

    function raycastTargets(): THREE.Mesh[] {
      const isolated = propsRef.current.isolatedPiece;
      return paintTargets
        .filter(
          (target) => isolated < 0 || target.rangeIndex === isolated
        )
        .map((target) => target.mesh);
    }

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
        const rangeIndex = propsRef.current.ranges.findIndex(
          (candidate) =>
            candidate.meshIndex === association.meshes &&
            candidate.primitiveIndex === (association.primitives ?? 0)
        );
        if (rangeIndex === -1) return;
        const range = propsRef.current.ranges[rangeIndex]!;
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
          vertexCount: range.vertexCount,
          rangeIndex
        });
      });
      refreshHeatmap();
      applyIsolation();

      // Idle playback (optional). NOT started until the Animate
      // toggle asks: a paused-at-frame-0 action is a slightly
      // POSED model, and painting against it shears partially-
      // painted regions (2026-07-06 sleeve-spike bug) — Animate
      // off must mean TRUE rest pose.
      if (propsRef.current.idleClipUrl) {
        loader.load(propsRef.current.idleClipUrl, (clipGltf) => {
          if (disposed) return;
          const clip = clipGltf.animations[0];
          if (!clip) return;
          mixer = new THREE.AnimationMixer(gltf.scene);
          idleAction = mixer.clipAction(clip);
          if (propsRef.current.animating) idleAction.play();
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
        const regionSet = propsRef.current.regionSet;
        const refresh = (local: number) => {
          const flat = target.vertexStart + local;
          if (regionSet && !regionSet.has(flat)) {
            colorAttribute.setXYZ(local, GHOST.r, GHOST.g, GHOST.b);
            return;
          }
          const weight = boneWeightOfVertex(weights, flat, column);
          const color = HEAT_LOW.clone().lerp(HEAT_HIGH, weight);
          if (propsRef.current.selection.has(flat)) {
            color.lerp(SELECT_TINT, 0.65);
          }
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
      if (!idleAction) return;
      if (playing) {
        idleAction.reset().play();
      } else {
        // stop() unbinds the action — nodes return to their rest
        // TRS, i.e. the actual bind pose.
        idleAction.stop();
      }
    };

    fullSyncRef.current = () => {
      refreshHeatmap();
      const weights = propsRef.current.weights;
      const total = weights.joints.length / MAX_INFLUENCES;
      const all: number[] = new Array(total);
      for (let i = 0; i < total; i += 1) all[i] = i;
      syncSkinAttributes(all);
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let painting = false;
    let orbiting = false;
    let lastPointer: [number, number] = [0, 0];

    // Box-select state (Plan 064).
    let boxing = false;
    let boxAdditive = false;
    let boxStart: [number, number] = [0, 0];
    const boxDiv = document.createElement("div");
    boxDiv.style.position = "absolute";
    boxDiv.style.border = "1px dashed #f7d774";
    boxDiv.style.background = "rgba(247, 215, 116, 0.08)";
    boxDiv.style.pointerEvents = "none";
    boxDiv.style.display = "none";
    container.style.position = "relative";
    container.appendChild(boxDiv);

    function finishBox(endX: number, endY: number) {
      boxDiv.style.display = "none";
      const rect = renderer.domElement.getBoundingClientRect();
      const minX = Math.min(boxStart[0], endX);
      const maxX = Math.max(boxStart[0], endX);
      const minY = Math.min(boxStart[1], endY);
      const maxY = Math.max(boxStart[1], endY);
      if (maxX - minX < 3 && maxY - minY < 3) return;
      const isolated = propsRef.current.isolatedPiece;
      const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
      const selected: number[] = [];
      const world = new THREE.Vector3();
      const normal = new THREE.Vector3();
      const toCamera = new THREE.Vector3();
      const projected = new THREE.Vector3();
      for (const target of paintTargets) {
        if (isolated >= 0 && target.rangeIndex !== isolated) continue;
        const geometry = target.mesh.geometry as THREE.BufferGeometry;
        const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
        const normals = geometry.getAttribute("normal") as THREE.BufferAttribute | null;
        target.mesh.updateWorldMatrix(true, false);
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(
          target.mesh.matrixWorld
        );
        for (let local = 0; local < positions.count; local += 1) {
          world.fromBufferAttribute(positions, local);
          target.mesh.localToWorld(world);
          // Backface cull unless x-ray: keep verts whose normal
          // faces the camera.
          if (!propsRef.current.xray && normals) {
            normal.fromBufferAttribute(normals, local).applyMatrix3(normalMatrix);
            toCamera.copy(cameraPosition).sub(world);
            if (normal.dot(toCamera) <= 0) continue;
          }
          projected.copy(world).project(camera);
          if (projected.z > 1) continue;
          const flat = target.vertexStart + local;
          if (propsRef.current.regionSet && !propsRef.current.regionSet.has(flat)) {
            continue;
          }
          const sx = ((projected.x + 1) / 2) * rect.width;
          const sy = ((1 - projected.y) / 2) * rect.height;
          if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
            selected.push(flat);
          }
        }
      }
      propsRef.current.onSelect(selected, boxAdditive);
    }

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
      const allHits = raycaster.intersectObjects(raycastTargets());
      const regionSet = propsRef.current.regionSet;
      const hit = allHits.find((candidate) => {
        if (!candidate.face) return false;
        if (!regionSet) return true;
        const target = paintTargets.find((t) => t.mesh === candidate.object);
        if (!target) return false;
        return regionSet.has(target.vertexStart + candidate.face.a);
      });
      if (!hit || !hit.face) return;
      placeCursor(hit);
      // Face indices reference the BASE geometry — rest space —
      // which is what makes painting correct while animating
      // (the 2026-07-06 paint-misses-everything bug: brushing in
      // world space against a posed mesh).
      const target = paintTargets.find((candidate) => candidate.mesh === hit.object);
      if (!target) return;
      const affected = propsRef.current.onPaint([
        target.vertexStart + hit.face.a,
        target.vertexStart + hit.face.b,
        target.vertexStart + hit.face.c
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
      if (propsRef.current.selectMode) {
        const rect = renderer.domElement.getBoundingClientRect();
        boxing = true;
        boxAdditive = event.shiftKey;
        boxStart = [event.clientX - rect.left, event.clientY - rect.top];
        boxDiv.style.display = "block";
        boxDiv.style.left = `${boxStart[0]}px`;
        boxDiv.style.top = `${boxStart[1]}px`;
        boxDiv.style.width = "0px";
        boxDiv.style.height = "0px";
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
      if (boxing) {
        const rect = renderer.domElement.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        boxDiv.style.left = `${Math.min(boxStart[0], x)}px`;
        boxDiv.style.top = `${Math.min(boxStart[1], y)}px`;
        boxDiv.style.width = `${Math.abs(x - boxStart[0])}px`;
        boxDiv.style.height = `${Math.abs(y - boxStart[1])}px`;
        return;
      }
      if (painting) {
        paintAt(event);
        return;
      }
      // Hover: show the brush ring.
      pointerToNdc(event);
      raycaster.setFromCamera(pointer, camera);
      const hoverHits = raycaster.intersectObjects(raycastTargets());
      const hoverRegion = propsRef.current.regionSet;
      const hoverHit = hoverHits.find((candidate) => {
        if (!hoverRegion) return true;
        if (!candidate.face) return false;
        const target = paintTargets.find((t) => t.mesh === candidate.object);
        return target
          ? hoverRegion.has(target.vertexStart + candidate.face.a)
          : false;
      });
      if (hoverHit) {
        placeCursor(hoverHit);
      } else {
        cursor.visible = false;
      }
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture(event.pointerId);
      if (boxing) {
        boxing = false;
        const rect = renderer.domElement.getBoundingClientRect();
        finishBox(event.clientX - rect.left, event.clientY - rect.top);
      }
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
      container.removeChild(boxDiv);
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
