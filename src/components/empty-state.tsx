export function EmptyState({ eyebrow, title, figure, children }: { eyebrow: string; title: string; figure?: React.ReactNode; children: React.ReactNode }) {
  return <section className="empty-state"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2>{children}</div>{figure}</section>;
}
