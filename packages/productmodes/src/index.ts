import { buildProductMode } from "./build";
import { designProductMode } from "./design";
import { renderProductMode } from "./render";
import type { ProductModeDescriptor, ProductModeId } from "./product-mode";

export * from "./build";
export * from "./design";
export * from "./product-mode";
export * from "./render";

export const productModes: ProductModeDescriptor[] = [
  designProductMode,
  buildProductMode,
  renderProductMode
];

export function getProductModeDescriptor(
  productModeId: ProductModeId
): ProductModeDescriptor {
  const descriptor = productModes.find((mode) => mode.id === productModeId);

  if (!descriptor) {
    throw new Error(`Unknown ProductMode: ${productModeId}`);
  }

  return descriptor;
}
