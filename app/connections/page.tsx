import SiteShell from "@/components/site/SiteShell";
import Connections from "@/components/site/Connections";
import { BRAND } from "@/lib/persona";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Connections");

export default function ConnectionsPage() {
  return <SiteShell><div className="site-wrap"><Connections /></div></SiteShell>;
}
