# APEX-UI

## Local preview

Run `npm run dev` and open http://localhost:3000 for the homepage or
http://localhost:3000/face for the speaking portrait. `npm run dev:preview` is
an alias for the same command. Run only one development server: both commands
bind to `127.0.0.1:3000` and use `.next-preview`, separate from production builds
in `.next`. A second start fails on the occupied port instead of serving another
version of the app at a different local address.

The homepage and face view open the microphone on load and hold a
conversation: speak, Sarah replies, then listens again. Press the mic button
(or tap the orb while it listens) to stop; press it again to resume. The
`/agent` chat waits for a mic press. Use its mic button to
pause/resume, and press Escape or say “close your face” to return to the graph.
Microphone status reflects the actual recognition session; permission or speech
service failures appear on screen. Run `node scripts/test-voice-input.cjs` to
check recognition handoff and command handling.

## Free conversation mode

Sarah defaults to Gemini for conversation, tool calls, specialists, and camera
input. Create a free-tier key at [Google AI Studio](https://aistudio.google.com/apikey)
and set these values in `.env.local`, then restart the server:

```dotenv
IMEX_BACKEND=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.1-flash-lite
IMEX_VOICE_PROVIDER=system
```

Free-tier quotas apply; Gemini mode never falls back to paid Claude calls.
Google's free tier may use submitted content to improve its products.
System speech uses your OS voices without ElevenLabs. To opt into ElevenLabs,
set `IMEX_VOICE_PROVIDER=elevenlabs` and its credentials. Chat works at `/agent`;
the homepage orb supports voice and “show your face” opens the contour hologram.

Run `node scripts/test-gemini.cjs` for mocked provider/tool-loop checks.


**The Sarah deck** — a voice-first personal assistant interface. Today and the
agent roster sit on the left, Sarah's core in the middle with a live readout and
the control dock, and the conversation on the right. Tap the core or just talk;
the core breathes at rest, sweeps while listening, spins up while thinking, and
swells with each syllable while Sarah speaks. On narrow screens the side panels
become tabs under the core.

> Built with Next.js 15 + React 19. The core is a hand-written 2D canvas; the
> face hologram uses `three` / `@react-three/fiber`. Icons are `lucide-react`.

## Demo

```bash
npm install
npm run dev
# open http://localhost:3000
```

Then `npm run build` for a production build, or deploy to Vercel in one click.

## What's inside

| Piece | What it does |
|-------|--------------|
| `components/sarah/SarahDeck` | The home screen: composes the panels, owns the voice loop and the camera/face commands |
| `components/sarah/SarahCore` | The core: particle sphere + instrument ring on a canvas, driven by the voice state |
| `components/sarah/ConversationPanel` | Live transcript, spoken-word highlighting, approvals, and the text composer (also used by `/agent`) |
| `components/sarah/AgentsPanel` | The agent roster, grouped; each opens its overview card |
| `components/sarah/TodayCard` | Greeting, live clock, and weather |
| `components/sarah/agents` | `ROSTER` / `INFO` and the agent overview card |
| `components/sarah/sarah.css` | Theme tokens (navy, cyan, amber, cream) and the deck layout |
| `app/api/weather` | Keyless [open-meteo](#) proxy for the weather |
| `app/agent` | Chat page: reports on SEO/social accounts, drafts posts for your approval (see [SETUP.md](./SETUP.md)) |

## The Design agent (Gemini images)

Say "take a picture and make it a watercolor painting" and Design edits your camera
photo; say "Designer, make a logo for Chatrix" and it makes a new picture from words.
Follow-ups like "now make the background a beach" refine the latest result, and
"download it" saves it. Results appear in the Design panel beside the original.
It uses `gemini-3.1-flash-image` by default (set `IMEX_IMAGE_MODEL` to change it).
Photos are sent to Google to be edited.

## The Developer agent (Claude Code)

Ask Sarah things like "what projects do I have?" or "ask the developer how the
face tracking works in APEX-UI". Sarah hands the question to the Claude Code
installed on this Mac, which reads the project and answers.

- It only works in folders Claude Code has already been used in (`~/.claude/projects`).
- It can also search your saved Claude Code chats across all projects ("what did we
  decide about the camera?"). Pinned or starred chats live in your claude.ai account,
  which has no API, so they aren't reachable.
- Questions are read-only: the session gets Read, Glob and Grep and nothing else.
- Tasks that run commands or change files ("pull the latest Chatrix code", "run the
  tests") are queued as an approval card. Only after you approve does Claude Code run
  it in that project with the terminal (up to 10 minutes), told not to push, deploy
  or delete beyond the task, then report back.
- It runs on your Claude Code login, not API credits (the API key is withheld).
- Optional settings in `.env.local`: `IMEX_DEVELOPER_MODEL` (default `sonnet`)
  and `IMEX_CLAUDE_CODE_PATH` (defaults to the VS Code extension's signed binary).
- It runs the local Claude Code program, so it works only where this server
  runs on your own Mac, not on a deployed copy.

## Talk to Sarah

`/agent` is a chat + voice interface backed by Claude that can pull live
reports from Google Search Console, Facebook, Instagram, YouTube, X, and
TikTok, and draft posts across those platforms. Every post it drafts stays
a draft until you approve it in the UI — it never publishes on its own.
Nothing here works until you add your own API credentials: see
[SETUP.md](./SETUP.md) for the full walkthrough.

## Customise

- **Colours** → the tokens at the top of `components/sarah/sarah.css`.
- **Greeting name** → `OWNER` in `components/sarah/TodayCard.tsx`.
- **Weather** → auto-detects the **visitor's** city on Vercel (geo headers); edit `FALLBACK` in `app/api/weather/route.ts` to change the off-Vercel / localhost default.
- **Agents & copy** → the `ROSTER` and `INFO` maps in `components/sarah/agents.tsx`.

## Accessibility

Every control is a real, focusable button with a label, the readout and the
transcript are announced as they change, and the whole thing respects
`prefers-reduced-motion` (the core draws a still frame).

## Not included (on purpose)

This repo is the **UI only**. The production Apex page also has a spoken-voice layer and a
"story" narrative — those are personal recordings and private copy, so they are intentionally
left out. The orb stays fully interactive without them.

## License

Code is released under the **[MIT License](#)** — use it, fork it, ship it.

The **name "Apex" and the Haider Ali branding are not part of this license.**
If you build on this, please use your own product name and branding.

---

Made by Haider Ali — Software Engineer.
If you use it, a link back is appreciated (not required).
# apex
