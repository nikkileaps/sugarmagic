import { buildProductMode } from "./build";
import { designProductMode } from "./design";
import { publishProductMode } from "./publish";
import { renderProductMode } from "./render";
import { storyProductMode } from "./story";
import type { ProductModeDescriptor, ProductModeId } from "./product-mode";

export * from "./build";
export * from "./design";
export * from "./product-mode";
export * from "./publish";
export * from "./render";
export * from "./story";

export const productModes: ProductModeDescriptor[] = [
  designProductMode,
  storyProductMode,
  buildProductMode,
  renderProductMode,
  publishProductMode
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
