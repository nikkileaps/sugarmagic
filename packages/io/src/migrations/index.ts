import type { SchemaDescriptor } from "../schemas";

export interface MigrationStep {
  from: SchemaDescriptor;
  to: SchemaDescriptor;
}
