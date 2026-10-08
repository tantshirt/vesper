import type { ReactNode } from "react";

export type StageState = "completed" | "current" | "blocked" | "upcoming";

export type StageItem = {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  state: StageState;
};

export function StageRail({ label, stages }: { label: string; stages: StageItem[] }) {
  return (
    <nav className="a-stage-rail" aria-label={label}>
      <ol>
        {stages.map((stage, index) => (
          <li className={`is-${stage.state}`} key={stage.id} aria-current={stage.state === "current" ? "step" : undefined}>
            <span className="a-stage-marker" aria-hidden>{stage.state === "completed" ? "✓" : index + 1}</span>
            <span className="a-stage-copy">
              <strong>{stage.label}</strong>
              {stage.detail && <small>{stage.detail}</small>}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
