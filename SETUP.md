# Setting up Apex, the talking agent

`/agent` is a chat (and voice) interface where Apex can report on your SEO
and social accounts and draft posts for you to approve. It's read-only and
inert until you supply credentials — nothing here works out of the box.

Copy `.env.local.example` to `.env.local` and fill in whichever platforms
you want live. Anything left blank just shows as "not configured" — the
rest keep working.

**Where to run this**: the TikTok connector persists rotated refresh tokens
to `data/agent-state.json`, and the pending-action queue lives there too.
That means this needs to run as a normal always-on Node process (a VPS,
Docker container, `next start` on a machine you control) — not a stateless
serverless platform that wipes the filesystem between requests.

## 1. Claude (required)

The chat itself is powered by the Claude API.

1. Get a key at https://console.anthropic.com/settings/keys.
2. Set `ANTHROPIC_API_KEY`.

## 2. Google — Search Console, YouTube, Gmail, Calendar, Drive, Sheets, Analytics

All seven share **one** OAuth app and **one** refresh token.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, then enable: **Search Console API**, **YouTube Data API v3**,
   **Gmail API**, **Google Calendar API**, **Google Drive API**,
   **Google Sheets API**, and **Google Analytics Data API**.
2. Under **APIs & Services → Credentials**, create an **OAuth client ID**
   (type: Web application). Add `https://developers.google.com/oauthplayground`
   as an authorized redirect URI (easiest way to mint a refresh token below).
3. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from that client.
4. Get a refresh token: go to the
   [OAuth Playground](https://developers.google.com/oauthplayground), click
   the gear icon, check "Use your own OAuth credentials", paste your client
   ID/secret, then authorize **all** of these scopes at once:

   ```
   https://www.googleapis.com/auth/webmasters.readonly
   https://www.googleapis.com/auth/youtube.readonly
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/drive.metadata.readonly
   https://www.googleapis.com/auth/spreadsheets
   https://www.googleapis.com/auth/analytics.readonly
   ```

   Exchange the auth code for tokens and copy the **refresh token** into
   `GOOGLE_REFRESH_TOKEN`. (Authorize everything in one pass — a second
   authorization for a different scope set replaces the first token.)
5. `GSC_SITE_URL`: the exact property string as it appears in Search
   Console (`https://example.com/` or `sc-domain:example.com`).
6. `YOUTUBE_CHANNEL_ID`: YouTube Studio → Settings → Channel → Advanced.
7. `GA4_PROPERTY_ID`: GA4 Admin → Property Settings → the numeric property ID.
8. `CRM_SHEET_ID`: from your sheet's URL,
   `docs.google.com/spreadsheets/d/THIS_PART/edit`. Put column headers in
   row 1 — include at least **Name** and **Stage** (plus whatever else you
   track: Company, Email, Value, Notes). Set `CRM_SHEET_NAME` if your tab
   isn't called `Sheet1`.

While your Cloud project is in "Testing" mode, refresh tokens expire after
7 days. Add yourself as a test user and, once you're relying on this daily,
publish the app (or accept re-authorizing weekly).

## 2b. Stripe (finance)

1. In the [Stripe Dashboard](https://dashboard.stripe.com/apikeys), create a
   **restricted key** with *read* access to Charges and Invoices.
2. Set `STRIPE_SECRET_KEY`. The agent never writes to Stripe — a read-only
   key is deliberate, so a mistake here can't move money.

## 3. Meta — Facebook Page + Instagram

1. Create an app at https://developers.facebook.com/apps.
2. Add the **Facebook Login** and **Instagram Graph API** products.
3. Use [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
   to generate a **Page access token** with `pages_read_engagement`,
   `pages_manage_posts`, and (for Instagram) `instagram_basic`,
   `instagram_content_publish`. For anything beyond your own account in
   Development mode, Meta requires App Review before the token works for
   real — expect that to take a few days.
4. Set `META_PAGE_ID` (Page settings → About) and
   `META_PAGE_ACCESS_TOKEN`.
5. If you also want Instagram: connect your Instagram Business account to
   the Page, then set `META_IG_USER_ID` (Graph API Explorer:
   `GET /{page-id}?fields=instagram_business_account`).

Page access tokens from the Explorer are short-lived — exchange for a
long-lived token (60 days) via the
[token debugger](https://developers.facebook.com/tools/debug/accesstoken/)
before relying on this in production, and plan to rotate it.

## 4. X (Twitter)

1. Create a project/app at https://developer.twitter.com/en/portal/dashboard
   (requires an approved developer account).
2. `X_BEARER_TOKEN`: the app-only bearer token from the app's "Keys and
   tokens" tab — enough for read-only stats.
3. `X_USERNAME`: your handle, no `@`.
4. To let Apex actually post, you need a **user-context OAuth2 access
   token** with the `tweet.write` scope — the bearer token above is
   app-only and cannot post on your behalf. Set up OAuth2 with PKCE for
   your app and complete the authorization-code flow once to get
   `X_ACCESS_TOKEN`. (This token expires; a refresh-token flow isn't wired
   up yet — re-run the authorization when it does.)

## 5. TikTok

1. Register an app at https://developers.tiktok.com/ and request the
   **Login Kit** and **Content Posting API** products.
2. Set `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
3. Complete the OAuth2 authorization-code flow once (TikTok's docs walk
   through the redirect + code exchange) to get an initial refresh token,
   and set `TIKTOK_REFRESH_TOKEN`. After the first API call, the app
   persists TikTok's rotated tokens to `data/agent-state.json` itself —
   you only need to seed this once.
4. Note: TikTok requires app review before `video.publish` can post
   publicly. Until then, posts made through Apex land as private
   (`SELF_ONLY`) drafts on your account instead of going live.

## What each node in the graph maps to

| Node | Backed by |
|------|-----------|
| Chief of staff, Strategist, Researcher, Editor, Sales, Marketing, Ops, Engineering, Design, Developer | Claude specialists (`lib/agent/roles.ts`) — no account needed |
| Memory | Durable facts stored in `data/agent-state.json` |
| Social | Facebook, Instagram, X, TikTok |
| Finance | Stripe |
| Analytics | Google Analytics (GA4) |
| CRM | Your Google Sheet pipeline |
| Email / Calendar / Drive | Gmail, Google Calendar, Google Drive |

## Safety model

Anything **visible to other people or hard to undo** is approval-gated. The
`propose_*` tools (`propose_facebook_post`, `propose_instagram_post`,
`propose_tweet`, `propose_tiktok_post`, `propose_email`,
`propose_calendar_event`) only queue a draft — they cannot publish, send,
or schedule anything by themselves. You approve or reject each one in the
`/agent` UI, and only your approval triggers the real API call.

The exceptions are deliberate: reading data, and adding or updating a row
in your own private CRM sheet, run immediately. Those are reversible and
nobody else sees them.

Stripe is wired read-only. The agent can tell you what you earned; it
cannot issue a refund or move money.
