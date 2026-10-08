import type { ReactNode } from "react";

export function ActionSummary({
  title = "Current operation",
  items,
  nextAction,
}: {
  title?: string;
  items: { label: string; value: ReactNode }[];
  nextAction: ReactNode;
}) {
  return (
    <section className="a-action-summary" aria-labelledby={`summary-${title.replace(/\s+/g, "-").toLowerCase()}`}>
      <h2 id={`summary-${title.replace(/\s+/g, "-").toLowerCase()}`}>{title}</h2>
      <dl>
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="a-next-action"><strong>Next safe action</strong><span>{nextAction}</span></p>
    </section>
  );
}
