import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DEFAULT_DISTANCE = 20;
const MIN_DISTANCE = 5;
const MAX_DISTANCE = 50;

function calculateIsometricOffset(distance: number): THREE.Vector3 {
  const pitch = -35.264 * (Math.PI / 180);
  const yaw = 45 * (Math.PI / 180);

  return new THREE.Vector3(
    distance * Math.cos(pitch) * Math.cos(yaw),
    distance * Math.sin(-pitch),
    distance * Math.cos(pitch) * Math.sin(yaw)
  );
}

export interface LayoutCameraController {
  attach: (
    camera: THREE.Camera,
    domElement: HTMLElement,
    subscribeFrame: (listener: () => void) => () => void
  ) => void;
  detach: () => void;
}

export function createLayoutCameraController(): LayoutCameraController {
  let controls: OrbitControls | null = null;
  let attachedElement: HTMLElement | null = null;
  let unsubscribeFrame: (() => void) | null = null;
  let contextMenuHandler: ((event: Event) => void) | null = null;
  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
  let savedTarget = new THREE.Vector3(0, 0, 0);
  let savedPosition = calculateIsometricOffset(DEFAULT_DISTANCE);
  let initialized = false;

  function setView(position: THREE.Vector3, target: THREE.Vector3) {
    if (!controls) return;

    const previousDamping = controls.enableDamping;
    controls.enableDamping = false;
    controls.object.position.copy(position);
    controls.target.copy(target);
    controls.object.lookAt(target);
    controls.update();
    controls.enableDamping = previousDamping;

    savedPosition = position.clone();
    savedTarget = target.clone();
  }

  function snapToCardinalView(code: string) {
    if (!controls) return;

    const target = controls.target.clone();
    const distance = Math.max(
      controls.object.position.distanceTo(target),
      MIN_DISTANCE
    );

    if (code === "Digit1" || code === "Numpad1") {
      setView(target.clone().add(new THREE.Vector3(0, 0, distance)), target);
      return;
    }

    if (code === "Digit3" || code === "Numpad3") {
      setView(target.clone().add(new THREE.Vector3(distance, 0, 0)), target);
      return;
    }

    if (code === "Digit7" || code === "Numpad7") {
      setView(target.clone().add(new THREE.Vector3(0, distance, 0)), target);
    }
  }

  return {
    attach(camera, domElement, subscribeFrame) {
      if (controls) return;

      attachedElement = domElement;
      controls = new OrbitControls(camera, domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = false;
      controls.minDistance = MIN_DISTANCE;
      controls.maxDistance = MAX_DISTANCE;
      controls.maxPolarAngle = Math.PI / 2;
      controls.mouseButtons = {
        LEFT: null as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN
      };

      if (!initialized) {
        initialized = true;
      }

      camera.position.copy(savedPosition);
      controls.target.copy(savedTarget);
      camera.lookAt(savedTarget);
      controls.update();

      unsubscribeFrame = subscribeFrame(() => {
        controls?.update();
      });

      contextMenuHandler = (event: Event) => {
        event.preventDefault();
      };
      domElement.addEventListener("contextmenu", contextMenuHandler);

      keydownHandler = (event: KeyboardEvent) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement
        ) {
          return;
        }

        if (
          event.code !== "Digit1" &&
          event.code !== "Digit3" &&
          event.code !== "Digit7" &&
          event.code !== "Numpad1" &&
          event.code !== "Numpad3" &&
          event.code !== "Numpad7"
        ) {
          return;
        }

        event.preventDefault();
        snapToCardinalView(event.code);
      };
      window.addEventListener("keydown", keydownHandler);
    },

    detach() {
      if (!controls) return;

      savedPosition = controls.object.position.clone();
      savedTarget = controls.target.clone();
      unsubscribeFrame?.();
      unsubscribeFrame = null;

      if (contextMenuHandler) {
        attachedElement?.removeEventListener("contextmenu", contextMenuHandler);
        contextMenuHandler = null;
      }

      if (keydownHandler) {
        window.removeEventListener("keydown", keydownHandler);
        keydownHandler = null;
      }

      controls.dispose();
      controls = null;
      attachedElement = null;
    }
  };
}
