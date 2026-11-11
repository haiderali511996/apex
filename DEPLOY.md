# Deploying Sarah to AWS

The app is one Node.js process with an SQLite database file, so it runs best
on a small always-on server with a disk: **EC2** or **Lightsail**. (Serverless
hosts like App Runner or Lambda lose the database file between runs.)

> Status: the production build (`next build`) passes. The Docker image itself
> hasn't been test-built yet — run `docker compose build` once locally first.

## 1. Server

1. In the AWS console, create a **Lightsail** instance (Ubuntu 24.04, 2 GB RAM is
   enough to start) or an **EC2** `t3.small`. Attach a **static IP**.
2. Open ports **22, 80 and 443** in the firewall / security group.
3. Point your domain (e.g. `assistant.unctech.co`) at the static IP with a DNS **A** record.
4. SSH in and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```

## 2. App

```bash
git clone <your repository URL> sarah && cd sarah
echo "DOMAIN=assistant.unctech.co" > .env
cp .env.local.example .env.production    # then edit it — see below
docker compose up -d --build
```

Open `https://assistant.unctech.co` — Caddy gets the certificate on first visit.

### `.env.production`

Product-wide settings only — each customer's own keys are added on the
Connections page and stored encrypted in the database.

| Setting | What it is |
|---|---|
| `APP_SECRET` | Long random string (`openssl rand -hex 32`). Encrypts every account's keys. **Back it up; changing it makes saved keys unreadable.** |
| `OWNER_EMAIL` | The email that becomes the owner when it signs up. |
| `NEXT_PUBLIC_BRAND_NAME` | Product name (default `Sarah`). |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Shown on the Privacy Policy and Terms. |
| `NEXT_PUBLIC_SPEECH_ENGINE=gemini` | Server transcription (any language). |
| `IMEX_VOICE_PROVIDER=fish` | Fish Audio voices. |
| `FISH_AUDIO_VOICE_ID`, `FISH_AUDIO_URDU_VOICE_ID`, `FISH_AUDIO_MALE_VOICE_ID`, `FISH_AUDIO_MALE_URDU_VOICE_ID`, `FISH_AUDIO_MODEL` | The voices (public Fish model IDs). |
| `UNC_CHAIN_ID`, `UNC_CHAIN_NAME`, `UNC_RPC_URL`, `UNC_TOKEN_ADDRESS`, `UNC_RECEIVER_ADDRESS`, `UNC_DECIMALS`, `UNC_CONFIRMATIONS`, `NEXT_PUBLIC_UNC_PER_USD` | UNC payments. |
| `STRIPE_BILLING_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payments (below). |

`NEXT_PUBLIC_*` values are built into the page, so rebuild after changing
them: `docker compose up -d --build`.

## 3. Card payments (Stripe)

1. In the Stripe dashboard, copy your **secret key** into `STRIPE_BILLING_SECRET_KEY`.
2. **Developers → Webhooks → Add endpoint**:
   `https://assistant.unctech.co/api/billing/stripe-webhook`, events
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
3. Copy the endpoint's **signing secret** into `STRIPE_WEBHOOK_SECRET`, then
   `docker compose up -d`.

Test with Stripe's test keys and card `4242 4242 4242 4242` before going live.

## 4. Google sign-in for customers

Each customer brings their own Google OAuth client, so no Google setup is
needed on the server. To offer **one shared "Sign in with Google"** instead,
your OAuth app must pass Google's verification — see `GOOGLE_VERIFICATION.md`.

## 5. Backups and updates

```bash
# Back up the database (accounts, encrypted keys, plans, posts) daily:
docker run --rm -v sarah_sarah-data:/data -v $PWD:/backup busybox tar czf /backup/sarah-data-$(date +%F).tgz /data
# Update to a new version:
git pull && docker compose up -d --build
```

Keep backups (and `APP_SECRET`) somewhere off the server, e.g. an S3 bucket.

## Notes

- **Mac control on the server** (the owner's `mac_*` tools) only works when the
  server runs on a Mac. On AWS, everyone — owner included — controls their
  computers through the desktop app (Account → Your computers).
- **Claude Code (Developer agent)** runs on the machine the server is on; on
  AWS it needs Claude Code installed in the image, or it stays a local feature.
