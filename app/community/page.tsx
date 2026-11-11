import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import { listPosts } from "@/lib/community";
import { currentUser } from "@/lib/auth";
import { BRAND } from "@/lib/persona";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Community blog", "Guides, ideas and stories about AI voice assistants, written by the UNC AI Assistant community.", "/community");
export const dynamic = "force-dynamic";

export default async function Community() {
  const posts = listPosts();
  const signedIn = !!(await currentUser());
  return (
    <SiteShell>
      <section className="section" style={{ borderTop: "none", paddingTop: 24 }}>
        <div className="site-wrap">
          <p className="eyebrow">Community</p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h2>Community talks</h2>
              <p style={{ margin: 0 }}>How people use their assistants: setups, tips, workflows and ideas — written by the community.</p>
            </div>
            {signedIn
              ? <Link href="/community/new" className="btn btn-primary">Write a post</Link>
              : <Link href="/login?next=/community/new" className="btn btn-ghost">Log in to write</Link>}
          </div>
          <div className="grid3" style={{ marginTop: 32 }}>
            {posts.map(p => (
              <Link key={p.id} href={`/community/${p.slug}`} className="card" style={{ textDecoration: "none", display: "block" }}>
                <h3>{p.title}</h3>
                <p style={{ fontSize: 13, marginBottom: 10 }}>{p.author} · {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                <p>{p.body.slice(0, 200)}{p.body.length > 200 ? "…" : ""}</p>
              </Link>
            ))}
          </div>
          {!posts.length && <div className="card" style={{ marginTop: 8 }}><h3>No posts yet</h3><p>Be the first: share how you set up your assistant, or a workflow that saves you time.</p></div>}
        </div>
      </section>
    </SiteShell>
  );
}
