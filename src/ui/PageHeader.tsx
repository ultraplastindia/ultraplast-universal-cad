export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: unknown }) {
  return <div className="pagehead"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children ? <div className="pagehead-r">{children as never}</div> : null}</div>;
}
