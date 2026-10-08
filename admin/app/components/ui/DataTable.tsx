"use client";

import { useState, type ReactNode } from "react";

// DataTable — the review-queue table SHELL. It provides the operational chrome the
// admin surface needs: a sticky, blurred header (the same idiom as the consumer nav),
// 44px comfortable rows with a 36px compact density toggle, right-aligned tabular
// number columns, and a lavender hover. It renders status-chip / mono-data cells via
// each column's `render`. The structure is virtualization-ready (a single scroll
// container + fixed row heights) — this story ships the shell + props, not a
// virtualization lib. Enforcement and data-fetching live elsewhere; this is presentation.

export type Column<Row> = {
  key: string;
  header: ReactNode;
  /** "num" right-aligns the header + cells and applies tabular figures. */
  align?: "start" | "num";
  /** Cell renderer. Return a StatusChip, MonoData, Money, or plain text. */
  render: (row: Row) => ReactNode;
  width?: string;
};

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  subCaption,
  compact: compactProp,
  defaultCompact = false,
  showDensityToggle = true,
  emptyLabel = "Nothing to review.",
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  caption?: ReactNode;
  subCaption?: ReactNode;
  /** Controlled density. When provided, the internal toggle is not rendered. */
  compact?: boolean;
  defaultCompact?: boolean;
  showDensityToggle?: boolean;
  emptyLabel?: ReactNode;
}) {
  const [internalCompact, setInternalCompact] = useState(defaultCompact);
  const controlled = compactProp !== undefined;
  const compact = controlled ? compactProp : internalCompact;
  const showToggle = showDensityToggle && !controlled;

  return (
    <div className="a-table-panel">
      {(caption || showToggle) && (
        <div className="a-table-toolbar">
          <div className="a-table-caption">
            {caption}
            {subCaption && <small>{subCaption}</small>}
          </div>
          {showToggle && (
            <div className="a-seg" role="group" aria-label="Row density">
              <button
                type="button"
                className={`a-seg-btn${!compact ? " on" : ""}`}
                aria-pressed={!compact}
                onClick={() => setInternalCompact(false)}
              >
                Comfortable
              </button>
              <button
                type="button"
                className={`a-seg-btn${compact ? " on" : ""}`}
                aria-pressed={compact}
                onClick={() => setInternalCompact(true)}
              >
                Compact
              </button>
            </div>
          )}
        </div>
      )}

      <div className="a-table-scroll">
        <table className={`a-table${compact ? " is-compact" : ""}`}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={c.align === "num" ? "a-col-num" : undefined}
                  style={c.width ? { width: c.width } : undefined}
                  scope="col"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="a-table-empty" colSpan={columns.length}>
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={rowKey(row, i)}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === "num" ? "a-td-num" : undefined}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
