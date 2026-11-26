import type { BridgeResult, PresentState } from './bridgeService';

export type PresenterPhase = PresentState | 'unknown' | null;

/** A missing status is unknown, never evidence that the PC opened the file. */
export function presentationTimeout(phase: PresenterPhase): PresenterPhase {
  return phase === 'opened' || phase === 'failed' ? phase : 'unknown';
}

/** A rejected start or a lost connection is terminal; a failed key after opening is not. */
export function presentationResult(phase: PresenterPhase, result: BridgeResult): PresenterPhase {
  if (result.state === 'failed' || (!result.ok && (!result.connected || phase !== 'opened'))) return 'failed';
  return result.state || phase;
}
