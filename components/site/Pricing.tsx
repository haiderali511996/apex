import Link from "next/link";
import { PLANS, priceUnc, TRIAL_DAYS } from "@/lib/plans";

/** The three plans, priced in USD and in UNC. */
export default function Pricing({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <>
      <div className="pricing">
        {PLANS.map(plan => (
          <div key={plan.id} className={`plan${plan.highlighted ? " is-highlighted" : ""}`}>
            {plan.highlighted && <span className="plan-badge">Most popular</span>}
            <h3>{plan.name}</h3>
            <p className="plan-tagline">{plan.tagline}</p>
            <div className="plan-price">${plan.priceUsd}<small> / month</small></div>
            <div className="plan-unc">or {priceUnc(plan).toLocaleString()} UNC</div>
            <ul>{plan.features.map(f => <li key={f}>{f}</li>)}</ul>
            {signedIn
              ? <Link href="/account" className={`btn ${plan.highlighted ? "btn-primary" : "btn-ghost"}`}>Choose {plan.name}</Link>
              : <Link href={`/signup?plan=${plan.id}`} className={`btn ${plan.highlighted ? "btn-primary" : "btn-ghost"}`}>Start {TRIAL_DAYS}-day free trial</Link>}
          </div>
        ))}
      </div>
      <p className="pricing-note">Every plan starts with a {TRIAL_DAYS}-day free trial. You bring your own AI and voice keys (Gemini, Fish Audio), so you only pay providers for what you use. Buy a package with UNC from your account page.</p>
    </>
  );
}
