import { App, MarkdownView, Modal } from "obsidian";
import { SetData } from "./types";
import { parseSetCell, updateSetCell, clearSetCell, insertSetAfter } from "./MarkdownTableParser";

export class SetEditModal extends Modal {
  private sourceLine: number;
  private cellIdx: number;
  private savedWeight: string;
  private savedReps: number;
  /** When true, the cell is blank and we're adding weight×reps for the first time. */
  private isAdding: boolean;

  constructor(
    app: App,
    set: SetData,
    sourceLine: number,
    cellIdx: number,
    isAdding = false
  ) {
    super(app);
    // Store only weight/reps — completed state is read fresh at save time
    // to avoid stale-closure issues when checkbox toggles happened before
    // the modal opened.
    this.sourceLine = sourceLine;
    this.cellIdx = cellIdx;
    this.savedWeight = set.weight;
    this.savedReps = set.reps;
    this.isAdding = isAdding;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wl-modal", "wl-set-modal-v2");

    const rows = contentEl.createDiv("wl-v2-rows");

    // Row 1 — Done (display-only; completed state is read fresh at save time)
    const doneRow = rows.createDiv("wl-v2-row");
    doneRow.createDiv("wl-v2-label").setText("Done");
    const doneWrap = doneRow.createDiv("wl-v2-done-wrap");
    const doneCheck = doneWrap.createEl("input", {
      cls: "wl-checkbox",
      attr: { type: "checkbox", disabled: "true" },
    });

    // Row 2 — Weight: -5 | -2.5 | [input] | +2.5 | +5
    const weightRow = rows.createDiv("wl-v2-row");
    weightRow.createDiv("wl-v2-label").setText("Weight");
    const wGrp = weightRow.createDiv("wl-v2-btn-row");
    const wDec5 = wGrp.createDiv("wl-btn wl-btn-small");
    wDec5.setText("\u22125");
    const wDec25 = wGrp.createDiv("wl-btn wl-btn-small");
    wDec25.setText("\u22122.5");
    const wInput = wGrp.createEl("input", {
      cls: "wl-input wl-v2-input",
      attr: { type: "text", placeholder: "135", value: this.savedWeight },
    });
    const wInc25 = wGrp.createDiv("wl-btn wl-btn-small");
    wInc25.setText("+2.5");
    const wInc5 = wGrp.createDiv("wl-btn wl-btn-small");
    wInc5.setText("+5");

    wDec5.addEventListener("click", () => this.adj(wInput, -5));
    wDec25.addEventListener("click", () => this.adj(wInput, -2.5));
    wInc25.addEventListener("click", () => this.adj(wInput, 2.5));
    wInc5.addEventListener("click", () => this.adj(wInput, 5));
    wInput.addEventListener("input", () => {
      this.savedWeight = wInput.value;
    });

    // Row 3 — Reps: -1 | [input] | +1
    const repsRow = rows.createDiv("wl-v2-row");
    repsRow.createDiv("wl-v2-label").setText("Reps");
    const rGrp = repsRow.createDiv("wl-v2-btn-row");
    const rDec = rGrp.createDiv("wl-btn wl-btn-small");
    rDec.setText("\u22121");
    const rInput = rGrp.createEl("input", {
      cls: "wl-input wl-v2-input",
      attr: { type: "number", placeholder: "8", value: String(this.savedReps), min: "0" },
    });
    const rInc = rGrp.createDiv("wl-btn wl-btn-small");
    rInc.setText("+1");

    rDec.addEventListener("click", () => this.adjReps(rInput, -1));
    rInc.addEventListener("click", () => this.adjReps(rInput, 1));
    rInput.addEventListener("input", () => {
      this.savedReps = parseInt(rInput.value, 10) || 0;
    });

    // Bottom — Delete / Done buttons
    const bottom = contentEl.createDiv("wl-v2-bottom");
    bottom.style.display = "flex";
    bottom.style.gap = "12px";

    const deleteBtn = bottom.createDiv("wl-btn wl-btn-cancel");
    deleteBtn.style.flex = "1";
    deleteBtn.setText("Delete");
    deleteBtn.addEventListener("click", () => this.onDelete());

    const saveBtn = bottom.createDiv("wl-btn wl-btn-primary");
    saveBtn.style.flex = "1";
    saveBtn.setText("Done");
    saveBtn.addEventListener("click", () => this.onSave());

    // Tap outside to cancel
    contentEl.addEventListener("click", (e) => {
      if (e.target === contentEl) this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private adj(input: HTMLInputElement, delta: number) {
    const current = parseFloat(input.value);
    if (isNaN(current)) return;
    const next = current + delta;
    input.value = String(next);
    this.savedWeight = input.value;
  }

  private adjReps(input: HTMLInputElement, delta: number) {
    const current = parseInt(input.value, 10) || 0;
    const next = Math.max(0, current + delta);
    input.value = String(next);
    this.savedReps = next;
  }

  private onSave() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) {
      return;
    }
    const editor = view.editor;
    const content = editor.getValue();

    // If isAdding: cell is blank, use insertSetAfter to create weight×reps in it.
    // If not adding: read fresh completed state and use updateSetCell.
    const lines = content.split("\n");
    const sourceLine = lines[this.sourceLine];
    if (!sourceLine) return;
    const cells = sourceLine.trim().slice(1, -1).split("|").map((c: string) => c.trim());
    const setCellIdx = this.cellIdx + 1; // skip exercise name
    const currentSet = parseSetCell(cells[setCellIdx] ?? "");

    let next: string;
    if (this.isAdding) {
      // Cell is blank — insert weight×reps as uncompleted.
      const newSet: SetData = {
        weight: this.savedWeight,
        reps: this.savedReps,
        completed: false,
        hasCheckbox: true,
      };
      next = insertSetAfter(content, this.sourceLine, this.cellIdx - 1, newSet);
    } else {
      // Update existing cell, preserving completed state from file.
      const newSet: SetData = {
        weight: this.savedWeight,
        reps: this.savedReps,
        completed: currentSet.completed,
        hasCheckbox: currentSet.hasCheckbox,
      };
      next = updateSetCell(content, this.sourceLine, this.cellIdx, newSet);
    }

    if (next !== content) {
      const savedLine = this.sourceLine;
      editor.setValue(next);
      this.app.vault.modify(view.file, next);
      // Double-RAF: first lets CodeMirror rebuild its DOM after setValue,
      // second ensures layout is complete before scrolling the line into view.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const range = { from: { line: savedLine, ch: 0 }, to: { line: savedLine, ch: 0 } };
          editor.scrollIntoView(range, false);
          this.app.metadataCache.trigger("changed", view.file);
        });
      });
    }
    this.close();
  }

  private onDelete() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    const editor = view.editor;
    const content = editor.getValue();
    const next = clearSetCell(content, this.sourceLine, this.cellIdx);
    if (next !== content) {
      const savedLine = this.sourceLine;
      editor.setValue(next);
      this.app.vault.modify(view.file, next);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const range = { from: { line: savedLine, ch: 0 }, to: { line: savedLine, ch: 0 } };
          editor.scrollIntoView(range, false);
          this.app.metadataCache.trigger("changed", view.file);
        });
      });
    }
    this.close();
  }
}
