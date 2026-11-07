import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import { BRAND } from "@/lib/persona";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Setup guide", "Connect Gemini, Fish Audio, Google, Facebook, Instagram, X, TikTok and your computer to the UNC AI Assistant in about ten minutes.", "/docs");

const STEPS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "start", title: "1. What you need",
    body: <>
      <p>To use {BRAND} in your browser you only need an account and a <b>Gemini API key</b>. Nothing has to be installed. Chrome or Edge on a laptop works best for the microphone.</p>
      <p>The desktop app needs nothing else installed. Install these only for the extras:</p>
      <ul>
        <li><b>Node.js 22 or newer</b> (for the Developer agent / Claude Code) — <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">nodejs.org/en/download</a>. Check with <code>node -v</code>.</li>
        <li><b>Python 3.10 or newer</b> (for the optional helper scripts) — <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer">python.org/downloads</a>. Check with <code>python3 --version</code> (on Windows: <code>py --version</code>).</li>
      </ul>
    </>,
  },
  {
    id: "gemini", title: "2. Gemini (required)",
    body: <ol>
      <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio → API keys</a> and sign in with Google.</li>
      <li>Press <b>Create API key</b> and copy it (it starts with <code>AIza</code>).</li>
      <li>Paste it on the <Link href="/connections">Connections</Link> page and press <b>Save</b>. The page tests it for you.</li>
    </ol>,
  },
  {
    id: "fish", title: "3. Fish Audio (natural voice)",
    body: <ol>
      <li>Create an account at <a href="https://fish.audio" target="_blank" rel="noreferrer">fish.audio</a> and add credit if you want the paid voices.</li>
      <li>Open <a href="https://fish.audio/app/api-keys" target="_blank" rel="noreferrer">API keys</a>, create a key (it starts with <code>sk-fish-</code>) and save it on Connections.</li>
      <li>Choose a female or male voice on the <Link href="/account">Account</Link> page. English and Urdu each get a native voice.</li>
    </ol>,
  },
  {
    id: "google", title: "4. Google: Gmail, Calendar, Drive, Search Console, YouTube, Analytics",
    body: <ol>
      <li>In <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud</a>, create a project.</li>
      <li>Enable the APIs you want: Gmail, Google Calendar, Google Drive, Google Search Console, YouTube Data, Google Analytics Data, Google Sheets.</li>
      <li>Set up the <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">OAuth consent screen</a> (External) and add yourself as a test user.</li>
      <li>Create an <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">OAuth client ID</a> of type <b>Web application</b>. Add the redirect URI shown on the Connections page.</li>
      <li>Paste the client ID and secret on Connections, press <b>Save</b>, then <b>Sign in with Google</b>.</li>
      <li>For Search Console, enter your property exactly as it appears in Search Console, e.g. <code>https://example.com/</code> or <code>sc-domain:example.com</code>.</li>
    </ol>,
  },
  {
    id: "email", title: "4b. Email from any provider",
    body: <>
      <p>Your assistant can read, search and draft replies in any inbox: Gmail, Outlook, Yahoo, iCloud, Zoho, AWS WorkMail, your web host or your company&apos;s server. It uses the standard IMAP (reading) and SMTP (sending) that every provider offers, and never sends anything until you approve the draft.</p>
      <ol>
        <li>On <Link href="/connections">Connections</Link>, under <b>Email (any provider)</b>, enter your email address and password, then press <b>Save</b>. The servers are found automatically and the connection is tested.</li>
        <li>If the test says the login was refused, your provider needs an <b>app password</b> (a separate password just for apps):
          <ul>
            <li><b>Gmail / Google Workspace:</b> turn on 2-Step Verification, then create one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>.</li>
            <li><b>Yahoo:</b> Account security → Generate app password.</li>
            <li><b>iCloud:</b> <a href="https://account.apple.com" target="_blank" rel="noreferrer">account.apple.com</a> → Sign-In and Security → App-Specific Passwords.</li>
            <li><b>Zoho:</b> My Account → Security → App passwords, and switch on IMAP in Zoho Mail settings.</li>
            <li><b>AWS WorkMail:</b> your normal WorkMail password works (or an app password if your organisation uses MFA). Servers are <code>imap.mail.&lt;region&gt;.awsapps.com</code> and <code>smtp.mail.&lt;region&gt;.awsapps.com</code>, which are found automatically from your domain.</li>
            <li><b>Outlook / Microsoft 365:</b> your administrator must allow IMAP and SMTP sign-in (&quot;authenticated SMTP&quot;) for the mailbox; use an app password if 2-step sign-in is on.</li>
          </ul>
        </li>
        <li>If the test says the server wasn&apos;t found, type your provider&apos;s IMAP and SMTP servers in the two optional boxes, like <code>mail.example.com:993</code> and <code>mail.example.com:465</code>. Your host lists them under &quot;email client settings&quot;.</li>
        <li>Ask: &quot;What&apos;s new in my inbox?&quot;, &quot;Find the invoice from Ahmed last week&quot;, &quot;Reply to that saying I&apos;ll call tomorrow&quot;. Replies appear as drafts for you to approve.</li>
      </ol>
    </>,
  },
  {
    id: "social", title: "5. Facebook, Instagram, X and TikTok",
    body: <ul>
      <li><b>Facebook & Instagram:</b> in <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Graph API Explorer</a>, get a long-lived Page access token, your Page ID and (for Instagram) your business account ID.</li>
      <li><b>X:</b> in the <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noreferrer">developer portal</a>, copy the bearer token; add a user access token to post.</li>
      <li><b>TikTok:</b> create an app at <a href="https://developers.tiktok.com/apps" target="_blank" rel="noreferrer">TikTok for Developers</a> and copy the client key, secret and a refresh token.</li>
    </ul>,
  },
  {
    id: "finance", title: "6. Finance agent: Stripe, PayPal and your bank",
    body: <>
      <p>The Finance agent reports your sales, refunds, fees, open invoices and balances. Every connection is <b>read-only</b> — it can never send or move money. Connect any of these on the <Link href="/connections">Connections</Link> page:</p>
      <p><b>Stripe (needed for Stripe sales and invoices)</b></p>
      <ol>
        <li>Open <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">Stripe → Developers → API keys</a> and press <b>Create restricted key</b>.</li>
        <li>Name it (e.g. &quot;{BRAND} Finance&quot;) and set these to <b>Read</b>: Charges, Invoices, Customers and Balance. Leave everything else as None.</li>
        <li>Create the key and copy it (it starts with <code>rk_live_</code>). Paste it under <b>Stripe (Finance agent)</b> on Connections and press <b>Save</b>.</li>
        <li>Ask: &quot;How much did I make this month?&quot; or &quot;Any unpaid invoices?&quot;</li>
      </ol>
      <p><b>PayPal</b></p>
      <ol>
        <li>In the <a href="https://developer.paypal.com/dashboard/applications/live" target="_blank" rel="noreferrer">PayPal developer dashboard</a> (Live), create a REST app.</li>
        <li>Under the app&apos;s features, switch on <b>Transaction search</b> (it can take a few hours to start working).</li>
        <li>Copy the <b>Client ID</b> and <b>Secret</b> into PayPal on Connections.</li>
      </ol>
      <p><b>Bank account (through Wise)</b></p>
      <ol>
        <li>In <a href="https://wise.com/settings/api-tokens" target="_blank" rel="noreferrer">Wise → Settings → API tokens</a>, create a token set to <b>Read only</b>.</li>
        <li>Paste it under Bank account on Connections. UK and EU accounts may ask you to approve statement access once in the Wise app.</li>
      </ol>
    </>,
  },
  {
    id: "claude-code", title: "7. Claude Code (the Developer agent)",
    body: <>
      <p>The Developer agent reads and works on code projects on your computer using <a href="https://docs.claude.com/en/docs/claude-code/overview" target="_blank" rel="noreferrer">Claude Code</a>, signed in with your own Claude Pro or Max plan.</p>
      <ol>
        <li>Install Node.js (step 1), then in a terminal run <code>npm install -g @anthropic-ai/claude-code</code>.</li>
        <li>Run <code>claude</code> once and log in with your Claude account.</li>
        <li>The Developer agent then works through the {BRAND} desktop app on that computer. Anything that changes files waits for your approval.</li>
      </ol>
    </>,
  },
  {
    id: "chatgpt", title: "8. ChatGPT Plus",
    body: <p>A ChatGPT Plus subscription is for chatting on chatgpt.com and doesn&apos;t include API access, so other apps — including {BRAND} — can&apos;t use it. {BRAND} runs on your Gemini key. Support for OpenAI API keys (billed separately at platform.openai.com) is on the roadmap.</p>,
  },
  {
    id: "computer", title: "9. Connecting your computer (Mac, Windows, Linux)",
    body: <>
      <p>The {BRAND} desktop app links a computer to your account so your assistant can open apps and websites, switch Chrome profiles, list what&apos;s open, set the volume and play or pause music. Quitting apps, restarting and scripts always wait for your approval. Nothing else needs to be installed.</p>
      <ol>
        <li>Download the app for your computer from the <Link href="/download">Download</Link> page.</li>
        <li>Install it and open it. The first time, Mac may ask you to right-click → Open, and Windows may show “Windows protected your PC” → More info → Run anyway.</li>
        <li>Sign in with your {BRAND} email and password. The computer shows as <b>online</b> on your <Link href="/account">Account</Link> page.</li>
        <li>It keeps running in the menu bar (Mac) or system tray (Windows, Linux) and starts when you log in.</li>
      </ol>
      <ul>
        <li><b>Mac:</b> the first time it controls an app, allow it under System Settings → Privacy &amp; Security → Automation.</li>
        <li><b>Windows:</b> volume and play/pause use the media keys, like your keyboard does.</li>
        <li><b>Linux:</b> uses <code>pactl</code> for volume, <code>playerctl</code> for music and <code>wmctrl</code> to list windows (e.g. <code>sudo apt install pulseaudio-utils wmctrl playerctl</code>).</li>
      </ul>
      <p>To unlink, choose <b>Sign out</b> in the app, or press <b>Unlink</b> on the Account page.</p>
    </>,
  },
];

export default function Docs() {
  return (
    <SiteShell>
      <section className="section" style={{ borderTop: "none", paddingTop: 24 }}>
        <div className="site-wrap">
          <p className="eyebrow">Setup guide</p>
          <h2>Connect everything in about ten minutes</h2>
          <p>Follow the steps you need — only Gemini is required. Everything you add is saved on the <Link href="/connections" style={{ color: "var(--accent)" }}>Connections</Link> page, encrypted, for your account only.</p>
          <nav className="card" style={{ marginBottom: 24, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
            {STEPS.map(s => <a key={s.id} href={`#${s.id}`} style={{ color: "var(--accent)" }}>{s.title}</a>)}
          </nav>
          <div className="docs" style={{ display: "grid", gap: 16 }}>
            {STEPS.map(s => <section key={s.id} id={s.id} className="card" style={{ lineHeight: 1.65 }}><h3 style={{ fontSize: 19, marginBottom: 10 }}>{s.title}</h3><div style={{ color: "var(--muted)" }}>{s.body}</div></section>)}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
