const APPLE_EPOCH_OFFSET_SECONDS = 978307200;

export function appleSecondsToDate(seconds: number): Date {
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000);
}

export function ageLabel(createdAt: number, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - appleSecondsToDate(createdAt).getTime()) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
