"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function InlineAlert({
  tone,
  title,
  children,
  focus = false,
}: {
  tone: "danger" | "warning" | "info" | "success";
  title: string;
  children?: ReactNode;
  focus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus, title]);

  return (
    <div
      ref={ref}
      className={`a-inline-alert is-${tone}`}
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      tabIndex={focus ? -1 : undefined}
    >
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}
