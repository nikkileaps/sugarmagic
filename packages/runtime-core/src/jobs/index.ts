export interface RuntimeJobRequest<TInput = unknown> {
  jobId: string;
  jobKind: string;
  generation: number;
  snapshot: TInput;
}

export interface RuntimeJobResult<TOutput = unknown> {
  jobId: string;
  jobKind: string;
  generation: number;
  output: TOutput;
}
