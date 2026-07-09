/**
 * packages/workspaces/src/design/character-wizard/MarkerViewport.tsx
 *
 * Purpose: Plan 062 §062.6 — the wizard's joint-confirmation
 * viewport: the imported model rendered ghosted, with the 16
 * landmark markers as draggable spheres. Left-drag a marker to
 * move it on the camera-parallel plane through its position;
 * right-drag orbits, wheel zooms.
 *
 * Self-contained three.js scene in the CharacterPreview mold
 * (own renderer/camera/lights, no shared WebRenderEngine), with
 * the raycaster-drag interaction pattern from Studio's
 * mask-paint overlay.
 *
 * Status: active
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface MarkerViewportProps {
  modelUrl: string;
  landmarks: Record<string, [number, number, number]>;
  onChange: (landmarks: Record<string, [number, number, number]>) => void;
  /** Plan 062 UX (nikki 2026-07-06): drag one side, the paired
   *  marker mirrors across the symmetry plane; center markers
   *  clamp onto it. */
  mirroring: boolean;
}

/** Friendly labels shown while hovering/dragging a marker. */
const LANDMARK_LABELS: Record<string, string> = {
  pelvis: "Pelvis",
  chest: "Chest",
  neck: "Neck",
  head: "Head",
  shoulderLeft: "Left Shoulder",
  elbowLeft: "Left Elbow",
  wristLeft: "Left Wrist",
  shoulderRight: "Right Shoulder",
  elbowRight: "Right Elbow",
  wristRight: "Right Wrist",
  hipLeft: "Left Hip",
  kneeLeft: "Left Knee",
  ankleLeft: "Left Ankle",
  hipRight: "Right Hip",
  kneeRight: "Right Knee",
  ankleRight: "Right Ankle",
  tailBase: "Tail Base",
  tailMid: "Tail Middle",
  tailTip: "Tail Tip"
};

/** Counterpart landmark across the symmetry plane, or null. */
function mirrorPartner(name: string): string | null {
  if (name.endsWith("Left")) return `${name.slice(0, -4)}Right`;
  if (name.endsWith("Right")) return `${name.slice(0, -5)}Left`;
  return null;
}

const MARKER_COLOR = 0x7aa2f7;
const MARKER_ACTIVE_COLOR = 0xf7768e;

export function MarkerViewport(props: MarkerViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const landmarksRef = useRef(props.landmarks);
  landmarksRef.current = props.landmarks;
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const mirroringRef = useRef(props.mirroring);
  mirroringRef.current = props.mirroring;

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
    // The wizard modal scrolls; keep gestures for the viewport.
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x1f1f2e })
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Orbit state around the model center.
    const orbit = { yaw: Math.PI / 5, pitch: 0.25, radius: 3.2, targetY: 0.8 };
    function applyCamera() {
      camera.position.set(
        Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius,
        orbit.targetY + Math.sin(orbit.pitch) * orbit.radius,
        Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.radius
      );
      camera.lookAt(0, orbit.targetY, 0);
    }

    // Ghosted model.
    const loader = new GLTFLoader();
    let disposed = false;
    loader.load(props.modelUrl, (gltf) => {
      if (disposed) return;
      gltf.scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0x9aa5ce,
            transparent: true,
            opacity: 0.45,
            depthWrite: false
          });
        }
      });
      scene.add(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const size = bounds.getSize(new THREE.Vector3());
      orbit.targetY = bounds.min.y + size.y / 2;
      orbit.radius = Math.max(2, size.y * 2.2);
      applyCamera();
    });

    // Markers.
    const markerRoot = new THREE.Group();
    scene.add(markerRoot);
    const markerByName = new Map<string, THREE.Mesh>();
    const markerGeometry = new THREE.SphereGeometry(0.02, 16, 12);
    for (const [name, position] of Object.entries(landmarksRef.current)) {
      const marker = new THREE.Mesh(
        markerGeometry,
        new THREE.MeshBasicMaterial({
          color: MARKER_COLOR,
          depthTest: false
        })
      );
      marker.renderOrder = 10;
      marker.position.set(position[0], position[1], position[2]);
      marker.userData.landmarkName = name;
      markerRoot.add(marker);
      markerByName.set(name, marker);
    }
    // Scale marker size with the character once the model loads
    // (a 0.4m chibi needs smaller handles than a 2m giant).
    const initialHeights = Object.values(landmarksRef.current).map((p) => p[1]);
    const approxHeight = Math.max(...initialHeights, 0.5) * 1.15;
    const markerScale = Math.max(0.5, approxHeight / 1.6);
    for (const marker of markerByName.values()) {
      marker.scale.setScalar(markerScale);
    }

    // Symmetry plane x: the average midpoint of all L/R pairs at
    // mount (models are usually centered, but not always at 0).
    let mirrorX = 0;
    {
      let sum = 0;
      let pairs = 0;
      for (const [name, position] of Object.entries(landmarksRef.current)) {
        if (!name.endsWith("Left")) continue;
        const partner = landmarksRef.current[mirrorPartner(name)!];
        if (!partner) continue;
        sum += (position[0] + partner[0]) / 2;
        pairs += 1;
      }
      mirrorX = pairs > 0 ? sum / pairs : 0;
    }

    function setLabel(name: string | null) {
      const label = labelRef.current;
      if (!label) return;
      if (name) {
        label.textContent = LANDMARK_LABELS[name] ?? name;
        label.style.opacity = "1";
      } else {
        label.style.opacity = "0";
      }
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let dragging: THREE.Mesh | null = null;
    const dragPlane = new THREE.Plane();
    let orbiting = false;
    let lastPointer: [number, number] = [0, 0];

    function pointerToNdc(event: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
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
      const hits = raycaster.intersectObjects([...markerByName.values()]);
      const hit = hits[0];
      if (hit) {
        dragging = hit.object as THREE.Mesh;
        setLabel(dragging.userData.landmarkName as string);
        (dragging.material as THREE.MeshBasicMaterial).color.setHex(
          MARKER_ACTIVE_COLOR
        );
        // Drag on the camera-parallel plane through the marker.
        const normal = new THREE.Vector3();
        camera.getWorldDirection(normal);
        dragPlane.setFromNormalAndCoplanarPoint(normal, dragging.position);
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (orbiting) {
        const dx = event.clientX - lastPointer[0];
        const dy = event.clientY - lastPointer[1];
        lastPointer = [event.clientX, event.clientY];
        orbit.yaw -= dx * 0.008;
        orbit.pitch = Math.min(
          1.3,
          Math.max(-0.4, orbit.pitch + dy * 0.006)
        );
        applyCamera();
        return;
      }
      if (!dragging) {
        // Hover: name the marker under the cursor.
        pointerToNdc(event);
        raycaster.setFromCamera(pointer, camera);
        const hover = raycaster.intersectObjects([...markerByName.values()])[0];
        setLabel(
          hover ? (hover.object.userData.landmarkName as string) : null
        );
        renderer.domElement.style.cursor = hover ? "grab" : "default";
        return;
      }
      pointerToNdc(event);
      raycaster.setFromCamera(pointer, camera);
      const point = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, point)) {
        const name = dragging.userData.landmarkName as string;
        if (mirroringRef.current) {
          const partnerName = mirrorPartner(name);
          if (partnerName) {
            dragging.position.copy(point);
            const partner = markerByName.get(partnerName);
            partner?.position.set(
              2 * mirrorX - point.x,
              point.y,
              point.z
            );
          } else {
            // Center-line marker: ride the symmetry plane.
            dragging.position.set(mirrorX, point.y, point.z);
          }
        } else {
          dragging.position.copy(point);
        }
      }
    }

    function handlePointerUp(event: PointerEvent) {
      renderer.domElement.releasePointerCapture(event.pointerId);
      orbiting = false;
      if (!dragging) return;
      (dragging.material as THREE.MeshBasicMaterial).color.setHex(MARKER_COLOR);
      const name = dragging.userData.landmarkName as string;
      const next = { ...landmarksRef.current };
      next[name] = [
        dragging.position.x,
        dragging.position.y,
        dragging.position.z
      ];
      if (mirroringRef.current) {
        const partnerName = mirrorPartner(name);
        const partner = partnerName ? markerByName.get(partnerName) : null;
        if (partnerName && partner) {
          next[partnerName] = [
            partner.position.x,
            partner.position.y,
            partner.position.z
          ];
        }
      }
      dragging = null;
      setLabel(null);
      onChangeRef.current(next);
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
    // Mount-once: landmarks flow through refs; the model URL is
    // stable for the wizard's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.modelUrl]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: 8,
        overflow: "hidden"
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div
        ref={labelRef}
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(20, 20, 31, 0.85)",
          border: "1px solid var(--sm-panel-border, #333)",
          color: "var(--sm-color-text, #e6e6f0)",
          fontSize: 12,
          fontWeight: 600,
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 120ms ease"
        }}
      />
    </div>
  );
}
