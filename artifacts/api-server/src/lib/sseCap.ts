// Per-user concurrent SSE stream cap.
//
// In-memory map; single-instance assumption documented in Task #11 spec.
// When we scale horizontally we'll need a Redis-backed counter or
// per-connection heartbeat scheme.

const counts = new Map<string, number>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getSseCap(): number {
  return envInt("SSE_MAX_CONCURRENT_PER_USER", 3);
}

export function getActiveStreamCount(userId: string): number {
  return counts.get(userId) ?? 0;
}

/** Returns true if the slot was acquired; false if the user is at the cap. */
export function tryAcquireStream(userId: string): boolean {
  const cap = getSseCap();
  const cur = counts.get(userId) ?? 0;
  if (cur >= cap) return false;
  counts.set(userId, cur + 1);
  return true;
}

export function releaseStream(userId: string): void {
  const cur = counts.get(userId) ?? 0;
  if (cur <= 1) counts.delete(userId);
  else counts.set(userId, cur - 1);
}

export function _resetSseCapForTests(): void {
  counts.clear();
}
