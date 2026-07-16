export type QueueEntry = {
  id: string;
  songId: string;
  requesterSingerId: string;
  requesterDisplayName: string;
  songTitle: string;
  songArtist: string;
  voteCount: number;
};

export type QueueCurrentEntry = {
  entry: QueueEntry;
  performanceId: string | null;
};

export type QueueFailedEntry = {
  entry: QueueEntry;
  message: string;
};

export type QueueDiagnostics = {
  activeQueueCount: number;
  currentEntryId: string | null;
  linkedPerformanceId: string | null;
  progressionPaused: boolean;
  lastTransition: string | null;
  lastFailure: string | null;
  workerFailure: string | null;
  idempotencyHitCount: number;
  idempotencyConflictCount: number;
};

export type QueueProjection = {
  revision: number;
  current: QueueCurrentEntry | null;
  queued: QueueEntry[];
  failed: QueueFailedEntry[];
  progressionPaused: boolean;
  diagnostics: QueueDiagnostics;
};

export type QueueError = {
  reasonCode: string;
  message: string;
};
