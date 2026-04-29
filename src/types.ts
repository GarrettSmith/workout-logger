export interface SetData {
  weight: string; // "135", "Red", "Blue", "" if empty
  reps: number;   // 0 if empty
  completed: boolean;
  hasCheckbox: boolean; // true if cell had a [x] or [ ] prefix
}

export interface ExerciseRow {
  exerciseName: string;
  sets: SetData[];
  sourceLine: number; // 0-indexed line number in file
  // The table line itself (the entire row as raw markdown)
  rawRow: string;
}
