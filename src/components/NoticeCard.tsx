import type { Note } from "../types.ts";
import { NoticeIcon } from "./NoticeIcon.tsx";

export function NoticeCard({ entry }: { entry: Note }) {
  const icon = entry.icon ?? (entry.tone === "alarm" ? "error" : undefined);
  return <div className={`notice${entry.tone === "alarm" ? " notice-alarm" : ""}`} role="note">
    {icon && <span className="notice-icon"><NoticeIcon kind={icon} /></span>}
    <span className="notice-text">{entry.text}</span>
  </div>;
}
