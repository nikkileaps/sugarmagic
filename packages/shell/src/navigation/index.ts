import type { ProductModeId } from "@sugarmagic/productmodes";

export interface NavigationModel {
  activeProductMode: ProductModeId;
  activeWorkspaceId: string | null;
}
