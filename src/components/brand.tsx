// Two overlapping circles: the finances as they are, and their twin as they could be.
export function TwinMark({ size = 26 }: { size?: number }) {
  return <svg className="twin-mark" width={size} height={Math.round(size * 0.64)} viewBox="0 0 25 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="7.25" fill="currentColor" />
    <circle className="twin" cx="17" cy="8" r="7.25" fill="none" strokeWidth="1.5" />
  </svg>;
}
export function Brand() {
  return <span className="brand"><TwinMark /><span>FinTwin</span><span className="brand-suffix">Global</span></span>;
}
