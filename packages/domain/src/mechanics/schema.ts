/**
 * Public Mechanics JSON Schema export.
 *
 * The committed JSON artifact is the external contract. This module re-exports
 * the same schema through `@sugarmagic/domain` so runtime-core and Studio can
 * validate mechanics blocks without deep-importing package internals.
 */

import mechanicsSchema from "../../schemas/mechanics.schema.json";

export const MECHANICS_JSON_SCHEMA = mechanicsSchema;
