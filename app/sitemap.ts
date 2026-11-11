import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/community";
import { SITE_URL } from "@/lib/seo";

// Rebuilt on each request so new community posts appear straight away.
export const dynamic = "force-dynamic";

/** The public pages and every community post, for search engines. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/welcome`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/download`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/docs`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/community`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/signup`, changeFrequency: "yearly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
  const posts = listPosts(5000).map(post => ({
    url: `${SITE_URL}/community/${post.slug}`,
    lastModified: post.createdAt,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));
  return [...pages, ...posts];
}
