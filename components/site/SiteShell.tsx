import Link from "next/link";
import Image from "next/image";
import { BRAND, COMPANY, ECOSYSTEM } from "@/lib/persona";
import LogoutButton from "./LogoutButton";
import { currentUser } from "@/lib/auth";
import "./site.css";

/** Header and footer shared by the marketing, pricing and sign-in pages. */
export default async function SiteShell({ children }: { children: React.ReactNode }) {
  // Signed in: the header offers the app, the account and logging out instead.
  const user = await currentUser();
  return (
    <div className="site">
      <div className="site-wrap">
        <nav className="site-nav">
          <Link href="/welcome" className="site-brand" aria-label={`${BRAND} — built by the UNC team`}>
            <Image src="/brand/unc-logo.svg" alt="" width={44} height={44} />
            <span className="site-brand-copy"><strong>{BRAND}<b>.</b></strong><small>Built by the UNC team</small></span>
          </Link>
          <div className="site-links">
            <Link href="/welcome#features" className="hide-sm">Features</Link>
            <Link href="/welcome#agents" className="hide-sm">Agents</Link>
            <Link href="/community" className="hide-sm">Community</Link>
            <Link href="/docs" className="hide-sm">Docs</Link>
            <Link href="/download" className="hide-sm">Download</Link>
            <Link href="/pricing">Pricing</Link>
            {user ? <>
              <Link href="/account">Account</Link>
              <LogoutButton />
              <Link href="/" className="btn btn-primary btn-small">Assistant</Link>
            </> : <>
              <Link href="/login">Log in</Link>
              <Link href="/signup" className="btn btn-primary btn-small">Start free</Link>
            </>}
          </div>
        </nav>
      </div>
      {children}
      <div className="site-wrap">
        <footer className="site-footer">
          <span>© {new Date().getFullYear()} {COMPANY}. {BRAND} is part of the {ECOSYSTEM}.</span>
          <span style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <Link href="/docs">Setup guide</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Use</Link>
            <span>Pay with UNC</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
