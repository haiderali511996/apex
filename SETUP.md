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

## 2. Google — Search Console + YouTube

Both share one OAuth app.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a
   project, then enable the **Search Console API** and **YouTube Data API v3**.
2. Under **APIs & Services → Credentials**, create an **OAuth client ID**
   (type: Web application). Add `https://developers.google.com/oauthplayground`
   as an authorized redirect URI (easiest way to mint a refresh token below).
3. Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from that client.
4. Get a refresh token: go to the
   [OAuth Playground](https://developers.google.com/oauthplayground), click
   the gear icon, check "Use your own OAuth credentials", paste your client
   ID/secret, then authorize scopes
   `https://www.googleapis.com/auth/webmasters.readonly` and
   `https://www.googleapis.com/auth/youtube.readonly`. Exchange the auth
   code for tokens and copy the **refresh token** into `GOOGLE_REFRESH_TOKEN`.
5. `GSC_SITE_URL`: the exact property string as it appears in Search
   Console (`https://example.com/` or `sc-domain:example.com`).
6. `YOUTUBE_CHANNEL_ID`: found under YouTube Studio → Settings → Channel →
   Advanced settings.

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

## Safety model

Every "post" tool in the chat (`propose_facebook_post`,
`propose_instagram_post`, `propose_tweet`, `propose_tiktok_post`) only
queues a draft — it cannot publish anything by itself. You approve or
reject each one in the `/agent` UI; only your approval triggers the real
API call. This is deliberate: posting to a public account is hard to
undo, so nothing goes out without you looking at it first.
