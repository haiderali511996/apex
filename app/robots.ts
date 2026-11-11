import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/** Marketing pages and the community blog are crawlable; accounts and the API are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/account", "/billing", "/connections", "/connect", "/agent", "/face", "/facelab", "/community/new", "/login", "/downloads/"],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
