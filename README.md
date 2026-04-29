# Workout Logger — Obsidian Plugin

Log workout sets directly into markdown tables with a tap-friendly modal. Works on mobile (iOS/Android) and desktop.

---

## Overview

**What it does:** Transforms static markdown workout tables into interactive, tappable interfaces. Tap a set cell to open a modal for editing weight and reps. Check a box to mark a set complete. Everything writes back to plain markdown — no new file format, no database, just your existing tables.

**Example table — before (plain markdown):**
```
| Back squat | 4 | 135×8 | Brace and breathe |
```

**After (interactive, rendered by the plugin):**
A row of cells each containing `[checkbox] [135×8 button]`. Tap `135×8` → single-set modal. Tap checkbox → toggles `[x]`/`[ ]`.

**Completed set:**
```
| Back squat | 4 | [x] 135×8 | Brace and breathe |
```

---

## Features

- **Single-set modal** — tap any weight×reps cell to open a focused editor: weight input with ±2.5/±5 buttons, reps input with ±1 buttons, completed checkbox, Delete and Done buttons
- **Checkbox toggle** — tap the checkbox left of any set cell to flip `[x]`/`[ ]` without opening the modal
- **Add sets** — `+` button appears in the empty cell after the last set; inserts a new set cell using the previous set's weight/reps as defaults
- **Remove sets** — `−` button in checkbox-only cells removes that set
- **Full exercise modal** — ribbon icon or command palette opens a modal for all sets of the current exercise row at once
- **Mobile-first** — large tap targets, thumb-friendly layout
- **Plain markdown output** — all data stored as readable text; parsers (daily note compactor, Dataview, etc.) work unchanged

---

## Data Format

### Cell formats

| Cell content | Meaning |
|---|---|
| `135×8` | Uncompleted set, 135 lbs/lb, 8 reps |
| `Red×8` | Uncompleted set, Red (band), 8 reps |
| `8` | Uncompleted set, no weight, 8 reps |
| `[x] 135×8` | Completed set |
| `[ ] 135×8` | Explicitly unchecked (same as `135×8` in parsing) |
| `[x]` | Completed checkbox-only set |
| *(empty)* | Blank cell — no set recorded |

### Table structure

- Column 0: exercise name (any text, any format)
- Columns 1..N: individual sets
- Extra columns (e.g. notes) are preserved as-is

```
| Exercise name | Set 1 | Set 2 | Set 3 | Notes |
|---|---|---|---|---|
| Back squat | 135×8 | 135×8 | [x] 135×6 | Brace |
```

### Source line mapping

The plugin uses Obsidian's `MarkdownPostProcessorContext.sourcePath` and the active editor's line content to map rendered HTML table cells back to source line numbers. This is necessary because Obsidian's post-processor operates on the rendered DOM, not the source.

---

## File Architecture

```
workout-logger/
├── src/
│   ├── main.ts               # Plugin entry point, lifecycle, MarkdownPostProcessor
│   ├── SetEditModal.ts       # Single-set tap modal (weight/reps ± buttons)
│   ├── WorkoutModal.ts      # Full-exercise modal (all sets at once)
│   ├── MarkdownTableParser.ts # Pure parse/serialize functions for table cells
│   └── types.ts              # TypeScript interfaces: SetData, ExerciseRow
├── styles.css                # CSS custom properties and base modal styles
├── manifest.json             # Obsidian plugin manifest
├── esbuild.config.mjs        # Build config (bundles src/ → main.js)
└── README.md                 # This file
```

### `types.ts`

Two simple interfaces:

```typescript
interface SetData {
  weight: string;   // "135", "Red", "Blue", "" if empty
  reps: number;     // 0 if empty
  completed: boolean;
}

interface ExerciseRow {
  exerciseName: string;
  sets: SetData[];
  sourceLine: number;  // 0-indexed line number in the file
  rawRow: string;       // raw markdown of the row
}
```

### `MarkdownTableParser.ts`

Pure functions — no Obsidian APIs, no DOM. All string manipulation on markdown text.

| Function | Purpose |
|---|---|
| `parseSetCell(cell)` | Parse `"[x] 135×8"` → `SetData` |
| `serializeSetCell(set)` | Serialize `SetData` → `"[x] 135×8"` or `""` |
| `parseTable(content, cursorLine)` | Find the nearest table row (±3 lines from cursor) |
| `writeBack(content, row, newSets)` | Rewrite all set cells in a row |
| `toggleSetCompleted(content, line, cellIndex)` | Flip `[x]`↔`[ ]` in one cell |
| `updateSetCell(content, line, cellIndex, newSet)` | Overwrite one cell with new SetData |
| `clearSetCell(content, line, cellIndex)` | Blank out one cell |
| `insertSetAfter(content, line, cellIndex, newSet)` | Insert a new cell after cellIndex (shifts later cells right) |

Key design decisions in parsing:
- `×` (U+00D7 MULTIPLICATION SIGN) is the canonical separator
- Both `[x] ` (with space) and `[x]` (no space) prefixes are accepted on read; `[ ] ` (with space) is also accepted but serializes as `[ ]` (no trailing space)
- Cells that don't contain `×` with a numeric reps part are ignored by the post-processor (e.g. notes columns, non-workout tables)

### `SetEditModal.ts`

Obsidian `Modal` subclass. Opens when tapping a weight×reps cell or a checkbox-only cell.

**State:**
- `sourceLine: number` — which line in the file to write back to
- `cellIdx: number` — which set cell (0-indexed within sets) to edit
- `savedWeight / savedReps` — current field values (read from `SetData` at open time)

**Completed state** is read fresh from the file at save time, not stored in the modal, to handle the case where the checkbox was toggled while the modal was open.

**On save:** reads the current completed state from the file, then calls `updateSetCell` or `insertSetAfter` depending on whether the cell was blank (`isAdding`).

**On delete:** calls `clearSetCell` — always proceeds regardless of `isAdding`, since clearing an already-blank cell is a no-op.

**Scroll preservation:** after `editor.setValue()`, uses double `requestAnimationFrame` + `editor.scrollIntoView()` on the target line to restore the editor's vertical scroll position. This does not fix sub-editor (CodeMirror inner) scroll on mobile — see Limitations below.

### `WorkoutModal.ts`

Obsidian `Modal` for bulk editing all sets of one exercise at once.

- On open: deep-copies `row.sets` into local `setStates`
- Each set renders: weight input, ±2.5/±5 buttons, reps input, ±1 buttons, checkbox, live preview text
- On "Log Workout": calls `writeBack(currentContent, row, setStates)` and writes to vault

### `main.ts`

Plugin entry point.

**`onload()`:**
1. `registerSetCellButtons()` — registers the MarkdownPostProcessor
2. Ribbon icon (dumbbell) → opens `WorkoutModal` for the active editor
3. Command palette command `Log Workout Sets` → same

**`registerSetCellButtons()` — MarkdownPostProcessor:**

The processor fires on every markdown block that renders HTML. It:
1. Finds all `<table>` elements in the rendered block
2. For each table, builds a `sourceRowMap` that maps rendered `<tr>` rows back to source line numbers, by scanning the editor's raw content
3. Pre-scans the table to determine if it has any weight×reps cells (controls whether `−` buttons appear)
4. Two-pass rendering per row:
   - **Pass 1:** Identify set cells and track the last weight×reps cell for the `+` button
   - **Pass 2:** Replace cell innerHTML with interactive elements

**Cell types and their rendered UI:**

| Cell content | Rendered as |
|---|---|
| `135×8` | `[checkbox] [135×8 button]` |
| `[x] 135×8` | `[✓checkbox] [135×8 button]` |
| `[ ]` / `[x]` | `[checkbox] [− button]` (if table has weight×reps elsewhere) |
| *(empty, after last set)* | `[+ button]` (copies last weight/reps) |
| *(empty, not after last set)* | untouched |
| Notes column | untouched |

**Click handlers on rendered cells:**
- Checkbox `change` → `toggleSetCompleted()` → `editor.setValue()` + `vault.modify()`
- Set button `click` → opens `SetEditModal`
- `+` button `click` → `insertSetAfter()` or opens `SetEditModal` if no weight to copy from
- `−` button `click` → opens `SetEditModal` in `isAdding=true` mode (Delete clears the cell)

---

## Design Decisions

### Why plain markdown tables?

Workout data should outlast any plugin. Using markdown tables means:
- The data is readable without the plugin
- Daily note compactor scripts work unchanged
- Dataview queries work unchanged
- Import/export to other tools is trivial

### Why `×` (U+00D7) instead of `x` or `*`?

It's unambiguous — `x` looks like a letter or a checkbox marker; `×` is visually distinct and has semantic meaning as "times" in strength training contexts.

### Why `[x]` and `[ ]` for checkboxes instead of Obsidian task syntax (`- [x]`)

Obsidian task syntax only works at the line level, not within table cells. `[x]` inside a table cell is a valid Obsidian-rendered checkbox that doesn't conflict with task syntax.

### Why `setValue()` then `vault.modify()`?

`editor.setValue()` updates the CodeMirror editor state and triggers a re-render. `vault.modify()` writes to disk. Both are needed — `setValue()` alone doesn't persist, `vault.modify()` alone doesn't update the editor view.

### Why double `requestAnimationFrame` for scroll restoration?

`editor.setValue()` triggers CodeMirror to rebuild its DOM internally. A single RAF fires before the DOM has settled. Two chained RAFs ensure the layout is complete before calling `scrollIntoView()`.

### Why track `sourceLine` instead of using the cursor?

The modal is opened from a rendered DOM event, not from cursor position. The post-processor stores `data-wl-line` on each cell's DOM element so the modal knows exactly which source line to edit, regardless of cursor position.

### Why `isAdding` flag?

When tapping `+` on an empty cell, the modal opens to fill in weight/reps for the first time. On save, the cell is blank so `updateSetCell` would write an empty cell — instead, `isAdding` routes to `insertSetAfter` which creates the cell with the new values. On delete while adding, the cell is already blank so we simply close without writing.

---

## Building

```bash
# Install dependencies
npm install

# Dev (watch mode — rebuilds on file changes)
npm run dev

# Production build (output: main.js)
npm run build
```

After building, copy `main.js` (and `styles.css` if added) to your vault:

```
<Vault>/.obsidian/plugins/workout-logger/
├── main.js
├── manifest.json
└── styles.css   (future)
```

Then enable in **Settings → Community plugins**.

---

## Limitations

- **Mobile scroll preservation:** Obsidian on mobile uses a nested scroll architecture. `editor.scrollIntoView()` scrolls the outer pane, not the CodeMirror inner scroller. Horizontal scroll is reset on every edit on mobile. A potential fix involves targeting the CodeMirror scroll container DOM element directly via `view.editor.cm?.scrollDOM`.
- **Multiple tables per page:** Supported via the `sourceRowMap` offset tracking, but very large numbers of tables may have edge cases.
- **No undo support:** Every edit is a full `setValue()` + `vault.modify()`, bypassing Obsidian's undo stack. Future work: use CodeMirror transactions for undoable edits.

---

## Future Improvements

- [ ] Direct CodeMirror DOM scroll targeting for mobile scroll preservation
- [ ] Undo support via CodeMirror transactions
- [ ] Settings tab (e.g. customizable weight increment step)
- [ ] Plate calculator auto-suggest (e.g. 135 → "45+45 per side")
- [ ] Rest timer integration
- [ ] `styles.css` for better mobile modal styling
