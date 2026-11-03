import LegalPage, { CONTACT } from "@/components/site/LegalPage";
import { BRAND, COMPANY, ECOSYSTEM } from "@/lib/persona";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Privacy Policy", "How the UNC AI Assistant collects, uses, stores and protects your data, including Google user data.", "/privacy");

const contact = CONTACT ? <a href={`mailto:${CONTACT}`}>{CONTACT}</a> : "the contact address on our website";

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="3 November 2026" sections={[
      { heading: "Who we are", body: <p>{BRAND} is a voice assistant made and operated by the {COMPANY} as part of the {ECOSYSTEM} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what we collect when you use {BRAND}, why, and the choices you have.</p> },
      { heading: "What we collect", body: <ul>
        <li><b>Account details:</b> your name, email address and a securely hashed password.</li>
        <li><b>Assistant settings:</b> the name, face and voice you choose.</li>
        <li><b>Keys and connections:</b> the API keys and account tokens you add on the Connections page (for example Gemini, Fish Audio, Google, Meta, X, TikTok, Stripe). These are encrypted at rest and used only to carry out your own requests.</li>
        <li><b>Conversations and voice:</b> what you say or type to the assistant, and its replies. Voice is sent as short recordings to be transcribed; we do not keep the audio after transcription.</li>
        <li><b>Assistant memory and approvals:</b> facts you ask it to remember, actions waiting for your approval, and a log of actions it has carried out.</li>
        <li><b>Payments:</b> for UNC payments, the plan, amount, transaction hash and paying wallet address, which are public on the blockchain.</li>
        <li><b>Technical data:</b> basic server logs (such as time, request type and errors) used to keep the service working and secure.</li>
      </ul> },
      { heading: "How we use it", body: <p>To run the assistant for you; to connect to the services you choose; to verify payments and manage your plan; to keep the service secure and fix problems; and to contact you about your account. We do not sell your personal data, and we do not use your connected accounts for anything you did not ask for.</p> },
      { heading: "Third-party services you connect", body: <p>When you use {BRAND}, your requests are processed by the providers whose keys you add — for example Google (Gemini, Gmail, Calendar, Drive, Search Console, YouTube, Analytics), Fish Audio, Meta, X, TikTok and Stripe. Their own terms and privacy policies apply to what they receive. Because these run on your own keys, your provider account settings (such as whether a provider may use data to improve its models) also apply.</p> },
      { heading: "Google user data", body: <>
        <p>If you connect Google, {BRAND} uses Gmail, Calendar, Drive, Sheets, Search Console, YouTube and Analytics data only to do what you ask — such as summarizing your inbox, reading your schedule or reporting your site&apos;s traffic — and to send or create things only after you approve them. We don&apos;t sell Google user data, use it for advertising, or let people read it except with your permission, for security, or where the law requires.</p>
        <p>{BRAND}&apos;s use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
      </> },
      { heading: "Your computer", body: <p>If you connect a computer through the desktop app, {BRAND} can perform the actions you ask for there. Actions that close, delete, send or change something wait for your approval. We do not collect the files or browsing history on your computer.</p> },
      { heading: "How long we keep data", body: <p>We keep your account data while your account is active. You can remove any key at any time on the Connections page. If you delete your account, we delete your account data, keys, settings, memory and conversation logs within 30 days, except payment records we must keep for legal or accounting reasons.</p> },
      { heading: "Security", body: <p>Passwords are hashed, keys and tokens are encrypted, sessions use secure cookies, and access is limited to what is needed to run the service. No system is perfectly secure, so please use strong, unique passwords and restricted, read-only keys where providers offer them.</p> },
      { heading: "Your rights", body: <p>Depending on where you live, you may have the right to access, correct, export or delete your data, and to object to or restrict some processing. To make a request, contact us at {contact}.</p> },
      { heading: "Children", body: <p>{BRAND} is not intended for anyone under 16, and we do not knowingly collect their data.</p> },
      { heading: "Changes", body: <p>We will post any changes to this policy here and update the date above. For significant changes we will let you know by email or in the app.</p> },
      { heading: "Contact", body: <p>Questions about privacy? Contact the {COMPANY} at {contact}.</p> },
    ]} />
  );
}
