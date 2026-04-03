import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const MIN_DISTANCE = 1.2;
const MAX_DISTANCE = 12;

export interface PlayerCameraController {
  attach: (
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    subscribeFrame: (listener: () => void) => () => void,
    targetY: number
  ) => void;
  updateTarget: (targetY: number) => void;
  detach: () => void;
}

export function createPlayerCameraController(): PlayerCameraController {
  let controls: OrbitControls | null = null;
  let unsubscribeFrame: (() => void) | null = null;
  let contextMenuHandler: ((event: Event) => void) | null = null;
  let savedPosition = new THREE.Vector3(2.4, 1.8, 3.2);
  let savedTarget = new THREE.Vector3(0, 1, 0);
  let attachedElement: HTMLElement | null = null;

  function setTargetY(targetY: number) {
    if (!controls) return;
    const nextTarget = new THREE.Vector3(0, targetY, 0);
    const offset = controls.object.position.clone().sub(controls.target);
    controls.target.copy(nextTarget);
    controls.object.position.copy(nextTarget.clone().add(offset));
    controls.object.lookAt(nextTarget);
    controls.update();
    savedTarget = nextTarget.clone();
    savedPosition = controls.object.position.clone();
  }

  return {
    attach(camera, domElement, subscribeFrame, targetY) {
      if (controls) return;

      attachedElement = domElement;
      controls = new OrbitControls(camera, domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = false;
      controls.minDistance = MIN_DISTANCE;
      controls.maxDistance = MAX_DISTANCE;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };

      const target = new THREE.Vector3(0, targetY, 0);
      const initialOffset = savedPosition.clone().sub(savedTarget);
      camera.position.copy(target.clone().add(initialOffset));
      controls.target.copy(target);
      camera.lookAt(target);
      controls.update();
      savedTarget = target.clone();

      unsubscribeFrame = subscribeFrame(() => {
        controls?.update();
      });

      contextMenuHandler = (event: Event) => {
        event.preventDefault();
      };
      domElement.addEventListener("contextmenu", contextMenuHandler);
    },

    updateTarget(targetY) {
      setTargetY(targetY);
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

      controls.dispose();
      controls = null;
      attachedElement = null;
    }
  };
}
