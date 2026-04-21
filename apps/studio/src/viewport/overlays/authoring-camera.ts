/**
 * Authoring camera overlay.
 *
 * Owns the build viewport camera controllers for layout, landscape, spatial,
 * and behavior workspaces. The camera stays viewport-owned; React workspaces
 * read the resulting camera quaternion from viewportStore instead of reaching
 * into the viewport instance.
 */

import * as THREE from "three";
import {
  createLandscapeCameraController,
  createLayoutCameraController,
  createSpatialCameraController
} from "@sugarmagic/workspaces";
import { shallowEqual } from "@sugarmagic/shell";
import type { ViewportOverlayFactory } from "../overlay-context";

type CameraController = {
  attach(
    camera: THREE.Camera,
    domElement: HTMLElement,
    subscribeFrame: (listener: () => void) => () => void
  ): void;
  detach(): void;
};

type CameraMode = "layout" | "landscape" | "spatial" | "behavior" | "inactive";

function resolveCameraMode(
  activeProductMode: string,
  activeBuildWorkspaceKind: string
): CameraMode {
  if (activeProductMode !== "build") {
    return "inactive";
  }
  if (activeBuildWorkspaceKind === "landscape") {
    return "landscape";
  }
  if (activeBuildWorkspaceKind === "spatial") {
    return "spatial";
  }
  if (activeBuildWorkspaceKind === "behavior") {
    return "behavior";
  }
  return "layout";
}

export const mountAuthoringCameraOverlay: ViewportOverlayFactory = (context) => {
  const controllers: Record<Exclude<CameraMode, "inactive">, CameraController> = {
    layout: createLayoutCameraController(),
    landscape: createLandscapeCameraController(),
    spatial: createSpatialCameraController(),
    behavior: createLayoutCameraController()
  };

  let currentMode: CameraMode = "inactive";
  let currentController: CameraController | null = null;
  const lastQuaternion = new THREE.Quaternion();

  const detachCurrentController = () => {
    currentController?.detach();
    currentController = null;
    currentMode = "inactive";
  };

  const updateCameraQuaternion = () => {
    const camera = context.getCamera();
    const current =
      "quaternion" in camera && camera.quaternion instanceof THREE.Quaternion
        ? camera.quaternion
        : null;
    if (!current || lastQuaternion.angleTo(current) < 0.0001) {
      return;
    }
    lastQuaternion.copy(current);
    context.stateAccess.setCameraQuaternion([
      current.x,
      current.y,
      current.z,
      current.w
    ]);
  };

  const unsubscribeFrame = context.subscribeFrame(updateCameraQuaternion);

  const unsubscribeProjection = context.subscribeToProjection(
    ({ shell }) => ({
      activeProductMode: shell.activeProductMode,
      activeBuildWorkspaceKind: shell.activeBuildWorkspaceKind
    }),
    ({ activeProductMode, activeBuildWorkspaceKind }) => {
      const nextMode = resolveCameraMode(
        activeProductMode,
        activeBuildWorkspaceKind
      );
      if (nextMode === currentMode) {
        updateCameraQuaternion();
        return;
      }

      detachCurrentController();
      if (nextMode === "inactive") {
        return;
      }

      context.setProjectionMode(
        nextMode === "spatial" ? "orthographic-top" : "perspective"
      );
      currentController = controllers[nextMode];
      currentController.attach(
        context.getCamera(),
        context.domElement,
        context.subscribeFrame
      );
      currentMode = nextMode;
      lastQuaternion.identity();
      updateCameraQuaternion();
    },
    { equalityFn: shallowEqual }
  );

  return () => {
    unsubscribeProjection();
    unsubscribeFrame();
    detachCurrentController();
  };
};
