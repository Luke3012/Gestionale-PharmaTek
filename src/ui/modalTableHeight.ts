export function modalTableHeight(
  rowCount: number,
  {
    min = 150,
    max = 380,
    viewportOffset = 430,
    row = 59,
    header = 60,
    maxVisibleRows = 10,
  }: {
    min?: number;
    max?: number;
    viewportOffset?: number;
    row?: number;
    header?: number;
    maxVisibleRows?: number;
  } = {}
): string {
  const visibleRows = Math.max(1, Math.min(rowCount, maxVisibleRows));
  const ideal = rowCount === 0 ? min : header + visibleRows * row + 2;
  const floor = Math.min(min, ideal);
  return `max(${floor}px, min(${ideal}px, ${max}px, calc(100dvh - ${viewportOffset}px)))`;
}
