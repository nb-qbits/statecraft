"use client";

import { STATUS_META } from "@/lib/docket-types";
import type { TaskStatus } from "@/lib/docket-types";

export interface StatusBadgeProps {
  status: TaskStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = STATUS_META[status];

  return (
    <span
      className="rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap"
      style={{ backgroundColor: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}
