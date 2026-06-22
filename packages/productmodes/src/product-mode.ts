export type ProductModeId = "design" | "build" | "render" | "publish";

export interface ProductModeDescriptor {
  id: ProductModeId;
  label: string;
  summary: string;
  workspaceKinds: string[];
  commandSurfaceId: string;
  panelLayoutId: string;
}
