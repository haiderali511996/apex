import type { Metadata } from "next";

/** The public address search engines and shared links should use. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://assistant.unctech.co").replace(/\/$/, "");
export const SITE_NAME = "AI Assistant | UNC";
// Next replaces (not merges) a parent's openGraph/twitter, so every page repeats these.
const OG_IMAGE = { url: "/brand/og-image.png", width: 1200, height: 630, alt: SITE_NAME };

/** Share-card fields for a page; `article` adds the post's date and author. */
export function shareMeta(title: string, description: string, path: string, article?: { publishedTime: string; author: string }): Metadata {
  return {
    openGraph: article
      ? { type: "article", siteName: SITE_NAME, title, description, url: path, images: [OG_IMAGE], publishedTime: article.publishedTime, authors: [article.author] }
      : { type: "website", siteName: SITE_NAME, title, description, url: path, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

/** Title, description, canonical link and share card for a public page. */
export function pageMeta(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    ...shareMeta(title, description, path),
  };
}

/** Signed-in pages: titled, but kept out of search results. */
export function privateMeta(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

/** A short plain-text summary of a post, for its description. */
export function excerpt(text: string, max = 155) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}
