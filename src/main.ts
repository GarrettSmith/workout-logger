import {
  Editor,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownView,
  Notice,
  Plugin,
} from "obsidian";
import { parseTable, toggleSetCompleted, insertSetAfter } from "./MarkdownTableParser";
import { WorkoutModal } from "./WorkoutModal";
import { SetEditModal } from "./SetEditModal";
import { SetData } from "./types";

const MULTIPLIER = "\u00D7";

export default class WorkoutLoggerPlugin extends Plugin {
  async onload() {
    this.registerSetCellButtons();

    this.addRibbonIcon("dumbbell", "Log Workout", () => {
      this.openForCurrentEditor();
    });

    this.addCommand({
      id: "log-workout-sets",
      name: "Log Workout Sets",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.openForEditor(editor);
      },
    });
  }

  onunload() {}

  /**
   * MarkdownPostProcessor: converts set cells in workout tables into interactive elements.
   *
   * Two cell types are handled:
   *   1. Set cells (e.g. "135×8", "[x] Red×6", "[ ] 135×8"):
   *      → checkbox (toggles [x]/[ ]) + button (opens single-set editor)
   *   2. Checkbox-only cells (e.g. "[ ]", "[x]"):
   *      → clickable checkbox that toggles the completion state
   *
   * Obsidian fires the processor on the block container (often a <div>), so we
   * querySelectorAll("table") to find actual tables inside.
   */
  private registerSetCellButtons() {
    const plugin = this;

    const processor: MarkdownPostProcessor = (
      el: HTMLElement,
      ctx: MarkdownPostProcessorContext
    ) => {
      const tables: HTMLTableElement[] =
        el.tagName === "TABLE"
          ? [el as HTMLTableElement]
          : Array.from(el.querySelectorAll<HTMLTableElement>("table"));
      if (tables.length === 0) return;

      const sourcePath = ctx.sourcePath;
      if (!sourcePath) return;

      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView) return;
      const content = activeView.editor.getValue();
      const allLines = content.split("\n");

      // Process each table independently so multiple tables on one page work correctly.
      // Keep a running offset into sourceRowMap as we consume entries per-table.
      let sourceRowMapOffset = 0;

      for (const table of tables) {
        // Build sourceRowMap lazily as we discover tables in the source.
        // Track the actual last line consumed so the next table starts after it.
        const sourceRowMap: number[] = [];
        let lastLineConsumed = sourceRowMapOffset;
        for (let i = sourceRowMapOffset; i < allLines.length; i++) {
          const trimmed = allLines[i]!.trim();
          // Skip separator rows like |---|---|
          if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
          if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
            const cells = trimmed.split("|").map((c) => c.trim());
            const exercise = cells[1] ?? "";
            if (exercise) {
              sourceRowMap.push(i);
              lastLineConsumed = i;
            }
          }
          // Stop once we've collected enough source rows for this table's rendered rows
          if (sourceRowMap.length >= table.querySelectorAll("tr").length) break;
        }
        sourceRowMapOffset = lastLineConsumed + 1;

        const tableRows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tr"));

        // ── Pre-scan: does this table have any weight×reps cells anywhere? ─────
        // The − button only appears in tables that also have real weight×reps sets.
        let tableHasWeightReps = false;
        for (const row of tableRows) {
          for (const cell of Array.from(row.querySelectorAll<HTMLTableCellElement>("td, th"))) {
            const text = (cell.textContent ?? "").trim();
            if (!text) continue;
            const inner = text.replace(/^\[(x| )\]\s*/i, "");
            if (inner.indexOf(MULTIPLIER) !== -1) {
              const sepIdx = inner.indexOf(MULTIPLIER);
              const repsPart = inner.slice(sepIdx + 1).trim();
              if (/^\d+$/.test(repsPart)) {
                tableHasWeightReps = true;
                break;
              }
            }
          }
          if (tableHasWeightReps) break;
        }

        for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
          const sourceLine = sourceRowMap[rowIdx];
          if (sourceLine === undefined) continue;

          const row = tableRows[rowIdx]!;
          const cells = row.querySelectorAll<HTMLTableCellElement>("td, th");

          // First pass: identify set cells and track the last one with weight×reps.
          // We need this to know (a) whether there's a cell after the last set, and
          // (b) what weight/reps to copy into the + button.
          let lastSetCellIdx = -1;       // cell index of the last set cell
          let lastWeightPart = "";
          let lastRepsPart = "";

          cells.forEach((cell, cellIdx) => {
            if (cellIdx === 0) return;
            const raw = cell.textContent ?? "";
            const text = raw.trim();
            if (!text) return;

            const isCompleted = text.startsWith("[x]");
            const inner = text.replace(/^\[(x| )\]\s*/i, "");
            const sepIdx = inner.indexOf(MULTIPLIER);

            cell.dataset.wlLine = String(sourceLine);

            // No checkbox? Not a set — skip it entirely.
            const hasCheckbox = text.startsWith("[");
            if (!hasCheckbox) return;

            if (sepIdx === -1) {
              // Checkbox-only cell — mark and track for the per-row + button.
              // Even if it has no weight×reps, we still want the per-row + to
              // show (it will insert a new checkbox-only set after this one).
              if (inner.trim()) return;
              cell.dataset.wlSetIdx = String(cellIdx - 1);
              lastSetCellIdx = cellIdx;
              // Track empty strings so lastWeightPart/lastRepsPart are defined
              // and the per-row + button still appears after this cell.
              if (!lastWeightPart) {
                lastWeightPart = "";
                lastRepsPart = "";
              }
              return;
            }

            const weightPart = inner.slice(0, sepIdx).trim();
            const repsPart = inner.slice(sepIdx + 1).trim();
            if (!weightPart || !/^\d+$/.test(repsPart)) return;

            cell.dataset.wlSetIdx = String(cellIdx - 1);
            lastSetCellIdx = cellIdx;
            lastWeightPart = weightPart;
            lastRepsPart = repsPart;
          });

          // Second pass: render set cells and the + button.
          // Skip cellIdx 0 (exercise name). Track the empty cell slot after
          // the last set for the + button.
          let emptyCellAfterLastSet: HTMLTableCellElement | null = null;

          cells.forEach((cell, cellIdx) => {
            if (cellIdx === 0) return;
            const raw = cell.textContent ?? "";
            const text = raw.trim();

            if (!text) {
              // Empty cell — reserve it as the + button slot if it is
              // immediately after the last set cell.
              if (cellIdx === lastSetCellIdx + 1) {
                emptyCellAfterLastSet = cell;
              }
              return;
            }

            const isCompleted = text.startsWith("[x]");
            const hasCheckbox = text.startsWith("[");
            const inner = text.replace(/^\[(x| )\]\s*/i, "");
            const sepIdx = inner.indexOf(MULTIPLIER);

            // No checkbox? Not a set — skip it.
            if (!hasCheckbox) return;

            if (sepIdx === -1) {
              // ── Checkbox-only cell ─────────────────────────────────────────────
              if (inner.trim()) return;
              if (cell.querySelector(".wl-cell-checkbox")) return;
              cell.innerHTML = "";
              cell.addClass("wl-checkbox-only-cell");

              const innerWrapper = document.createElement("span");
              innerWrapper.addClass("wl-cell-inner");

              const checkInput = document.createElement("input");
              checkInput.type = "checkbox";
              checkInput.checked = isCompleted;
              checkInput.className = "wl-cell-checkbox";
              checkInput.addEventListener("change", () => {
                const line = parseInt(cell.dataset.wlLine ?? "", 10);
                const setIdx = parseInt(cell.dataset.wlSetIdx ?? "", 10);
                if (isNaN(line) || isNaN(setIdx)) return;

                const view =
                  plugin.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) return;
                const editor = view.editor;
                const f = view.file;
                if (!f) return;

                const c = editor.getValue();
                const next = toggleSetCompleted(c, line, setIdx);
                if (next !== c) {
                  editor.setValue(next);
                  plugin.app.vault.modify(f, next);
                  requestAnimationFrame(() =>
                    plugin.app.metadataCache.trigger("changed", f)
                  );
                }
              });

              // Checkbox first → appears to the left
              innerWrapper.appendChild(checkInput);

              // − button second → appears to the right
              if (tableHasWeightReps) {
                const addBtn = document.createElement("button");
                addBtn.className = "wl-cell-add";
                addBtn.textContent = "\u2212"; // −
                addBtn.title = "Edit set";
                addBtn.addEventListener("click", (evt) => {
                  evt.stopPropagation();
                  const line = parseInt(cell.dataset.wlLine ?? "", 10);
                  if (isNaN(line)) return;
                  const setIdx = parseInt(cell.dataset.wlSetIdx ?? "", 10);
                  if (isNaN(setIdx)) return;
                  new SetEditModal(
                    plugin.app,
                    { weight: "", reps: 0, completed: false, hasCheckbox: true },
                    line,
                    setIdx,
                    true // isAdding
                  ).open();
                });

                // − button second → appears to the right
                innerWrapper.appendChild(addBtn);
              }

              cell.appendChild(innerWrapper);
              return;
            }

            const weightPart = inner.slice(0, sepIdx).trim();
            const repsPart = inner.slice(sepIdx + 1).trim();
            if (!weightPart || !/^\d+$/.test(repsPart)) return;

            // ── Full set cell (weight×reps + checkbox) ─────────────────────
            if (cell.querySelector(".wl-cell-btn")) return;

            cell.innerHTML = "";
            cell.addClass("wl-set-cell");

            const innerWrapper = document.createElement("span");
            innerWrapper.addClass("wl-cell-inner");

            // ── Checkbox ──────────────────────────────────────────────────
            const checkInput = document.createElement("input");
            checkInput.type = "checkbox";
            checkInput.checked = isCompleted;
            checkInput.className = "wl-cell-checkbox";
            checkInput.addEventListener("change", () => {
              const line = parseInt(cell.dataset.wlLine ?? "", 10);
              const setIdx = parseInt(cell.dataset.wlSetIdx ?? "", 10);
              if (isNaN(line) || isNaN(setIdx)) return;

              const view =
                plugin.app.workspace.getActiveViewOfType(MarkdownView);
              if (!view) return;
              const editor = view.editor;
              const f = view.file;
              if (!f) return;

              const c = editor.getValue();
              const next = toggleSetCompleted(c, line, setIdx);
              if (next !== c) {
                editor.setValue(next);
                plugin.app.vault.modify(f, next);
                requestAnimationFrame(() =>
                  plugin.app.metadataCache.trigger("changed", f)
                );
              }
            });

            // ── Button: open single-set modal ─────────────────────────────
            const btn = document.createElement("button");
            btn.className = "wl-cell-btn";
            btn.textContent = `${weightPart}${MULTIPLIER}${repsPart}`;
            btn.addEventListener("click", (evt) => {
              evt.stopPropagation();
              const line = parseInt(cell.dataset.wlLine ?? "", 10);
              if (isNaN(line)) {
                new Notice("Could not locate table row");
                return;
              }
              const setIdx = parseInt(cell.dataset.wlSetIdx ?? "", 10);
              if (isNaN(setIdx)) {
                new Notice("Could not locate set cell");
                return;
              }
              const set: SetData = {
                weight: weightPart,
                reps: parseInt(repsPart, 10) || 0,
                completed: isCompleted,
                hasCheckbox: true,
              };
              new SetEditModal(plugin.app, set, line, setIdx).open();
            });

            innerWrapper.appendChild(checkInput);
            innerWrapper.appendChild(btn);
            cell.appendChild(innerWrapper);
          });

          // ── + button: appears in the empty cell after the last set,
          // only if there is a weight×reps cell to copy from ───────────
          if (
            emptyCellAfterLastSet &&
            lastSetCellIdx >= 1
          ) {
            const addBtnCell = emptyCellAfterLastSet as HTMLTableCellElement;
            if (addBtnCell.querySelector(".wl-cell-add")) return;

            addBtnCell.innerHTML = "";
            addBtnCell.addClass("wl-set-cell");

            const innerWrapper = document.createElement("span");
            innerWrapper.addClass("wl-cell-inner");

            const addBtn = document.createElement("button");
            addBtn.className = "wl-cell-add";
            addBtn.textContent = "+";
            addBtn.title = lastWeightPart
              ? `Add set (copy ${lastWeightPart}${MULTIPLIER}${lastRepsPart})`
              : "Add set";
            addBtn.addEventListener("click", (evt) => {
              evt.stopPropagation();
              const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
              if (!view) return;
              const f = view.file;
              if (!f) return;
              const editor = view.editor;
              const c = editor.getValue();
              // lastSetCellIdx is the rendered cell index; subtract 1 for set index.
              const setIdx = lastSetCellIdx - 1;

              if (!lastWeightPart) {
                // No weight×reps to copy — open the modal in adding mode
                // so the user can enter weight and reps.
                new SetEditModal(
                  plugin.app,
                  { weight: "", reps: 0, completed: false, hasCheckbox: true },
                  sourceLine,
                  setIdx,
                  true
                ).open();
                return;
              }

              const srcSet: SetData = {
                weight: lastWeightPart,
                reps: parseInt(lastRepsPart, 10) || 0,
                completed: false,
                hasCheckbox: true,
              };
              const next = insertSetAfter(c, sourceLine, setIdx, srcSet);
              if (next !== c) {
                editor.setValue(next);
                plugin.app.vault.modify(f, next);
                requestAnimationFrame(() =>
                  plugin.app.metadataCache.trigger("changed", f)
                );
              }
            });

            innerWrapper.appendChild(addBtn);
            addBtnCell.appendChild(innerWrapper);
          }
        }
      }
    };

    this.registerMarkdownPostProcessor(processor);
  }

  private openForCurrentEditor() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      new Notice("No active markdown file");
      return;
    }
    this.openForEditor(view.editor);
  }

  private openForEditor(editor: Editor) {
    const cursor = editor.getCursor();
    const content = editor.getValue();
    const row = parseTable(content, cursor.line);

    if (!row) {
      new Notice("Place cursor in a workout table row");
      return;
    }

    new WorkoutModal(this.app, row).open();
  }
}
