import type { ReactNode } from "react";

/** Stands where a Gemini feature would be while AI is off (lib/config AI_ON), so nothing looks broken. */
export function Paused({ what, className = "", children }: { what: string; className?: string; children?: ReactNode }) {
  return (
    <p className={`text-footnote text-label-3 ${className}`}>
      {what} is paused for now and will be back later.{children ? <> {children}</> : null}
    </p>
  );
}
