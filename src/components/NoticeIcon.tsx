import type { ReactNode } from "react";
import type { UserErrorKind } from "../userError.ts";

/** Original strokes on one 24px grid, matching the tool icons. */
const paths: Record<UserErrorKind, ReactNode> = {
  offline: <>
    <path d="M3 3l18 18M3 8a15 15 0 0 1 2.1-1.3M8.4 5.5A15 15 0 0 1 21 8M6 11.5a10 10 0 0 1 2-1.2M12 9.5a10 10 0 0 1 6 2M9 15a5 5 0 0 1 5.4-.4" />
    <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
  </>,
  timeout: <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.5 2" />
  </>,
  connection: <>
    <path d="M4.5 9a10.6 10.6 0 0 1 15 0M7.5 12.5a6.4 6.4 0 0 1 9 0M10.5 16a2.2 2.2 0 0 1 3 0M18 17l4 4M22 17l-4 4" />
    <circle cx="12" cy="20" r=".9" fill="currentColor" stroke="none" />
  </>,
  disconnected: <>
    <path d="m5 3 3 3M3 5l3 3M8 4l-4 4 2.5 2.5a2.8 2.8 0 0 0 4-4L8 4ZM19 21l-3-3M21 19l-3-3M16 20l4-4-2.5-2.5a2.8 2.8 0 0 0-4 4L16 20ZM13 5l1-3M17 8l3-1M7 16l-3 1M10 19l-1 3" />
  </>,
  key: <>
    <circle cx="8" cy="8" r="4.5" />
    <path d="m11.3 11.3 9.2 9.2M15 15l2.5-2.5M18 18l2.5-2.5" />
    <circle cx="7" cy="7" r=".8" fill="currentColor" stroke="none" />
  </>,
  quota: <>
    <path d="M4.5 17.5a9 9 0 1 1 15 0M12 12l-5 3.5M5 20h14M6.2 6.5l1.4 1.4M12 3v2M17.8 6.5l-1.4 1.4" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
  </>,
  "rate-limit": <>
    <path d="M6 3h12M6 21h12M7 3v3.5c0 2.5 5 5.5 5 5.5s5-3 5-5.5V3M7 21v-3.5c0-2.5 5-5.5 5-5.5s5 3 5 5.5V21M9 18h6" />
  </>,
  access: <>
    <rect x="4.5" y="10" width="15" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
  </>,
  model: <>
    <path d="m12 3 8 4.5v5M4 7.5 12 12l8-4.5M12 12v9M4 7.5V17l8 4 3-1.5M4 7.5 12 3M17 16l5 5M22 16l-5 5" />
  </>,
  server: <>
    <rect x="3" y="3" width="18" height="7" rx="2" />
    <path d="M12 21H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14M17 16l5 5M22 16l-5 5" />
    <circle cx="7" cy="6.5" r=".9" fill="currentColor" stroke="none" />
    <circle cx="7" cy="17" r=".9" fill="currentColor" stroke="none" />
  </>,
  context: <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 12h8M8 16h5" />
  </>,
  agent: <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M14 10l4 4M18 10l-4 4" />
  </>,
  error: <>
    <path d="m10.3 4.4-8 13.9A1.8 1.8 0 0 0 3.9 21h16.2a1.8 1.8 0 0 0 1.6-2.7l-8-13.9a2 2 0 0 0-3.4 0ZM12 9v5" />
    <circle cx="12" cy="17.5" r=".9" fill="currentColor" stroke="none" />
  </>,
};

export function NoticeIcon({ kind }: { kind: UserErrorKind }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {paths[kind] ?? paths.error}
  </svg>;
}
