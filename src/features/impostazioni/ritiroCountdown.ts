export const RITIRO_AUTO_RELOAD_MS = 10_000;

export function secondiRimanentiRitiro(deadlineMs: number, nowMs = Date.now()): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1_000));
}
