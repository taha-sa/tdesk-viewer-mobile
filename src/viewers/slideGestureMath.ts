/** Keep the touched slide point under the moving pinch midpoint. */
export function pinchOffset(focalStart: number, focalNow: number, offsetStart: number, startScale: number, scale: number): number {
  'worklet';
  return focalNow - (focalStart - offsetStart) * (scale / startScale);
}

/** Permit movement even when a slide is smaller than the viewport, while keeping a small part visible. */
export function slidePanLimit(contentSize: number, viewportSize: number, scale: number): number {
  'worklet';
  const scaled = Math.max(0, contentSize * scale);
  return Math.max(0, (viewportSize + scaled) / 2 - Math.min(32, scaled / 2));
}

export function limitSlideOffset(value: number, contentSize: number, viewportSize: number, scale: number): number {
  'worklet';
  const limit = slidePanLimit(contentSize, viewportSize, scale);
  return Math.max(-limit, Math.min(limit, value));
}
