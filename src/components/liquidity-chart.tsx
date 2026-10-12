import type { ForecastResult } from "@/lib/forecast";
import { chartGeometry } from "@/lib/liquidity-overview";
import { formatDate, formatMoney } from "@/lib/format";

// The projected end-of-day balance as a step line, with the danger threshold, the lowest point and the
// first breach marked. The drawing is decorative for assistive technology: the same values are given
// as text beside it and day by day in the table below, so nothing is only available as a picture.
export function LiquidityChart({ result }: { result: ForecastResult }) {
  const chart = chartGeometry(result);
  const first = result.timeline[0].date;
  const last = result.timeline[result.timeline.length - 1].date;
  return <figure className="forecast-chart">
    <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {chart.zeroY !== null && <line className="zero" x1="0" x2={chart.width} y1={chart.zeroY} y2={chart.zeroY} />}
      <line className="threshold" x1="0" x2={chart.width} y1={chart.thresholdY} y2={chart.thresholdY} />
      {chart.dangerX !== null && <line className="breach" x1={chart.dangerX} x2={chart.dangerX} y1="0" y2={chart.height} />}
      <path className="balance" d={chart.path} vectorEffect="non-scaling-stroke" />
      {/* A tick rather than a dot: the drawing is stretched to the width, which would turn a circle into an ellipse. */}
      <line className="lowest" x1={chart.minimum.x} x2={chart.minimum.x} y1={chart.minimum.y - 10} y2={chart.minimum.y + 10} />
    </svg>
    <figcaption>
      <span>{formatDate(first)}</span>
      <span className="legend"><span className="key key-balance" aria-hidden="true" />Balance <span className="key key-threshold" aria-hidden="true" />Danger threshold {formatMoney(result.dangerThresholdAmount, result.currency)}</span>
      <span>{formatDate(last)}</span>
    </figcaption>
  </figure>;
}
