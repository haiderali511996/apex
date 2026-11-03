import Link from "next/link";
import { notFound } from "next/navigation";
import SiteShell from "@/components/site/SiteShell";
import DeletePost from "@/components/site/DeletePost";
import { currentUser } from "@/lib/auth";
import { findLinks, getPost } from "@/lib/community";
import { BRAND } from "@/lib/persona";
import { SITE_NAME, SITE_URL, excerpt, shareMeta } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return { title: "Post not found", robots: { index: false } };
  const path = `/community/${post.slug}`, description = excerpt(post.body);
  return {
    title: post.title,
    description,
    alternates: { canonical: path },
    authors: [{ name: post.author }],
    ...shareMeta(post.title, description, path, { publishedTime: post.createdAt, author: post.author }),
  };
}

/** The admin's links become clickable (only they can publish links); everything else stays plain text. */
function linkify(text: string) {
  const links = findLinks(text);
  if (!links.length) return text;
  const parts: React.ReactNode[] = [];
  let rest = text;
  for (const link of links) {
    for (let at = rest.indexOf(link); at >= 0; at = rest.indexOf(link)) {
      parts.push(rest.slice(0, at));
      const href = /^https?:\/\//i.test(link) ? link : `https://${link.replace(/^(ftp:\/\/)/i, "")}`;
      parts.push(<a key={parts.length} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{link}</a>);
      rest = rest.slice(at + link.length);
    }
  }
  parts.push(rest);
  return parts;
}

/** Structured data so search engines show the post as an article. "<" is escaped so a title can't close the script tag. */
function jsonLd(post: NonNullable<ReturnType<typeof getPost>>) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: excerpt(post.body),
    datePublished: post.createdAt,
    author: { "@type": "Person", name: post.author },
    publisher: { "@type": "Organization", name: SITE_NAME, logo: { "@type": "ImageObject", url: `${SITE_URL}/brand/icon-512.png` } },
    mainEntityOfPage: `${SITE_URL}/community/${post.slug}`,
    image: `${SITE_URL}/brand/og-image.png`,
  }).replace(/</g, "\\u003c");
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = getPost((await params).slug);
  if (!post) notFound();
  const user = await currentUser();
  const canDelete = !!user && (user.id === post.authorId || user.role === "owner");
  return (
    <SiteShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(post) }} />
      <article className="section" style={{ borderTop: "none", paddingTop: 24 }}>
        <div className="site-wrap" style={{ maxWidth: 860 }}>
          <Link href="/community" style={{ color: "var(--accent)", fontSize: 14 }}>← Community</Link>
          <h2 style={{ marginTop: 16 }}>{post.title}</h2>
          <p style={{ margin: "0 0 28px" }}>{post.author} · {new Date(post.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
          <div style={{ fontSize: 17, lineHeight: 1.75, color: "#c5d7dc", display: "grid", gap: 16 }}>
            {post.body.split(/\n\s*\n/).map((para, i) => <p key={i} style={{ margin: 0, whiteSpace: "pre-wrap" }}>{post.authorIsAdmin ? linkify(para) : para}</p>)}
          </div>
          {canDelete && <div style={{ marginTop: 32 }}><DeletePost id={post.id} /></div>}
        </div>
      </article>
    </SiteShell>
  );
}
