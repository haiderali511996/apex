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
    id: "social", title: "5. Facebook, Instagram, X, TikTok, Stripe, PayPal and your bank",
    body: <ul>
      <li><b>Facebook & Instagram:</b> in <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Graph API Explorer</a>, get a long-lived Page access token, your Page ID and (for Instagram) your business account ID.</li>
      <li><b>X:</b> in the <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noreferrer">developer portal</a>, copy the bearer token; add a user access token to post.</li>
      <li><b>TikTok:</b> create an app at <a href="https://developers.tiktok.com/apps" target="_blank" rel="noreferrer">TikTok for Developers</a> and copy the client key, secret and a refresh token.</li>
      <li><b>Stripe:</b> create a <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">restricted, read-only key</a> for the Finance agent.</li>
      <li><b>PayPal:</b> in the <a href="https://developer.paypal.com/dashboard/applications/live" target="_blank" rel="noreferrer">PayPal developer dashboard</a>, create a REST app, switch on <b>Transaction search</b>, and copy its Live client ID and secret.</li>
      <li><b>Bank account (Wise):</b> in <a href="https://wise.com/settings/api-tokens" target="_blank" rel="noreferrer">Wise → Settings → API tokens</a>, create a token set to <b>Read only</b>. UK and EU accounts may ask you to approve statement access in the Wise app once.</li>
    </ul>,
  },
  {
    id: "claude-code", title: "6. Claude Code (the Developer agent)",
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
    id: "chatgpt", title: "7. ChatGPT Plus",
    body: <p>A ChatGPT Plus subscription is for chatting on chatgpt.com and doesn&apos;t include API access, so other apps — including {BRAND} — can&apos;t use it. {BRAND} runs on your Gemini key. Support for OpenAI API keys (billed separately at platform.openai.com) is on the roadmap.</p>,
  },
  {
    id: "computer", title: "8. Connecting your computer (Mac, Windows, Linux)",
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
