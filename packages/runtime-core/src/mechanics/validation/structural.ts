/**
 * Structural mechanics validation.
 *
 * Ajv validates the authored JSON shape against the public domain schema.
 * Semantic expression/reference validation is layered separately.
 */

import Ajv2020 from "ajv/dist/2020";
import {
  MECHANICS_JSON_SCHEMA,
  type MechanicsDefinition
} from "@sugarmagic/domain";

export interface MechanicsValidationIssue {
  path: string;
  message: string;
}

export interface MechanicsValidationResult {
  valid: boolean;
  issues: MechanicsValidationIssue[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateMechanicsSchema = ajv.compile(MECHANICS_JSON_SCHEMA);

export function validateMechanicsStructural(
  mechanics: unknown
): MechanicsValidationResult {
  const valid = validateMechanicsSchema(mechanics);
  if (valid) {
    return { valid: true, issues: [] };
  }
  const issues =
    validateMechanicsSchema.errors?.map((error) => ({
      path: error.instancePath || "/",
      message: error.message ?? "Invalid mechanics value."
    })) ?? [];
  return { valid: false, issues };
}

export function assertMechanicsStructural(
  mechanics: unknown
): asserts mechanics is MechanicsDefinition {
  const result = validateMechanicsStructural(mechanics);
  if (!result.valid) {
    throw new Error(
      `Invalid mechanics schema:\n${result.issues
        .map((issue) => `- ${issue.path}: ${issue.message}`)
        .join("\n")}`
    );
  }
}
