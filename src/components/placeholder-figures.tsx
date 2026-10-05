// Decorative outlines for sections that are not connected yet. They carry no axis values or
// amounts on purpose: a drawn number on a financial screen could be read as a real figure.
const grid = [30, 70, 110, 150].map(y => <line key={y} className="grid" x1="0" x2="320" y1={y} y2={y} />);

export function ForecastFigure() {
  return <svg className="figure" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
    {grid}
    <line className="marker" x1="120" x2="120" y1="12" y2="168" />
    <text x="128" y="22">TODAY</text>
    <line className="known" x1="0" x2="120" y1="90" y2="90" />
    <line className="unknown" x1="120" x2="320" y1="90" y2="90" />
    <circle className="point" cx="120" cy="90" r="4" />
  </svg>;
}

// Income rises above the line and expenses fall below it; the heights carry no values.
const events = [[24, 40], [56, -24], [88, 28], [144, -36], [184, 48], [224, -20], [264, 32]];
export function CashEventsFigure() {
  return <svg className="figure" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
    {grid}
    <line className="marker" x1="120" x2="120" y1="12" y2="168" />
    <text x="128" y="22">TODAY</text>
    <line className="known" x1="0" x2="320" y1="96" y2="96" />
    {events.map(([x, height]) => <rect key={x} className={x < 120 ? "known" : "unknown"} x={x} width="16" y={height > 0 ? 96 - height : 96} height={Math.abs(height)} />)}
  </svg>;
}

export function ScenarioFigure() {
  return <svg className="figure" viewBox="0 0 320 180" aria-hidden="true" focusable="false">
    {grid}
    <line className="marker" x1="120" x2="120" y1="12" y2="168" />
    <text x="128" y="22">TODAY</text>
    <line className="known" x1="0" x2="120" y1="96" y2="96" />
    {[40, 96, 152].map(y => <g key={y}><line className="unknown" x1="120" x2="304" y1="96" y2={y} /><circle className="end" cx="304" cy={y} r="3.5" /></g>)}
    <circle className="point" cx="120" cy="96" r="4" />
  </svg>;
}
