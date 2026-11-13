/** Points a detail row takes: its 2pt top margin and a 13pt line. */
const ROW_PT = 2 + 13;
/** A description line is 13pt; the first also has a 2pt top margin. */
const DESCRIPTION_LINE_PT = 13;
const DESCRIPTION_GAP_PT = 2;

/**
 * How much of a tall block's lower part fits: whole detail rows in order,
 * then whole description lines. `roomPt` is the height left under the
 * title and time (points at the default text size times `scale`), so
 * nothing shows cut in half.
 */
export function fitBlockRest({
  detailCount,
  roomPt,
  scale,
}: {
  detailCount: number;
  roomPt: number;
  scale: number;
}): { descriptionLines: number; rows: number } {
  const row = ROW_PT * scale;
  const rows = Math.max(0, Math.min(detailCount, Math.floor(roomPt / row)));
  const left = roomPt - rows * row - DESCRIPTION_GAP_PT * scale;
  // A row that didn't fit leaves the description out, so the rows stay in order.
  const descriptionLines =
    rows < detailCount
      ? 0
      : Math.max(0, Math.floor(left / (DESCRIPTION_LINE_PT * scale)));
  return { descriptionLines, rows };
}
