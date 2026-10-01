export type ActivityStatus = 'idle' | 'running' | 'completed' | 'error' | 'cancelled';

export interface CompletedActivityCleanup {
  readonly optimization: boolean;
  readonly export: boolean;
}

export function completedActivityCleanup(
  previousView: string,
  currentView: string,
  resultWasSeenInProduction: boolean,
  optimizationStatus: ActivityStatus,
  exportStatus: ActivityStatus,
): CompletedActivityCleanup {
  if (previousView !== 'batch' || currentView === 'batch' || !resultWasSeenInProduction ||
      optimizationStatus === 'running' || exportStatus === 'running') {
    return { optimization: false, export: false };
  }
  return {
    optimization: optimizationStatus === 'completed',
    export: exportStatus === 'completed',
  };
}
