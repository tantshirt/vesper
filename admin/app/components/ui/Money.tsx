// Money — a small helper that renders an amount in Inter, tabular-nums, so columns
// of money align on the decimal and a reactive update never shifts layout. Color is
// neutral (ink) by default; pass `signed` to tint gains gain-green / losses loss-red
// (still paired with an explicit +/− sign, never color alone).

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const UNITS = new Intl.NumberFormat("en-US");

export function Money({
  value,
  currency = "USD",
  signed = false,
  className = "",
}: {
  value: number;
  /** "USD" formats as currency; "units" formats a plain token/share count. */
  currency?: "USD" | "units";
  /** Show an explicit +/− and tint via the semantic tokens. */
  signed?: boolean;
  className?: string;
}) {
  const fmt = currency === "USD" ? USD : UNITS;
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  const body = fmt.format(Math.abs(value));
  const tone = signed ? (value > 0 ? "pos" : value < 0 ? "neg" : "") : "";
  return (
    <span className={`a-money ${tone} ${className}`.trim()}>
      {sign}
      {body}
    </span>
  );
}
