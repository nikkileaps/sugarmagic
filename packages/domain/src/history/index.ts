import type { TransactionBoundary } from "../transactions";

export interface AuthoringHistory {
  undoStack: TransactionBoundary[];
  redoStack: TransactionBoundary[];
}
