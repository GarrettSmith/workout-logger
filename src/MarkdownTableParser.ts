import { ExerciseRow, SetData } from "./types";

const MULTIPLIER = "\u00D7"; // U+00D7 MULTIPLICATION SIGN

/**
 * Parse a set cell value into SetData.
 * A cell is ONLY treated as a set if it starts with a checkbox ([x] or [ ]).
 *
 * Formats (checkbox REQUIRED):
 *   [x] Foo×N   → completed, weight="Foo", reps=N
 *   [x] N        → completed, weight="", reps=N
 *   [ ] Foo×N    → uncompleted, weight="Foo", reps=N
 *   [ ] N        → uncompleted, weight="", reps=N
 *   (empty)      → uncompleted, weight="", reps=0
 *
 * Anything without a checkbox — plain numbers ("4"), ranges ("5–8"),
 * weight×reps without checkbox ("135×8") — is NOT a set.
 */
export function parseSetCell(cell: string): SetData {
  const trimmed = cell.trim();
  if (!trimmed) {
    return { weight: "", reps: 0, completed: false, hasCheckbox: false };
  }

  // Must have checkbox prefix to be a valid set
  const hasCheckbox = trimmed.startsWith("[x]") || trimmed.startsWith("[x] ") ||
                      trimmed.startsWith("[ ]") || trimmed.startsWith("[ ] ");
  if (!hasCheckbox) {
    return { weight: "", reps: 0, completed: false, hasCheckbox: false };
  }

  const checked = trimmed.startsWith("[x]");
  const afterCheck = trimmed.replace(/^\[(x| )\]\s*/i, "");
  const multIdx = afterCheck.indexOf(MULTIPLIER);

  if (multIdx === -1) {
    // No × found — treat whole thing as reps count or just weight
    const num = parseInt(afterCheck.trim(), 10);
    if (!isNaN(num)) {
      return { weight: "", reps: num, completed: checked, hasCheckbox: true };
    }
    return { weight: afterCheck.trim(), reps: 0, completed: checked, hasCheckbox: true };
  }

  const weight = afterCheck.slice(0, multIdx).trim();
  const repsStr = afterCheck.slice(multIdx + 1).trim();
  const reps = parseInt(repsStr, 10);

  return { weight, reps: isNaN(reps) ? 0 : reps, completed: checked, hasCheckbox: true };
}

/**
 * Serialize a SetData back to markdown cell string.
 * Blank cells (no weight, no reps) serialize to empty string.
 */
export function serializeSetCell(set: SetData): string {
  if (!set.weight && !set.reps) return set.completed ? "[x]" : "[ ]";
  const inner = set.weight
    ? `${set.weight}${MULTIPLIER}${set.reps}`
    : `${set.reps}`;
  return set.completed ? `[x] ${inner}` : `[ ] ${inner}`;
}

/**
 * Check if a line is a markdown table row (starts and ends with |).
 */
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && !t.startsWith("|^");
}

/**
 * Check if a line is a markdown table separator (contains only |, -, :, spaces).
 */
function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

/**
 * Split a table row line into its cells (excluding outer |).
 */
function splitCells(line: string): string[] {
  const inner = line.trim().slice(1, -1); // remove leading | and trailing |
  return inner.split("|").map((c) => c.trim());
}

/**
 * Parse the workout table near cursorLine in content.
 * Searches cursorLine ± 3 lines for a table row.
 * The first column is exercise name; remaining columns are sets.
 *
 * Returns null if no suitable row found.
 */
export function parseTable(
  content: string,
  cursorLine: number
): ExerciseRow | null {
  const lines = content.split("\n");

  const start = Math.max(0, cursorLine - 3);
  const end = Math.min(lines.length - 1, cursorLine + 3);

  for (let i = start; i <= end; i++) {
    const line = lines[i];
    if (!line || !isTableRow(line) || isTableSeparator(line)) continue;

    const cells = splitCells(line);
    if (cells.length < 2) continue;

    const exerciseCell = cells[0] ?? "";
    const setCells = cells.slice(1);
    const sets = setCells.map(parseSetCell);

    // Skip rows where the exercise cell itself looks like a set
    // (contains × or starts with [) — those belong to the row above, not this one
    const looksLikeSet = exerciseCell.includes(MULTIPLIER) ||
                         exerciseCell.trim().startsWith("[");
    if (looksLikeSet) continue;

    // Skip rows where no set cells have a checkbox
    // A cell with just [ ] (no weight/reps) still counts as a valid set
    const hasAnySet = sets.some((s) => s.hasCheckbox);
    if (!hasAnySet) continue;

    return {
      exerciseName: exerciseCell,
      sets,
      sourceLine: i,
      rawRow: line,
    };
  }

  return null;
}

/**
 * Write back all sets to the table row at row.sourceLine.
 * Replaces set cells (columns 1..N), preserves exercise name and extras.
 */
export function writeBack(
  content: string,
  row: ExerciseRow,
  newSets: SetData[]
): string {
  const lines = content.split("\n");
  const line = lines[row.sourceLine];
  if (!line || !isTableRow(line)) return content;

  const cells = splitCells(line);
  const exerciseCell = cells[0] ?? "";
  const newSetCells = newSets.map(serializeSetCell);

  const newCells: string[] = [exerciseCell, ...newSetCells];
  const extraCells = cells.slice(1 + newSets.length);
  const allCells = newCells.concat(extraCells);

  const newLine = "| " + allCells.join(" | ") + " |";
  lines[row.sourceLine] = newLine;
  return lines.join("\n");
}

/**
 * Toggle the completed state of a single set cell.
 * cellIndex is 0-indexed within the sets (set cell at row.sets[0] = cellIndex 0).
 */
export function toggleSetCompleted(
  content: string,
  sourceLine: number,
  cellIndex: number
): string {
  const lines = content.split("\n");
  const line = lines[sourceLine];
  if (!line || !isTableRow(line)) return content;

  const cells = splitCells(line);
  const setCellIdx = cellIndex + 1; // skip exercise name column
  if (setCellIdx >= cells.length) return content;

  const parsed = parseSetCell(cells[setCellIdx] ?? "");
  parsed.completed = !parsed.completed;
  cells[setCellIdx] = serializeSetCell(parsed);

  lines[sourceLine] = "| " + cells.join(" | ") + " |";
  return lines.join("\n");
}

/**
 * Write a single SetData back to a specific set cell.
 * cellIndex is 0-indexed within the sets.
 */
export function updateSetCell(
  content: string,
  sourceLine: number,
  cellIndex: number,
  newSet: SetData
): string {
  const lines = content.split("\n");
  const line = lines[sourceLine];
  if (!line || !isTableRow(line)) return content;

  const cells = splitCells(line);
  const setCellIdx = cellIndex + 1; // skip exercise name column
  if (setCellIdx >= cells.length) return content;

  cells[setCellIdx] = serializeSetCell(newSet);
  lines[sourceLine] = "| " + cells.join(" | ") + " |";
  return lines.join("\n");
}

/**
 * Clear a specific set cell (write an empty string to it).
 * cellIndex is 0-indexed within the sets.
 */
export function clearSetCell(
  content: string,
  sourceLine: number,
  cellIndex: number
): string {
  const lines = content.split("\n");
  const line = lines[sourceLine];
  if (!line || !isTableRow(line)) return content;

  const cells = splitCells(line);
  const setCellIdx = cellIndex + 1; // skip exercise name column
  if (setCellIdx >= cells.length) return content;

  cells[setCellIdx] = "";
  lines[sourceLine] = "| " + cells.join(" | ") + " |";
  return lines.join("\n");
}

/**
 * Insert a new set cell immediately after cellIndex (0-indexed within sets).
 * The new set's weight/reps come from the source cell; completed is forced false.
 * All existing sets at and after cellIndex shift one column to the right.
 */
export function insertSetAfter(
  content: string,
  sourceLine: number,
  cellIndex: number,
  newSet: SetData
): string {
  const lines = content.split("\n");
  const line = lines[sourceLine];
  if (!line || !isTableRow(line)) return content;

  const cells = splitCells(line);
  const setCellIdx = cellIndex + 1; // skip exercise name column
  if (setCellIdx >= cells.length) return content;

  // Force completed=false for the new cell
  const forcedSet: SetData = { ...newSet, completed: false };
  cells.splice(setCellIdx + 1, 0, serializeSetCell(forcedSet));
  lines[sourceLine] = "| " + cells.join(" | ") + " |";
  return lines.join("\n");
}
