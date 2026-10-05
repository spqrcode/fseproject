export function PageHeading({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="intro">{intro}</p></div>{children}</div>;
}
