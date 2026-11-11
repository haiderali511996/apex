import Link from "next/link";
import SiteShell from "@/components/site/SiteShell";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta("Download the desktop app", "Download the UNC Assistant desktop app for Mac, Windows and Linux. Sign in with your account and your assistant can open apps and sites, switch Chrome profiles, set the volume and more.", "/download");

// Installers are served by the web server from /downloads/app/ (see DEPLOY.md).
const APPS = [
  {
    os: "Mac", file: "UNC-Assistant-mac.dmg", size: "228 MB", note: "macOS 12 or newer · Apple Silicon and Intel",
    steps: ["Open the .dmg and drag UNC Assistant into Applications.", "The first time, right-click the app → Open → Open. (If macOS still blocks it: System Settings → Privacy & Security → Open Anyway.)", "Sign in. It lives in the menu bar at the top of the screen."],
  },
  {
    os: "Windows", file: "UNC-Assistant-Setup-windows.exe", size: "123 MB", note: "Windows 10 or 11 · 64-bit",
    steps: ["Run the installer.", "If Windows shows “Windows protected your PC”, press More info → Run anyway.", "Sign in. It lives in the system tray, next to the clock."],
  },
  {
    os: "Linux", file: "UNC-Assistant-linux.AppImage", size: "128 MB", note: "64-bit · Ubuntu, Debian, Fedora and most others",
    steps: ["Make it runnable: chmod +x UNC-Assistant-linux.AppImage", "Double-click it (or run ./UNC-Assistant-linux.AppImage).", "Sign in. It lives in the system tray. For volume and music: sudo apt install pulseaudio-utils playerctl wmctrl"],
  },
];

export default function Download() {
  return (
    <SiteShell>
      <section className="section" style={{ borderTop: "none", paddingTop: 24 }}>
        <div className="site-wrap">
          <p className="eyebrow">Desktop app</p>
          <h2>Let your assistant use your computer</h2>
          <p>Install the app, sign in with your account, and your assistant can open apps and websites, switch Chrome profiles, list what&apos;s open, set the volume and play or pause music. Quitting apps, restarting and scripts always wait for your approval. Nothing else to install.</p>
          <div className="grid3" style={{ marginTop: 24 }}>
            {APPS.map(a => (
              <div className="card" key={a.os} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <h3 style={{ fontSize: 20 }}>{a.os}</h3>
                <p style={{ margin: 0 }}>{a.note}</p>
                <a className="btn btn-primary" href={`/downloads/app/${a.file}`} download>Download for {a.os} · {a.size}</a>
                <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7, color: "var(--muted)", fontSize: 14 }}>{a.steps.map(s => <li key={s}>{s}</li>)}</ol>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 20, lineHeight: 1.7 }}>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>Optional tools</h3>
            <p style={{ margin: 0 }}>The app needs nothing else. If you want the Developer agent (Claude Code), install <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Node.js</a>; for the helper scripts, install <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Python</a>. Both pages pick the right installer for your computer, and the app shows a download link if either is missing.</p>
          </div>
          <p style={{ marginTop: 20, fontSize: 14 }}>Unlink a computer any time from your <Link href="/account" style={{ color: "var(--accent)" }}>Account</Link> page, or choose Sign out in the app. <Link href="/docs#computer" style={{ color: "var(--accent)" }}>Setup guide</Link></p>
        </div>
      </section>
    </SiteShell>
  );
}
