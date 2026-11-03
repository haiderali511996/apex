# Google OAuth verification

Needed only if you want **one shared "Sign in with Google"** for all customers.
Today each customer connects with their **own** Google OAuth client (Connections
page), which needs no verification from you.

Only the owner of the Google Cloud project can submit this — in
**Google Cloud console → APIs & Services → OAuth consent screen → Publish app**.

## What's already in place

| Google asks for | Where |
|---|---|
| Homepage | `https://<your domain>/welcome` |
| Privacy Policy (with the Limited Use statement) | `https://<your domain>/privacy` |
| Terms of Service | `https://<your domain>/terms` |
| App name and support email | Set in the consent screen; use the UNC Team's address |
| Authorized domain | Your domain, verified in Google Search Console |

## Scopes the app requests (`lib/agent/googleOAuth.ts`)

Google shows each scope's class when you add it to the consent screen; expect:

| Scope | Class | Why the app needs it (paste into the form) |
|---|---|---|
| `gmail.readonly` | Restricted | Reads the user's inbox when they ask for a summary or search ("any email from my accountant?"). |
| `gmail.send` | Restricted | Sends an email the user dictated, **only after they approve the draft** in the app. |
| `drive.metadata.readonly` | Restricted | Finds files by name when the user asks ("open the Q3 deck"). File contents aren't read. |
| `calendar` | Sensitive | Reads the day's schedule and creates events the user approves. |
| `spreadsheets` | Sensitive | Reads and updates the user's own CRM sheet when they ask. |
| `webmasters.readonly` | Sensitive | Search Console clicks, impressions and queries for the user's own site. |
| `youtube.readonly` | Sensitive | The user's own channel statistics. |
| `analytics.readonly` | Sensitive | The user's own Google Analytics 4 traffic. |

## What it involves

- **Sensitive scopes:** a review of the consent screen and a short **demo video**
  (unlisted YouTube) that shows the consent screen with the app name and the
  OAuth client ID, then each scope being used in the app. Usually a few weeks.
- **Restricted scopes (Gmail, Drive):** additionally a **security assessment by a
  Google-approved lab** (CASA), paid by you and renewed every year.

## Suggested path

1. Launch with **sensitive scopes only** (Calendar, Sheets, Search Console,
   YouTube, Analytics) — no paid assessment.
2. Keep Gmail and Drive on the customer's own OAuth client until the business
   justifies the yearly assessment, then add them.
3. Customers using their own client: in their Google Cloud project, move the
   consent screen from **Testing** to **In production**. In Testing, Google
   expires sign-ins after 7 days; in production (unverified, for their own use)
   they last.

## Checklist before submitting

- [ ] App deployed on your domain with HTTPS (see `DEPLOY.md`)
- [ ] Domain verified in Search Console, added as an authorized domain
- [ ] Consent screen: app name, logo, support email, homepage, privacy and terms links
- [ ] Redirect URI `https://<your domain>/api/google/callback` on the OAuth client
- [ ] Demo video recorded
- [ ] Scope justifications pasted from the table above
