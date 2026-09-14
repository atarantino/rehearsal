import type { Fragment } from "../shared/types";
export type Caption = {
  id: string;
  speaker: Fragment["speaker"];
  start_ms: number;
  end_ms: number;
  text: string;
};
// Visual grouping only: a gap never triggers feedback, a tool, or a new question.
export function captions(fragments: Fragment[]): Caption[] {
  const groups: Caption[] = [];
  for (const speaker of ["user", "assistant"] as const) {
    let last: Caption | undefined;
    for (const f of [...fragments]
      .filter((f) => f.speaker === speaker)
      .sort((a, b) => a.start_ms - b.start_ms)) {
      if (last && f.start_ms - last.end_ms < 2000) {
        last.text += f.delta;
        last.end_ms = Math.max(last.end_ms, f.end_ms);
      } else {
        last = {
          id: f.event_id,
          speaker,
          start_ms: f.start_ms,
          end_ms: f.end_ms,
          text: f.delta,
        };
        groups.push(last);
      }
    }
  }
  return groups.sort((a, b) => a.start_ms - b.start_ms);
}
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
