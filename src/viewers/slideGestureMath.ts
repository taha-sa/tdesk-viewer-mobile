/** Keep the touched slide point under the moving pinch midpoint. */
export function pinchOffset(focalStart: number, focalNow: number, offsetStart: number, startScale: number, scale: number): number {
  'worklet';
  return focalNow - (focalStart - offsetStart) * (scale / startScale);
}

/** Center small slides; for larger slides stop at the edge of the viewport. */
export function slidePanLimit(contentSize: number, viewportSize: number, scale: number): number {
  'worklet';
  const scaled = Math.max(0, contentSize * scale);
  return Math.max(0, (scaled - viewportSize) / 2);
}

export function limitSlideOffset(value: number, contentSize: number, viewportSize: number, scale: number): number {
  'worklet';
  const limit = slidePanLimit(contentSize, viewportSize, scale);
  return Math.max(-limit, Math.min(limit, value));
}

/** Android pointer-up updates can still report two pointers although one has lifted. */
export function shouldApplyPinchUpdate(twoFingersDown: boolean, reportedPointers: number): boolean {
  'worklet';
  return twoFingersDown && reportedPointers === 2;
}
