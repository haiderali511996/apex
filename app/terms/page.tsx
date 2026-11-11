import LegalPage, { CONTACT } from "@/components/site/LegalPage";
import { BRAND, COMPANY, ECOSYSTEM } from "@/lib/persona";
import { PERIOD_DAYS, TRIAL_DAYS } from "@/lib/plans";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Terms of Use", "The terms for using the UNC AI Assistant, its plans and payments.", "/terms");

const contact = CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : "the contact address on our website";

export default function Terms() {
  return (
    <LegalPage title="Terms of Use" updated="3 November 2026" sections={[
      { heading: "Agreement", body: <p>These terms are an agreement between you and the {COMPANY}, which provides {BRAND} as part of the {ECOSYSTEM}. By creating an account or using {BRAND}, you agree to them. If you use {BRAND} for an organization, you confirm you may accept these terms on its behalf.</p> },
      { heading: "Your account", body: <p>You must be at least 16, give accurate details, and keep your password safe. You are responsible for what happens under your account. Tell us at once if you think someone else has accessed it.</p> },
      { heading: "Your keys and connected services", body: <p>{BRAND} runs on the API keys and accounts you connect. You are responsible for having the right to use them, for the charges providers bill you, and for following their terms (for example Google, Fish Audio, Meta, X, TikTok and Stripe). We are not responsible for outages, limits or changes made by those providers.</p> },
      { heading: "Actions and approvals", body: <p>{BRAND} can read your connected accounts and, through the desktop app, act on your computer. Actions that post, send, delete, quit apps, restart or otherwise change things are shown to you for approval first. You are responsible for checking and approving them. AI can make mistakes — review important information before relying on it.</p> },
      { heading: "Acceptable use", body: <ul>
        <li>Do not use {BRAND} to break the law, infringe others&apos; rights, send spam, harass anyone, or access accounts or computers you are not allowed to.</li>
        <li>Do not try to break, overload, reverse-engineer or get around the security or limits of the service.</li>
        <li>Do not resell the service or share your account without our written permission.</li>
      </ul> },
      { heading: "Plans, trials and payment", body: <p>New accounts get a {TRIAL_DAYS}-day free trial. After that, a plan is needed to keep using the assistant. Plans run for {PERIOD_DAYS} days per purchase and are shown on the pricing page. Payments in UNC are made on the blockchain to the address shown at checkout and count once the transaction is confirmed; you are responsible for sending the right token, amount and network, and for any network fees. Because blockchain payments can&apos;t be reversed, purchases are non-refundable except where the law requires otherwise or we decide to refund at our discretion.</p> },
      { heading: "Your content", body: <p>You keep ownership of what you say, upload and create with {BRAND}. You give us permission to process it only as needed to provide the service to you.</p> },
      { heading: "Our service", body: <p>{BRAND}, its software, design, hologram faces and brand belong to the {COMPANY}. We may improve, change or stop features. We aim to keep the service available but do not promise it will be uninterrupted or error-free.</p> },
      { heading: "Disclaimers and liability", body: <p>{BRAND} is provided &ldquo;as is&rdquo;. To the extent the law allows, we disclaim implied warranties, and our total liability for any claim is limited to the amount you paid us in the 3 months before it. We are not liable for indirect or consequential losses, or for actions you approved.</p> },
      { heading: "Ending your use", body: <p>You can stop using {BRAND} and delete your account at any time. We may suspend or close accounts that break these terms or put the service or others at risk.</p> },
      { heading: "Changes", body: <p>We may update these terms. We will post changes here and update the date above; for significant changes we will tell you in advance. Continuing to use {BRAND} means you accept the updated terms.</p> },
      { heading: "Contact", body: <p>Questions about these terms? Contact the {COMPANY} at {contact}.</p> },
    ]} />
  );
}
