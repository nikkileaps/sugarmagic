export interface AcceptedDeltaCoordinator<TDelta = unknown> {
  coordinatorId: string;
  applyAcceptedDelta: (generation: number, delta: TDelta) => void;
}
