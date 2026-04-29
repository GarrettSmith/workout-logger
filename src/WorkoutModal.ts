import { App, MarkdownView, Modal, Notice, setIcon } from "obsidian";
import { ExerciseRow, SetData } from "./types";
import { writeBack } from "./MarkdownTableParser";

const MULTIPLIER = "\u00D7";

export class WorkoutModal extends Modal {
  private row: ExerciseRow;
  private setStates: SetData[];

  constructor(app: App, row: ExerciseRow) {
    super(app);
    this.row = row;
    this.setStates = row.sets.map((s) => ({ ...s }));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("wl-modal");

    // Header
    const header = contentEl.createDiv("wl-header");
    header.createDiv("wl-title").setText(this.row.exerciseName);
    const subtitle = header.createDiv("wl-subtitle");
    subtitle.setText(
      `${this.setStates.length} set${this.setStates.length !== 1 ? "s" : ""}`
    );
    const closeBtn = header.createDiv("wl-close-btn");
    closeBtn.setAttribute("role", "button");
    closeBtn.setAttribute("aria-label", "Close");
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.close());

    // Sets list
    const container = contentEl.createDiv("wl-sets-container");
    this.renderSets(container);

    // Bottom bar
    const bottomBar = contentEl.createDiv("wl-bottom-bar");
    const cancelBtn = bottomBar.createDiv("wl-btn wl-btn-cancel");
    cancelBtn.setText("Cancel");
    cancelBtn.addEventListener("click", () => this.close());
    const logBtn = bottomBar.createDiv("wl-btn wl-btn-primary");
    logBtn.setText("Log Workout");
    logBtn.addEventListener("click", () => this.onLog());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  private renderSets(container: HTMLElement) {
    this.setStates.forEach((set, idx) => {
      const row = container.createDiv("wl-set-row");

      // Set number badge
      const badge = row.createDiv("wl-set-badge");
      badge.setText(String(idx + 1));

      // Weight group
      const weightGroup = row.createDiv("wl-field-group");
      weightGroup.createDiv("wl-field-label").setText("Weight");
      const weightInput = weightGroup.createEl("input", {
        cls: "wl-input",
        attr: {
          type: "text",
          placeholder: "135",
          value: set.weight,
          "data-idx": String(idx),
          "data-field": "weight",
        },
      });
      const weightBtns = weightGroup.createDiv("wl-btn-group");
      const wDec5 = weightBtns.createDiv("wl-btn wl-btn-small");
      wDec5.setText("\u22125");
      wDec5.addEventListener("click", () => this.adjustWeight(idx, -5));

      const wDec25 = weightBtns.createDiv("wl-btn wl-btn-small");
      wDec25.setText("\u22122.5");
      wDec25.addEventListener("click", () => this.adjustWeight(idx, -2.5));

      const wInc25 = weightBtns.createDiv("wl-btn wl-btn-small");
      wInc25.setText("+2.5");
      wInc25.addEventListener("click", () => this.adjustWeight(idx, 2.5));

      const wInc5 = weightBtns.createDiv("wl-btn wl-btn-small");
      wInc5.setText("+5");
      wInc5.addEventListener("click", () => this.adjustWeight(idx, 5));

      // Reps group
      const repsGroup = row.createDiv("wl-field-group");
      repsGroup.createDiv("wl-field-label").setText("Reps");
      const repsInput = repsGroup.createEl("input", {
        cls: "wl-input",
        attr: {
          type: "number",
          placeholder: "8",
          value: String(set.reps),
          min: "0",
          "data-idx": String(idx),
          "data-field": "reps",
        },
      });
      const repsBtns = repsGroup.createDiv("wl-btn-group");
      const rDec = repsBtns.createDiv("wl-btn wl-btn-small");
      rDec.setText("\u22121");
      rDec.addEventListener("click", () => this.adjustReps(idx, -1));

      const rInc = repsBtns.createDiv("wl-btn wl-btn-small");
      rInc.setText("+1");
      rInc.addEventListener("click", () => this.adjustReps(idx, 1));

      // Completed checkbox
      const checkWrap = row.createDiv("wl-check-wrap");
      checkWrap.createDiv("wl-field-label").setText("Done");
      const check = checkWrap.createEl("input", {
        cls: "wl-checkbox",
        attr: {
          type: "checkbox",
          "data-idx": String(idx),
          "data-field": "completed",
        },
      });
      check.checked = set.completed;

      // Live preview
      const preview = row.createDiv("wl-preview");
      preview.setText(
        set.completed
          ? `[x] ${set.weight || set.reps}${MULTIPLIER}${set.reps}`
          : `${set.weight || set.reps}${MULTIPLIER}${set.reps}`
      );

      // Wire up live update
      weightInput.addEventListener("input", () => {
        set.weight = weightInput.value;
        this.updatePreview(row, set);
      });
      repsInput.addEventListener("input", () => {
        set.reps = parseInt(repsInput.value, 10) || 0;
        this.updatePreview(row, set);
      });
      check.addEventListener("change", () => {
        set.completed = check.checked;
        this.updatePreview(row, set);
      });
    });
  }

  private updatePreview(rowEl: HTMLElement, set: SetData) {
    const preview = rowEl.querySelector(".wl-preview");
    if (preview) {
      const text =
        set.completed
          ? `[x] ${set.weight || set.reps}${MULTIPLIER}${set.reps}`
          : `${set.weight || set.reps}${MULTIPLIER}${set.reps}`;
      preview.setText(text);
    }
  }

  private adjustWeight(idx: number, delta: number) {
    const set = this.setStates[idx];
    if (!set) return;
    const current = parseFloat(set.weight);
    if (isNaN(current)) return;
    const next = current + delta;
    set.weight = String(next);
    const input = this.contentEl.querySelector<HTMLInputElement>(
      `input[data-idx="${String(idx)}"][data-field="weight"]`
    );
    if (input) input.value = set.weight;
    const row = input?.closest(".wl-set-row");
    if (row) this.updatePreview(row as HTMLElement, set);
  }

  private adjustReps(idx: number, delta: number) {
    const set = this.setStates[idx];
    if (!set) return;
    const next = Math.max(0, set.reps + delta);
    set.reps = next;
    const input = this.contentEl.querySelector<HTMLInputElement>(
      `input[data-idx="${String(idx)}"][data-field="reps"]`
    );
    if (input) input.value = String(next);
    const row = input?.closest(".wl-set-row");
    if (row) this.updatePreview(row as HTMLElement, set);
  }

  private async onLog() {
    try {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!activeView) {
        new Notice("No active markdown view");
        return;
      }
      const file = activeView.file;
      if (!file) {
        new Notice("No file associated with this view");
        return;
      }
      const currentContent = await this.app.vault.read(file);
      const newContent = writeBack(currentContent, this.row, this.setStates);
      await this.app.vault.modify(file, newContent);
      new Notice("Workout logged!");
      this.close();
    } catch (err) {
      new Notice(`Error: ${err}`);
    }
  }
}
