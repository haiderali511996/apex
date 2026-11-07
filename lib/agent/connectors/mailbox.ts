import { promises as dns } from "node:dns";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { cred } from "@/lib/credentials";

/**
 * Any email account in the world, over the standard protocols every provider
 * offers: IMAP to read and search, SMTP to send. The user enters their
 * address and password (usually an "app password"); the servers are found
 * automatically:
 *   1. known providers by domain (Gmail, Outlook, Yahoo, iCloud, Zoho, …),
 *   2. the domain's MX records (custom domains hosted by Google Workspace,
 *      Microsoft 365, Zoho, AWS WorkMail, Fastmail…),
 *   3. Mozilla's public ISP database (thousands of providers),
 *   4. imap.<domain> / smtp.<domain>.
 * Either server can be typed in instead ("host" or "host:port").
 * Sending only ever happens from an approved pending action.
 */

export type Server = { host: string; port: number; secure: boolean };
export type Servers = { imap: Server; smtp: Server; how: string };

const imap = (host: string, port = 993): Server => ({ host, port, secure: port === 993 });
const smtp = (host: string, port = 465): Server => ({ host, port, secure: port === 465 });

/** Providers by the domain of the address. */
const KNOWN: Record<string, () => Omit<Servers, "how">> = {
  "gmail.com": () => ({ imap: imap("imap.gmail.com"), smtp: smtp("smtp.gmail.com") }),
  "googlemail.com": () => ({ imap: imap("imap.gmail.com"), smtp: smtp("smtp.gmail.com") }),
  "outlook.com": () => ({ imap: imap("outlook.office365.com"), smtp: smtp("smtp-mail.outlook.com", 587) }),
  "hotmail.com": () => ({ imap: imap("outlook.office365.com"), smtp: smtp("smtp-mail.outlook.com", 587) }),
  "live.com": () => ({ imap: imap("outlook.office365.com"), smtp: smtp("smtp-mail.outlook.com", 587) }),
  "msn.com": () => ({ imap: imap("outlook.office365.com"), smtp: smtp("smtp-mail.outlook.com", 587) }),
  "yahoo.com": () => ({ imap: imap("imap.mail.yahoo.com"), smtp: smtp("smtp.mail.yahoo.com") }),
  "ymail.com": () => ({ imap: imap("imap.mail.yahoo.com"), smtp: smtp("smtp.mail.yahoo.com") }),
  "aol.com": () => ({ imap: imap("imap.aol.com"), smtp: smtp("smtp.aol.com") }),
  "icloud.com": () => ({ imap: imap("imap.mail.me.com"), smtp: smtp("smtp.mail.me.com", 587) }),
  "me.com": () => ({ imap: imap("imap.mail.me.com"), smtp: smtp("smtp.mail.me.com", 587) }),
  "mac.com": () => ({ imap: imap("imap.mail.me.com"), smtp: smtp("smtp.mail.me.com", 587) }),
  "zoho.com": () => ({ imap: imap("imap.zoho.com"), smtp: smtp("smtp.zoho.com") }),
  "zohomail.com": () => ({ imap: imap("imap.zoho.com"), smtp: smtp("smtp.zoho.com") }),
  "fastmail.com": () => ({ imap: imap("imap.fastmail.com"), smtp: smtp("smtp.fastmail.com") }),
  "gmx.com": () => ({ imap: imap("imap.gmx.com"), smtp: smtp("mail.gmx.com", 587) }),
  "gmx.net": () => ({ imap: imap("imap.gmx.net"), smtp: smtp("mail.gmx.net", 587) }),
  "mail.com": () => ({ imap: imap("imap.mail.com"), smtp: smtp("smtp.mail.com", 587) }),
  "yandex.com": () => ({ imap: imap("imap.yandex.com"), smtp: smtp("smtp.yandex.com") }),
  "yandex.ru": () => ({ imap: imap("imap.yandex.ru"), smtp: smtp("smtp.yandex.ru") }),
};

/** Custom domains, recognised by where their mail is delivered (MX). */
function byMx(mx: string): Omit<Servers, "how"> | null {
  const m = mx.toLowerCase();
  if (/google\.com$|googlemail\.com$/.test(m)) return { imap: imap("imap.gmail.com"), smtp: smtp("smtp.gmail.com") };
  if (/outlook\.com$|protection\.outlook\.com$/.test(m)) return { imap: imap("outlook.office365.com"), smtp: smtp("smtp.office365.com", 587) };
  const workmail = /inbound-smtp\.([a-z0-9-]+)\.amazonaws\.com$/.exec(m);
  if (workmail) return { imap: imap(`imap.mail.${workmail[1]}.awsapps.com`), smtp: smtp(`smtp.mail.${workmail[1]}.awsapps.com`) };
  if (/zoho\.(com|eu|in|com\.au)$/.test(m)) { const tld = m.split("zoho.")[1]; return { imap: imap(`imap.zoho.${tld}`), smtp: smtp(`smtp.zoho.${tld}`) }; }
  if (/messagingengine\.com$/.test(m)) return { imap: imap("imap.fastmail.com"), smtp: smtp("smtp.fastmail.com") };
  if (/yahoodns\.net$/.test(m)) return { imap: imap("imap.mail.yahoo.com"), smtp: smtp("smtp.mail.yahoo.com") };
  if (/icloud\.com$/.test(m)) return { imap: imap("imap.mail.me.com"), smtp: smtp("smtp.mail.me.com", 587) };
  if (/secureserver\.net$/.test(m)) return { imap: imap("imap.secureserver.net"), smtp: smtp("smtpout.secureserver.net") };
  if (/hostinger\.com$/.test(m)) return { imap: imap("imap.hostinger.com"), smtp: smtp("smtp.hostinger.com") };
  if (/ionos\.(com|de|co\.uk)$|1and1/.test(m)) return { imap: imap("imap.ionos.com"), smtp: smtp("smtp.ionos.com", 587) };
  if (/mail\.ovh\.net$|ovh\.net$/.test(m)) return { imap: imap("ssl0.ovh.net"), smtp: smtp("ssl0.ovh.net") };
  return null;
}

/** Mozilla's ISP database (what Thunderbird uses), for everything else. */
async function byAutoconfig(domain: string): Promise<Omit<Servers, "how"> | null> {
  for (const url of [`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, `https://autoconfig.${domain}/mail/config-v1.1.xml`]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const xml = await res.text();
      const pick = (type: string) => {
        const block = new RegExp(`<(incomingServer|outgoingServer) type="${type}">([\\s\\S]*?)</\\1>`).exec(xml)?.[2];
        if (!block) return null;
        const host = /<hostname>([^<]+)<\/hostname>/.exec(block)?.[1]?.replace("%EMAILDOMAIN%", domain);
        const port = Number(/<port>(\d+)<\/port>/.exec(block)?.[1]);
        const ssl = /<socketType>([^<]+)<\/socketType>/.exec(block)?.[1];
        return host && port ? { host, port, secure: ssl === "SSL" } : null;
      };
      const i = pick("imap"), s = pick("smtp");
      if (i && s) return { imap: i, smtp: s };
    } catch { /* try the next source */ }
  }
  return null;
}

/** "host" or "host:port" typed by the user. */
function typed(value: string | undefined, kind: "imap" | "smtp"): Server | null {
  const v = value?.trim();
  if (!v) return null;
  const [host, port] = v.split(":");
  return kind === "imap" ? imap(host, port ? Number(port) : 993) : smtp(host, port ? Number(port) : 465);
}

const found = new Map<string, Servers>();

export async function findServers(address: string, imapHost?: string, smtpHost?: string): Promise<Servers> {
  const key = `${address}|${imapHost ?? ""}|${smtpHost ?? ""}`;
  const cached = found.get(key);
  if (cached) return cached;
  const domain = address.split("@")[1]?.toLowerCase() ?? "";
  let auto: Omit<Servers, "how"> | null = null, how = "";
  if (KNOWN[domain]) { auto = KNOWN[domain](); how = "known provider"; }
  if (!auto && domain) {
    const mx = await dns.resolveMx(domain).then(r => r.sort((a, b) => a.priority - b.priority), () => []);
    for (const r of mx) { auto = byMx(r.exchange); if (auto) { how = `mail hosted at ${r.exchange}`; break; } }
  }
  if (!auto && domain) { auto = await byAutoconfig(domain); if (auto) how = "provider directory"; }
  if (!auto) { auto = { imap: imap(`imap.${domain}`), smtp: smtp(`smtp.${domain}`) }; how = "standard names (guessed)"; }
  const servers: Servers = { imap: typed(imapHost, "imap") ?? auto.imap, smtp: typed(smtpHost, "smtp") ?? auto.smtp, how: imapHost || smtpHost ? `${how}, with your server settings` : how };
  found.set(key, servers);
  return servers;
}

// ---------- The accounts ----------

/** One connected inbox. Stored encrypted as a list in EMAIL_ACCOUNTS. */
export type MailAccount = { address: string; password: string; imap?: string; smtp?: string };

/** Every inbox this account connected; the first single-inbox setup counts as one. */
export function listAccounts(): MailAccount[] {
  let list: MailAccount[] = [];
  try { list = JSON.parse(cred("EMAIL_ACCOUNTS") || "[]"); } catch { list = []; }
  const legacy = cred("EMAIL_ADDRESS")?.trim(), legacyPass = cred("EMAIL_PASSWORD");
  if (legacy && legacyPass && !list.some(a => a.address.toLowerCase() === legacy.toLowerCase())) {
    list.unshift({ address: legacy, password: legacyPass, imap: cred("EMAIL_IMAP_HOST") || undefined, smtp: cred("EMAIL_SMTP_HOST") || undefined });
  }
  return list.filter(a => a?.address && a?.password);
}

export function isConfigured() {
  return listAccounts().length > 0;
}

export function addresses(): string[] {
  return listAccounts().map(a => a.address);
}

/** The inbox named (by address, or a unique part like "info"), or the only one. */
export function pickAccount(wanted?: string): MailAccount {
  const all = listAccounts();
  if (!all.length) throw new Error("No email account is connected. Add one under Email on the Connections page.");
  const w = wanted?.trim().toLowerCase();
  if (!w) return all[0];
  const exact = all.find(a => a.address.toLowerCase() === w);
  if (exact) return exact;
  const partial = all.filter(a => a.address.toLowerCase().includes(w));
  if (partial.length === 1) return partial[0];
  throw new Error(`"${wanted}" isn't one of the connected inboxes: ${all.map(a => a.address).join(", ")}.`);
}

const serversOf = (a: MailAccount) => findServers(a.address, a.imap, a.smtp);

/** Login failures, in words someone can act on. */
function explain(err: unknown, server: Server, address: string): Error {
  const e = err as { authenticationFailed?: boolean; responseText?: string; code?: string; message?: string };
  const text = `${e.responseText ?? ""} ${e.message ?? ""}`;
  if (e.authenticationFailed || /auth|login|credentials|password|535|534/i.test(text)) {
    return new Error(`The email provider refused the login for ${address}. Most providers (Gmail, Yahoo, iCloud, Outlook, Zoho, WorkMail with MFA) need an "app password" here, not your normal password, and IMAP switched on in the mailbox settings.`);
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(text) || e.code === "ENOTFOUND") return new Error(`The mail server ${server.host} doesn't exist. Type your provider's IMAP/SMTP server on the Connections page.`);
  if (/ETIMEDOUT|ECONNREFUSED|timeout/i.test(text)) return new Error(`Couldn't reach ${server.host}:${server.port}. Check the server and port on the Connections page.`);
  return new Error(`Email error for ${address}: ${(e.responseText || e.message || String(err)).slice(0, 200)}`);
}

async function withInbox<T>(acct: MailAccount, work: (client: ImapFlow) => Promise<T>, folder = "INBOX"): Promise<T> {
  const { imap: server } = await serversOf(acct);
  const client = new ImapFlow({ host: server.host, port: server.port, secure: server.secure, auth: { user: acct.address, pass: acct.password }, logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000 });
  try { await client.connect(); } catch (err) { throw explain(err, server, acct.address); }
  try {
    const lock = await client.getMailboxLock(folder);
    try { return await work(client); } finally { lock.release(); }
  } finally {
    await client.logout().catch(() => {});
  }
}

type Summary = { uid: number; from: string; subject: string; date: string; unread: boolean; snippet: string };

async function summarize(client: ImapFlow, uids: number[]): Promise<Summary[]> {
  if (!uids.length) return [];
  const out: Summary[] = [];
  for await (const m of client.fetch(uids.join(","), { uid: true, envelope: true, flags: true, source: { maxLength: 24_000 } }, { uid: true })) {
    const from = m.envelope?.from?.[0];
    let snippet = "";
    if (m.source) {
      const parsed = await simpleParser(m.source).catch(() => null);
      snippet = (parsed?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    }
    out.push({
      uid: m.uid,
      from: from ? `${from.name ? `${from.name} ` : ""}<${from.address}>` : "unknown",
      subject: m.envelope?.subject || "(no subject)",
      date: (m.envelope?.date ? new Date(m.envelope.date) : new Date()).toISOString().slice(0, 16).replace("T", " "),
      unread: !m.flags?.has("\\Seen"),
      snippet,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const list = (items: Summary[]) => items.map(m => `• [id ${m.uid}] ${m.date} — ${m.from} — "${m.subject}"${m.unread ? " (unread)" : ""}${m.snippet ? `\n  ${m.snippet}` : ""}`).join("\n");

/** Unread mail first; the latest messages if nothing is unread. Reading never marks anything as read. */
export async function getInbox(acct: MailAccount, max = 10): Promise<string> {
  return withInbox(acct, async client => {
    const unread = (await client.search({ seen: false }, { uid: true })) || [];
    const uids = (unread.length ? unread : ((await client.search({ all: true }, { uid: true })) || [])).slice(-max);
    const items = await summarize(client, uids);
    if (!items.length) return `${acct.address}: the inbox is empty.`;
    return `${acct.address} — ${unread.length ? `${unread.length} unread, newest ${items.length}` : `no unread mail; latest ${items.length}`}:\n${list(items)}`;
  });
}

/**
 * Searches with simple words plus optional from:, to:, subject: and
 * newer_than:7d / older_than:30d, like Gmail's syntax, on any server.
 */
export async function searchMail(acct: MailAccount, query: string, max = 10): Promise<string> {
  const criteria: Record<string, unknown> = {};
  let rest = query;
  rest = rest.replace(/\b(from|to|subject):("[^"]+"|\S+)/gi, (_, k: string, v: string) => { criteria[k.toLowerCase()] = v.replace(/"/g, ""); return ""; });
  rest = rest.replace(/\b(newer_than|older_than):(\d+)([dmy])/gi, (_, k: string, n: string, u: string) => {
    const days = Number(n) * (u === "y" ? 365 : u === "m" ? 30 : 1);
    criteria[k.toLowerCase() === "newer_than" ? "since" : "before"] = new Date(Date.now() - days * 86_400_000);
    return "";
  });
  rest = rest.replace(/\bis:unread\b/gi, () => { criteria.seen = false; return ""; }).trim();
  if (rest) criteria.text = rest;
  if (!Object.keys(criteria).length) criteria.all = true;
  return withInbox(acct, async client => {
    const uids = ((await client.search(criteria, { uid: true })) || []).slice(-max);
    const items = await summarize(client, uids);
    return items.length ? `${items.length} message(s) in ${acct.address} for "${query}":\n${list(items)}` : `Nothing in ${acct.address} matches "${query}".`;
  });
}

/** One whole message by its id from that inbox's list or search. */
export async function readMail(acct: MailAccount, uid: number): Promise<string> {
  return withInbox(acct, async client => {
    const m = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
    if (!m || !m.source) return `There's no message with id ${uid} in ${acct.address}.`;
    const p = await simpleParser(m.source);
    const attachments = p.attachments.map(a => `${a.filename ?? "attachment"} (${Math.round(a.size / 1024)} KB)`);
    const from = p.from?.text ?? "unknown";
    return [`Inbox: ${acct.address}`, `From: ${from}`, `To: ${(Array.isArray(p.to) ? p.to.map(t => t.text).join(", ") : p.to?.text) ?? ""}`, `Date: ${p.date?.toISOString().slice(0, 16).replace("T", " ") ?? ""}`, `Subject: ${p.subject ?? ""}`, p.messageId ? `Message-ID: ${p.messageId}` : "", attachments.length ? `Attachments: ${attachments.join(", ")}` : "", "", (p.text ?? "").trim().slice(0, 6000)].filter(l => l !== "").join("\n");
  });
}

/** Sends from one connected inbox. Only called for a draft the user approved. */
export async function sendMail(payload: { from?: string; to: string; subject: string; body: string; inReplyTo?: string }): Promise<string> {
  const acct = pickAccount(payload.from);
  const { smtp: server } = await serversOf(acct);
  const mail = { from: acct.address, to: payload.to, subject: payload.subject, text: payload.body, ...(payload.inReplyTo ? { inReplyTo: payload.inReplyTo, references: payload.inReplyTo } : {}) };
  const transport = nodemailer.createTransport({ host: server.host, port: server.port, secure: server.secure, auth: { user: acct.address, pass: acct.password }, connectionTimeout: 15_000 });
  try { await transport.sendMail(mail); } catch (err) { throw explain(err, server, acct.address); }
  // Most providers file sent mail only when it's sent from their own app, so a copy goes into the Sent folder.
  try {
    const raw = await new MailComposer({ ...mail, date: new Date() }).compile().build();
    await withInbox(acct, async client => {
      const sent = (await client.list()).find(f => f.specialUse === "\\Sent");
      if (sent) await client.append(sent.path, raw, ["\\Seen"]);
    });
  } catch { /* the email itself was sent */ }
  return `Sent from ${acct.address} to ${payload.to}: "${payload.subject}".`;
}

/** Logs in to both servers; used before an inbox is saved, and by the Test button. */
export async function testAccount(acct: MailAccount): Promise<string> {
  const s = await serversOf(acct);
  await withInbox(acct, async () => {});
  const transport = nodemailer.createTransport({ host: s.smtp.host, port: s.smtp.port, secure: s.smtp.secure, auth: { user: acct.address, pass: acct.password }, connectionTimeout: 15_000 });
  try { await transport.verify(); } catch (err) { throw explain(err, s.smtp, acct.address); }
  return `Connected: ${acct.address} reads from ${s.imap.host}:${s.imap.port} and sends through ${s.smtp.host}:${s.smtp.port} (${s.how}).`;
}

/** Tests every connected inbox. */
export async function testMailbox(): Promise<string> {
  const results = await Promise.all(listAccounts().map(a => testAccount(a).catch(err => `${a.address}: ${err instanceof Error ? err.message : err}`)));
  return results.join("\n");
}

/** For the prompt, so the assistant knows which inboxes exist. */
export function emailBrief(): string {
  const all = addresses();
  return all.length ? `\n\nConnected email inboxes: ${all.join(", ")}. get_inbox and search_email check all of them unless one is named; reply from the inbox the email came to.` : "";
}
