import SiteShell from "@/components/site/SiteShell";
import Pricing from "@/components/site/Pricing";
import { BRAND } from "@/lib/persona";
import { currentUser } from "@/lib/auth";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Pricing", "Starter, Pro and Business plans for the UNC AI Assistant, with a 7-day free trial. Pay by card or with UNC coin.", "/pricing");

export default async function PricingPage() {
  const signedIn = !!(await currentUser());
  return (
    <SiteShell>
      <section className="section" style={{ borderTop: "none", paddingTop: 32 }}>
        <div className="site-wrap">
          <p className="eyebrow">Pricing</p>
          <h2>Plans for every way you work</h2>
          <p>Start free, then choose a plan. Prices are per month; pay by card soon, or with UNC today.</p>
          <Pricing signedIn={signedIn} />
        </div>
      </section>
    </SiteShell>
  );
}
