import type { SemanticCommand } from "../commands";
import type { DocumentId, TimestampIso } from "../shared/identity";

export interface TransactionBoundary {
  transactionId: string;
  command: SemanticCommand;
  affectedAggregateIds: DocumentId[];
  committedAt: TimestampIso;
}
