import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import Pricing from "@/components/site/Pricing";
import AgentsGrid from "@/components/site/AgentsGrid";
import { BRAND, FACES } from "@/lib/persona";
import { TRIAL_DAYS } from "@/lib/plans";
import { currentUser } from "@/lib/auth";
import { pageMeta } from "@/lib/seo";

export const metadata = { ...pageMeta("AI Assistant | UNC — a voice assistant that talks in any language", "Talk to your own AI assistant in English, Urdu or any language. It runs your Gmail, Calendar, Search Console, socials and computer — and asks before it acts. By the UNC Team.", "/welcome"), title: { absolute: "AI Assistant | UNC — a voice assistant that talks in any language" } };

const FEATURES = [
  { title: "Talk in any language", body: "English, Urdu, Arabic, or a mix in one sentence. It understands you and answers the way you spoke — Urdu in Roman letters on screen, with a native accent out loud." },
  { title: "Your name, face and voice", body: "Call it Sarah, Adam or anything you like. Pick a female or male hologram face and voice. Say “Hey <name>” and it listens." },
  { title: "Runs your computer", body: "Open apps, open a site in the right Chrome profile, find a tab, set the volume — on Mac today, with Windows and Linux coming through the desktop app." },
  { title: "Reads your accounts", body: "Search Console, Gmail, Calendar, Drive, YouTube, Facebook, Instagram, X and TikTok — briefings in plain words, with one next step." },
  { title: "Asks before it acts", body: "Posts, emails, quitting apps and restarts are drafted for your approval. Nothing irreversible happens until you say yes." },
  { title: "Your keys, your data", body: "Connect your own Gemini and Fish Audio keys and your own accounts. Each account's keys are encrypted and never shared." },
];

const FAQ = [
  { q: "What do I need to get started?", a: `Just an account and a free Gemini API key from Google AI Studio — it takes about two minutes. Add a Fish Audio key for the natural female or male voice; without it, your computer's own voice is used. Every plan starts with a ${TRIAL_DAYS}-day free trial, no card needed.` },
  { q: "Which languages does it understand?", a: "English, Urdu, Arabic, Hindi and 100+ more — even mixed in one sentence. On screen, Urdu is written in Roman letters; out loud, it's spoken by a native Urdu voice." },
  { q: "Can it control my computer — Mac, Windows and Linux?", a: "Yes. Link a computer from your Account page with the small desktop app (it needs Node.js). Your assistant can then open apps and websites, switch Chrome profiles, list what's open, set the volume and play or pause music. Quitting apps, restarting and scripts always wait for your approval." },
  { q: "Can I change my assistant's name, face and voice?", a: "Any time, on the Account page. Pick any name — it becomes the wake word, so “Hey Adam” works if you call it Adam — and choose a female or male hologram face and voice." },
  { q: "Whose API keys does it use?", a: "Yours. You connect your own Gemini, Fish Audio, Google and social accounts on the Connections page, so you only pay providers for what you use and your data stays in your own accounts. Keys are encrypted and never shared with anyone else." },
  { q: "How do I pay — card or UNC?", a: "Choose a plan on your Account page. Pay by card through Stripe's secure checkout, or with UNC from your crypto wallet or an exchange. Each UNC order has its own exact amount, so your payment is matched to you automatically once the blockchain confirms it." },
  { q: "What happens when I reach my voice minutes?", a: "Typing keeps working, and the voice falls back to your computer's own until the next month. You can see your usage on the Account page and upgrade at any time." },
  { q: "Is my data safe, and can I delete it?", a: "Passwords are hashed, keys are encrypted, and anything that posts, sends or changes something waits for your approval. You can delete your account and all its data from the Account page whenever you like." },
];

export default async function Welcome() {
  const signedIn = !!(await currentUser());
  return (
    <SiteShell>
      <div className="site-wrap">
        <section className="hero">
          <div>
            <p className="eyebrow">Voice-first AI assistant</p>
            <h1>An assistant with <em>your</em> name, face and voice — that actually does the work.</h1>
            <p className="lede">{BRAND} listens in any language, briefs you on your accounts, opens what you need on your computer, and drafts the rest for your approval.</p>
            <div className="hero-actions">
              {signedIn
                ? <Link href="/" className="btn btn-primary">Open your assistant</Link>
                : <Link href="/signup" className="btn btn-primary">Start your {TRIAL_DAYS}-day free trial</Link>}
              <Link href="/pricing" className="btn btn-ghost">See pricing</Link>
            </div>
            <p className="hero-note">No card needed for the trial. Pay later by card or with UNC.</p>
          </div>
          <div className="hero-faces">
            {(["female", "male"] as const).map(f => (
              <div className="face-card" key={f} role="img" aria-label={`${FACES[f].label} hologram face`} style={{ backgroundImage: `url(${FACES[f].art})` }}>
                <span>{FACES[f].label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="section" id="features">
        <div className="site-wrap">
          <h2>Everything a chief of staff does — by voice</h2>
          <p>One assistant for your conversations, your accounts and your computer.</p>
          <div className="grid3">{FEATURES.map(f => <div className="card" key={f.title}><h3>{f.title}</h3><p>{f.body}</p></div>)}</div>
        </div>
      </section>

      <section className="section" id="agents">
        <div className="site-wrap">
          <h2>A whole team of agents behind one voice</h2>
          <p>Ask your assistant anything — it routes the work to the right specialist and brings back one clear answer.</p>
          <AgentsGrid />
        </div>
      </section>

      <section className="section">
        <div className="site-wrap">
          <h2>Ready in three steps</h2>
          <p>Most people are talking to their assistant within five minutes.</p>
          <div className="grid3 steps">
            <div className="card"><h3>Create your account</h3><p>Sign up and name your assistant. Pick its face and voice.</p></div>
            <div className="card"><h3>Connect your keys</h3><p>Paste your Gemini key, add Fish Audio for natural voices, and connect Google and your socials when you want them.</p></div>
            <div className="card"><h3>Say “Hey {"<name>"}”</h3><p>Ask for a briefing, open a site, draft a post — in English, Urdu or any language.</p></div>
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="site-wrap">
          <h2>Simple pricing</h2>
          <p>Pick a plan when your trial ends. Pay monthly, by card or with UNC.</p>
          <Pricing signedIn={signedIn} />
        </div>
      </section>

      <section className="section" id="faq">
        <div className="site-wrap faq-layout">
          <div className="faq-intro">
            <p className="eyebrow">FAQ</p>
            <h2>Questions, answered</h2>
            <p>Everything you need to know before you start. Can&apos;t find your answer?</p>
            <div className="faq-help">
              <Link href="/docs" className="btn btn-ghost btn-small">Read the setup guide</Link>
              <Link href="/community" className="btn btn-ghost btn-small">Ask the community</Link>
            </div>
          </div>
          <div className="faq">
            {FAQ.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary><span>{f.q}</span><i aria-hidden="true" /></summary>
                <div className="faq-answer"><p>{f.a}</p></div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
