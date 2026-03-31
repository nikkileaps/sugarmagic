export type ProductModeId = "design" | "build" | "render";

export interface ProductModeDescriptor {
  id: ProductModeId;
  label: string;
  summary: string;
  workspaceKinds: string[];
  commandSurfaceId: string;
  panelLayoutId: string;
}
