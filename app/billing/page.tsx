import SiteShell from "@/components/site/SiteShell";
import Billing from "@/components/site/Billing";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Billing");

export default function BillingPage() {
  return <SiteShell><div className="site-wrap"><Billing /></div></SiteShell>;
}
