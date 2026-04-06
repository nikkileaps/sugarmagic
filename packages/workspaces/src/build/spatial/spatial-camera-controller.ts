import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const DEFAULT_HEIGHT = 48;
const MIN_DISTANCE = 12;
const MAX_DISTANCE = 160;

export interface SpatialCameraController {
  attach: (
    camera: THREE.Camera,
    domElement: HTMLElement,
    subscribeFrame: (listener: () => void) => () => void
  ) => void;
  detach: () => void;
}

export function createSpatialCameraController(): SpatialCameraController {
  let controls: OrbitControls | null = null;
  let attachedElement: HTMLElement | null = null;
  let unsubscribeFrame: (() => void) | null = null;
  let contextMenuHandler: ((event: Event) => void) | null = null;
  let savedTarget = new THREE.Vector3(0, 0, 0);
  let savedPosition = new THREE.Vector3(0, DEFAULT_HEIGHT, 0.001);
  let savedOrthographicZoom = 1;

  return {
    attach(camera, domElement, subscribeFrame) {
      if (controls) return;

      attachedElement = domElement;
      controls = new OrbitControls(camera, domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enableRotate = false;
      controls.screenSpacePanning = true;
      controls.mouseButtons = {
        LEFT: null as unknown as THREE.MOUSE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN
      };

      if (camera instanceof THREE.OrthographicCamera) {
        camera.up.set(0, 0, -1);
        camera.zoom = savedOrthographicZoom;
        camera.updateProjectionMatrix();
        controls.minZoom = 0.5;
        controls.maxZoom = 8;
      } else {
        controls.minDistance = MIN_DISTANCE;
        controls.maxDistance = MAX_DISTANCE;
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
    },

    detach() {
      if (!controls) return;

      savedPosition = controls.object.position.clone();
      savedTarget = controls.target.clone();
      if (controls.object instanceof THREE.OrthographicCamera) {
        savedOrthographicZoom = controls.object.zoom;
      }
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
