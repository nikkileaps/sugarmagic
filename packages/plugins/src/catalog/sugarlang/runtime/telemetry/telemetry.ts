/**
 * packages/plugins/src/catalog/sugarlang/runtime/telemetry/telemetry.ts
 *
 * Purpose: Declares the event sink interface reserved for sugarlang telemetry.
 *
 * Exports:
 *   - TelemetrySink
 *
 * Relationships:
 *   - Will be consumed by the Budgeter, Director, middleware, and debug panel work.
 *   - Defines the boundary between runtime event producers and telemetry storage.
 *
 * Implements: Proposal 001 §Verification and Acceptance / §Cost and Latency
 *
 * Status: skeleton (no implementation yet; see Epic 13)
 */

export interface TelemetrySink {
  emit: (
    eventName: string,
    payload: Record<string, unknown>
  ) => void | Promise<void>;
}
