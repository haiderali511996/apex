import SiteShell from "@/components/site/SiteShell";
import Account from "@/components/site/Account";
import { BRAND } from "@/lib/persona";
import { privateMeta } from "@/lib/seo";

export const metadata = privateMeta("Account");

export default function AccountPage() {
  return <SiteShell><div className="site-wrap"><Account /></div></SiteShell>;
}
