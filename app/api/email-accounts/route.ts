import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enterUser, saveCredentials } from "@/lib/credentials";
import { findServers, listAccounts, testAccount, type MailAccount } from "@/lib/agent/connectors/mailbox";

export const runtime = "nodejs";

const MAX_INBOXES = 20;

/** Saves the list and retires the first single-inbox keys, which the list now includes. */
function store(userId: string, list: MailAccount[]) {
  saveCredentials(userId, { EMAIL_ACCOUNTS: list.length ? JSON.stringify(list) : "", EMAIL_ADDRESS: "", EMAIL_PASSWORD: "", EMAIL_IMAP_HOST: "", EMAIL_SMTP_HOST: "" });
}

async function view() {
  return Promise.all(listAccounts().map(async a => {
    const s = await findServers(a.address, a.imap, a.smtp).catch(() => null);
    return { address: a.address, imap: s ? `${s.imap.host}:${s.imap.port}` : a.imap ?? "", smtp: s ? `${s.smtp.host}:${s.smtp.port}` : a.smtp ?? "" };
  }));
}

/** The connected inboxes (never their passwords). */
export async function GET() {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  return NextResponse.json({ accounts: await view() });
}

/** Adds an inbox (or updates its password/servers) after a successful login test. */
export async function POST(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  const body = (await req.json().catch(() => ({}))) as { address?: string; password?: string; imap?: string; smtp?: string };
  const address = body.address?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!body.password) return NextResponse.json({ error: "Enter the password (or app password)." }, { status: 400 });
  const acct: MailAccount = { address, password: body.password, imap: body.imap?.trim() || undefined, smtp: body.smtp?.trim() || undefined };
  const others = listAccounts().filter(a => a.address.toLowerCase() !== address);
  if (others.length >= MAX_INBOXES) return NextResponse.json({ error: `Up to ${MAX_INBOXES} inboxes can be connected.` }, { status: 400 });
  let message: string;
  try { message = await testAccount(acct); }
  catch (err) { return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't connect." }, { status: 400 }); }
  store(guard.user.id, [...others, acct]);
  return NextResponse.json({ message, accounts: await view() });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireUser();
  if ("response" in guard) return guard.response;
  enterUser(guard.user.id, guard.user.role === "owner");
  const address = req.nextUrl.searchParams.get("address")?.toLowerCase() ?? "";
  store(guard.user.id, listAccounts().filter(a => a.address.toLowerCase() !== address));
  return NextResponse.json({ accounts: await view() });
}
