import SiteShell from "./SiteShell";

/** Shared layout for the Privacy Policy and Terms of Use. */
export default function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: React.ReactNode }[] }) {
  return (
    <SiteShell>
      <section className="section" style={{ borderTop: "none", paddingTop: 24 }}>
        <div className="site-wrap" style={{ maxWidth: 980 }}>
          <p className="eyebrow">Legal</p>
          <h2>{title}</h2>
          <p>Last updated {updated}</p>
          <div style={{ display: "grid", gap: 22, lineHeight: 1.7, color: "var(--muted)" }}>
            {sections.map(s => <section key={s.heading}><h3 style={{ color: "var(--text)", margin: "0 0 6px", fontSize: 18 }}>{s.heading}</h3>{s.body}</section>)}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}

export const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "";
