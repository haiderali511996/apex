import type Anthropic from "@anthropic-ai/sdk";
import {
  searchConsole, meta, youtube, x, tiktok,
  workspace, crm, finance, paypal, bank, analytics,
  allConnectorStatuses,
} from "./connectors";
import { createPendingAction, listPendingActions, listActionLog, getProjectNames, saveProjectName } from "./store";
import { askSpecialist } from "./specialist";
import { SPECIALISTS, specialistKeys } from "./roles";
import { askAboutChats, askDeveloper, listProjects, nameProject, resolveProject } from "./developer";
import { claudeComputer, isOnline, listDevices, pickDevice, runOnDevice } from "@/lib/devices";
import { currentUserId } from "@/lib/credentials";
import { findDesign, listDesigns } from "@/lib/designs";
import { pickPhotos, savePhoto } from "@/lib/photos";
import { analyze } from "@/lib/trading/analyst";
import { closeTrades, describeAnalysis, getSettings, openFromAnalysis, scan, statusText, updateSettings, type Mode } from "@/lib/trading/engine";
import type { BrokerId } from "@/lib/trading/brokers";
import { ENGINES, setAgentEngine } from "@/lib/agentEngines";
import { startStep } from "@/lib/activity";
import { currentProject, knownProjects, rememberProjectList, resolveProjectRef, setCurrentProject } from "@/lib/devContext";
import * as mailbox from "./connectors/mailbox";
import { addMemory, CATEGORIES, deleteMemory, recentTurns, searchMemories, type Category } from "@/lib/memory";
import { controlMediaApps, focusChromeTab, systemInfo, listChromeProfiles, listChromeTabs, listRunningApps, openApp, openUrl, setVolume } from "./mac";
import type { ClientAction, PendingAction, Report } from "./types";
import { searchWeb } from "./gemini";

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "get_connector_status",
    description: "List every connected platform (Search Console, Facebook, Instagram, YouTube, X, TikTok) and whether it's configured with working credentials.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_seo_report",
    description: "Pull on-page/organic search performance from Google Search Console: clicks, impressions, CTR, average position, top queries, top pages.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "How many trailing days to cover. Default 28." } },
    },
  },
  {
    name: "get_facebook_report",
    description: "Pull Facebook Page stats: followers, impressions, engaged users.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_instagram_report",
    description: "Pull Instagram business account stats: followers, reach, profile views.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_youtube_report",
    description: "Pull YouTube channel stats: subscribers, total views, video count, and recent upload performance.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_x_report",
    description: "Pull X (Twitter) account stats: followers, following, post count.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_tiktok_report",
    description: "Pull TikTok account stats: followers, total likes, video count.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_activity",
    description: "List what the agent has actually done recently (executed posts, successes/failures) — use this when the user asks 'what have you done' or 'what were the results'.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max entries to return. Default 10." } },
    },
  },
  {
    name: "list_pending_actions",
    description: "List write actions (posts) that are proposed but still waiting on the user's approval in the UI.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_designs",
    description: "The pictures the Design agent made for this user recently (newest first), with ids for attaching one to a post. Use when asked to post a design or picture that was made.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_facebook_post",
    description: "Draft a Facebook Page post for the user to review and approve. This does NOT publish anything — it only queues the post for the user to confirm in the UI.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Post text." },
        link: { type: "string", description: "Optional link to attach (ignored when a picture is attached; put the link in the text instead)." },
        design_id: { type: "string", description: "Attach a picture the Design agent made: its id from list_designs, or \"latest\" for the most recent one." },
      },
      required: ["message"],
    },
  },
  {
    name: "propose_instagram_post",
    description: "Draft an Instagram post (image + caption) for the user to review and approve. Does NOT publish anything. Instagram needs a picture: use design_id for one the Design agent made.",
    input_schema: {
      type: "object",
      properties: {
        design_id: { type: "string", description: "Attach a picture the Design agent made: its id from list_designs, or \"latest\" for the most recent one." },
        imageUrl: { type: "string", description: "Only for a picture that is already online elsewhere: its public URL." },
        caption: { type: "string" },
      },
      required: ["caption"],
    },
  },
  {
    name: "propose_tweet",
    description: "Draft a post on X for the user to review and approve. Does NOT publish anything.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Tweet text, max 280 chars." },
        design_id: { type: "string", description: "Attach a picture the Design agent made: its id from list_designs, or \"latest\" for the most recent one." },
      },
      required: ["text"],
    },
  },
  {
    name: "propose_tiktok_post",
    description: "Draft a TikTok video post for the user to review and approve. Does NOT publish anything.",
    input_schema: {
      type: "object",
      properties: {
        videoUrl: { type: "string", description: "Publicly reachable video URL." },
        caption: { type: "string" },
      },
      required: ["videoUrl", "caption"],
    },
  },

  /* ── Email / Calendar / Drive ── */
  {
    name: "get_inbox",
    description: "Read the user's inbox: unread mail first (senders, subjects, snippets, ids). Works with any email provider: the account connected under Email on the Connections page, and/or Gmail through Google sign-in. Reading never marks mail as read.",
    input_schema: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "How many messages. Default 10." },
        account: { type: "string", description: "Only one inbox: its address (or a unique part, e.g. \"info\"), or \"gmail\" for Gmail via Google sign-in. Omit to check every connected inbox." },
      },
    },
  },
  {
    name: "search_email",
    description: "Search the user's email on any provider. Query words plus optional from:, to:, subject:, newer_than:7d, older_than:30d, is:unread.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "e.g. 'from:client@x.com newer_than:7d invoice'." },
        maxResults: { type: "number" },
        account: { type: "string", description: "One inbox's address (or a unique part), or \"gmail\". Omit to search every connected inbox." },
      },
      required: ["query"],
    },
  },
  {
    name: "read_email",
    description: "Read one whole message from the connected inbox (any provider) by the id shown in get_inbox or search_email: full text, recipients, attachments' names. Use before replying, summarising or acting on an email.",
    input_schema: { type: "object", properties: { id: { type: "number", description: "The message id from the list." }, account: { type: "string", description: "The inbox the id came from (its address). Needed when several inboxes are connected." } }, required: ["id"] },
  },
  {
    name: "propose_email",
    description: "Draft an email for the user to review and approve. Does NOT send anything — the user must approve it first.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address." },
        subject: { type: "string" },
        body: { type: "string", description: "Plain-text body." },
        account: { type: "string", description: "Which inbox sends it: its address, or \"gmail\". When replying, use the inbox the email came to. Omit to use the first connected inbox." },
        in_reply_to: { type: "string", description: "When replying to a message from read_email: its Message-ID, so it threads." },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "get_calendar",
    description: "List the user's upcoming calendar events.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "How many days ahead. Default 7." } },
    },
  },
  {
    name: "propose_calendar_event",
    description: "Draft a calendar event for the user to approve. Does NOT create it until approved — events can email invitations to other people.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Event title." },
        startIso: { type: "string", description: "Start time, ISO 8601 with timezone offset." },
        endIso: { type: "string", description: "End time, ISO 8601 with timezone offset." },
        description: { type: "string" },
        attendees: { type: "array", items: { type: "string" }, description: "Attendee email addresses." },
      },
      required: ["summary", "startIso", "endIso"],
    },
  },
  {
    name: "search_drive",
    description: "Find files in the user's Google Drive, newest first: by name or content, or with an empty query the latest files. kind \"image\" keeps only pictures (\"the photos I just put on Drive\"). Each result has its file id for drive_photos.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words in the file's name or content; empty for the newest files." },
        kind: { type: "string", enum: ["any", "image"], description: "\"image\" for pictures only." },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "drive_photos",
    description: "Opens pictures (or previews of PDFs and documents) from the user's Google Drive so you and the agents can see them: they come back to you attached to the next message with their photo_ids, to pass on to design_picture (as references), ask_specialist or propose_developer_task. Use \"latest\" or \"latest:N\" for the newest pictures uploaded, or file ids from search_drive.",
    input_schema: {
      type: "object",
      properties: {
        file_ids: { type: "array", items: { type: "string" }, description: "Drive file ids, or [\"latest:2\"] for the two newest pictures. At most 6." },
        request: { type: "string", description: "What the user wants done with them, in their words, with every exact detail they gave." },
      },
      required: ["file_ids", "request"],
    },
  },

  /* ── CRM / Finance / Analytics ── */
  {
    name: "get_crm_pipeline",
    description: "Read the CRM pipeline (a Google Sheet): every lead, their stage, and stage counts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_crm_lead",
    description: "Add a lead to the CRM sheet. Pass fields matching the sheet's column headers (e.g. Name, Company, Email, Stage, Value, Notes). This writes to a private spreadsheet, so it runs immediately.",
    input_schema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          description: "Column name to value, e.g. {\"Name\": \"Jane\", \"Stage\": \"New\"}.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["fields"],
    },
  },
  {
    name: "update_crm_stage",
    description: "Move a lead in the CRM sheet to a different pipeline stage.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lead name to match." },
        stage: { type: "string", description: "New stage value." },
      },
      required: ["name", "stage"],
    },
  },
  {
    name: "get_revenue",
    description: "Read revenue from Stripe: gross, refunded, net, charge counts and recent payments.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Trailing days. Default 30." } },
    },
  },
  {
    name: "get_paypal_report",
    description: "Read PayPal: balance, money in, money out, fees, net and recent transactions. Read-only.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Trailing days. Default 30." } },
    },
  },
  {
    name: "get_bank_report",
    description: "Read the connected bank account (Wise): balances in each currency, money in and out, and recent statement lines. Read-only.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Trailing days. Default 30." } },
    },
  },
  {
    name: "get_open_invoices",
    description: "List open (unpaid) Stripe invoices and the total outstanding.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_traffic",
    description: "Read website traffic from Google Analytics (GA4): sessions, users, page views, bounce rate, traffic by channel and top pages.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "Trailing days. Default 28." } },
    },
  },

  /* ── Memory ── */
  {
    name: "remember",
    description: "Store a durable fact about a client, project, preference or decision so it's available in future conversations. Use this whenever the user tells you something worth keeping.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["profile", "preference", "project", "connection", "decision", "asset", "person", "task", "work"], description: "What kind of fact it is." },
        fact: { type: "string", description: "The thing to remember, as one self-contained sentence." },
      },
      required: ["fact"],
    },
  },
  {
    name: "recall",
    description: "Search your long-term memory (facts noted from all earlier conversations) and the saved conversation. Call this when the user references past work, decisions, clients, designs or anything you should know but don't see in your memory brief.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for. Omit to list the most recent facts." } },
    },
  },
  {
    name: "forget",
    description: "Delete facts from memory that the user says are wrong or wants forgotten. Pass words that identify them; it removes the matching facts and says which.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },

  /* ── Developer: Claude Code on this Mac ── */
  {
    name: "list_projects",
    description: "List the code projects on the user's computer (hosted: the linked computer, through the desktop app), most recently active first: ones opened in Claude Code, plus project folders found in the home, Desktop, Documents, Downloads and code folders. Also says whether Claude Code is installed there. Call this when they ask what projects exist, or before ask_developer when unsure of a name.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ask_developer",
    description: "Hand a question about one of the user's code projects to the Developer agent — Claude Code running on the user's computer. It reads and searches the project's files and answers: what a project does, where something is implemented, how a feature works, what's unfinished, or a code review. It cannot change files. It can take a minute, so tell the user you're checking first.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name (as spoken is fine), \"project/subfolder\" (e.g. \"unc/web-next\"), or a folder path. Omit to use the current project." },
        task: { type: "string", description: "The question or task, written out in full for a developer who hasn't heard the conversation." },
      },
      required: ["task"],
    },
  },

  {
    name: "propose_developer_task",
    description: "Queue a task for the Developer (Claude Code on the user's computer) that runs terminal commands or changes files in a project — git pull, installing dependencies, running tests or the build, fixing a bug, making an edit, writing a blog post or page with pictures the Design agent made (pass design_ids). Nothing runs until the user approves it in the UI; then Claude Code does it with the terminal and reports back. Use this instead of telling the user to run commands themselves.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name (as spoken is fine), \"project/subfolder\" (e.g. \"unc/web-next\"), or a folder path. Omit to use the current project." },
        task: { type: "string", description: "Exactly what to do, written out in full, e.g. \"Run git pull origin main and report what changed.\" or \"Write a new blog post about KYC and use the attached images in it.\"" },
        design_ids: { type: "array", items: { type: "string" }, description: "Pictures the Design agent made, to use in the work (a blog post, a page, the app): ids from list_designs, or \"latest\", \"latest:3\" for the newest three. The Developer downloads them into the project." },
        photo_ids: { type: "array", items: { type: "string" }, description: "Photos or screenshots the user showed you (their ids from the conversation, or \"latest\"), e.g. of a bug, an error on screen or a layout to copy. The Developer downloads them and looks at them before working." },
      },
      required: ["task"],
    },
  },
  {
    name: "name_project",
    description: "Save what the user calls a project (e.g. \"Website Live\") and which folder it is, once they confirm it, so the name works directly next time.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name the user uses." },
        folder: { type: "string", description: "The folder: a path, or a folder name from list_projects." },
      },
      required: ["name", "folder"],
    },
  },
  {
    name: "search_claude_chats",
    description: "Ask the Developer (Claude Code) about the user's past Claude Code chats, across all projects: what was discussed, decided, built or left unfinished, and when. Use when they mention a previous chat or session, or asks what they worked on. Read-only; can take a minute.",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: "What to find or summarize, written out in full." } },
      required: ["task"],
    },
  },

  /* ── Design: Gemini pictures, carried out on the user's screen ── */
  {
    name: "design_picture",
    description: "Hand a picture request to the Design agent on the user's screen. With use_camera true, the deck takes a photo with their webcam right now and Design edits it per the instruction (leave the instruction empty to just take the photo). With use_camera false, Design makes a new picture from the instruction — a logo, poster, illustration. Use this whenever they ask for a photo, picture, selfie, image or design to be made or edited, in any wording or language — you do have a camera through this tool. When they want you or an agent to see or check something (an error, a screen, a document), use show_photo instead.",
    input_schema: {
      type: "object",
      properties: {
        use_camera: { type: "boolean", description: "True to take a photo with the webcam first." },
        instruction: { type: "string", description: "What Design should make or change. Carry over every exact word, name, number, dose, colour and layout detail the user gave, verbatim (text they typed or pasted goes in word for word, in quotes), plus what must match the reference photos. Empty to just take a photo." },
        photo_ids: { type: "array", items: { type: "string" }, description: "Photos the user showed you (their ids from the conversation, \"latest\" or \"latest:N\") to work from: a product, packaging, an old design, a layout or style to follow. Design sees them and copies their real product, text, colours and branding instead of inventing them. Always pass them when the user refers to pictures they showed." },
      },
      required: ["use_camera", "instruction"],
    },
  },

  {
    name: "show_photo",
    description: "Take a photo with the camera so you can see something the user wants to show you: an error or bug on a screen, a document, a product, a sketch, a place. The photo comes back to you in the next message with the request, so you can look at it and hand it on (photo_ids) to the right agent. Use this, not design_picture, when they want you or an agent to see or check something rather than to make a picture.",
    input_schema: {
      type: "object",
      properties: {
        camera: { type: "string", enum: ["front", "back"], description: "\"back\" (a phone's rear camera) for pointing at a screen, paper or object; \"front\" for the user themselves. On a laptop both use its camera." },
        request: { type: "string", description: "What to do with it, in their words, e.g. \"send it to the developer to fix the error\"." },
      },
      required: ["camera", "request"],
    },
  },

  /* ── Trading agent ── */
  {
    name: "analyze_market",
    description: "The Trading agent analyses one market right now, like a disciplined professional: technicals on the daily, 4-hour and 1-hour charts, plus news and scheduled events from authoritative sources (Reuters, Bloomberg, central banks, filings…), then gives buy / sell / wait with entry, stop-loss, target, reward-to-risk and an honest confidence. Crypto (BTC, ETH, SOL…), forex and metals (EURUSD, GBPJPY, XAUUSD/gold) and stocks, ETFs and indices (AAPL, NVDA, SPY, RELIANCE.NS). Takes about 20 seconds. Set trade true only when the user explicitly asks to take the trade now; it then goes through the autopilot's limits.",
    input_schema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Ticker or name, e.g. \"BTC\", \"EUR/USD\", \"gold\", \"TSLA\"." },
        market: { type: "string", enum: ["crypto", "forex", "stock"], description: "Only if the symbol is ambiguous." },
        trade: { type: "boolean", description: "True only if the user said to take the trade if the analysis supports it." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "trading_status",
    description: "The Trading agent's status: autopilot mode (off / paper / live), risk limits, watchlist, brokers, open trades with live profit or loss, the honest track record (win rate, profit) and its latest actions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_trading",
    description: "Change the Trading agent's autopilot. mode \"paper\" = trade by itself with practice money; \"off\" = stop all automatic trading at once (use when they say stop trading, pause the bot, etc.). Real-money (live) mode can only be switched on from the Trading card, never by voice: if asked, tell them to open the Trading agent card. Also changes the rules: risk per trade (%), daily loss limit (%), max open positions, minimum confidence (%), how often it checks (minutes), the watchlist, and which broker each market uses (paper, alpaca for stocks, oanda for forex/gold).",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["off", "paper"] },
        risk_pct: { type: "number" }, daily_loss_pct: { type: "number" }, max_positions: { type: "number" },
        min_confidence: { type: "number" }, interval_min: { type: "number" },
        watchlist: { type: "array", items: { type: "string" }, description: "The full new list of markets to watch." },
        stock_broker: { type: "string", enum: ["paper", "alpaca"] }, forex_broker: { type: "string", enum: ["paper", "oanda"] },
      },
    },
  },
  {
    name: "close_trade",
    description: "Close an open trade now at the market price: a market name (\"BTC\", \"EURUSD\"), a trade id, or \"all\" (with stop trading, this is the full emergency stop). Live trades close at the broker.",
    input_schema: { type: "object", properties: { which: { type: "string" } }, required: ["which"] },
  },
  {
    name: "trading_scan_now",
    description: "Run the autopilot's scan of the whole watchlist now instead of waiting for its next round (only when the autopilot is on). Can take a few minutes.",
    input_schema: { type: "object", properties: {} },
  },

  /* ── Specialists ── */
  {
    name: "web_search",
    description: "Search the web (Google) for anything current or factual you don't know for sure: news, prices, exchange rates, sports, people, companies, products, laws, opening hours, events. Returns an answer with sources. Prefer this over guessing.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "What to look up, as a full question." } }, required: ["query"] },
  },
  {
    name: "ask_specialist",
    description: `Delegate to a focused specialist for thinking, writing or planning work: ${specialistKeys().join(", ")}. Use this for strategy, research, editing, sales copy, campaign planning, quotes/scoping, fabrication advice, or design direction. Fetch any live data first and pass it in as context.`,
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", enum: specialistKeys(), description: "Which specialist to ask." },
        request: { type: "string", description: "What you need from them." },
        context: { type: "string", description: "Any live data or background they should work from. If you pass photo_ids, also describe in a sentence what the photo shows." },
        photo_ids: { type: "array", items: { type: "string" }, description: "Photos or screenshots the user showed you (ids from the conversation, or \"latest\") that the specialist should look at." },
      },
      required: ["role", "request"],
    },
  },
  {
    name: "set_agent_engine",
    description: "Choose which AI an agent thinks with, saved for all future conversations. Use when the user says e.g. \"use Claude for my research\", \"let Claude handle strategy\", \"switch marketing back to Gemini\". \"claude-code\" = Claude through Claude Code on their computer (their subscription); \"gemini\" = Gemini. agent \"all\" sets every agent.",
    input_schema: {
      type: "object",
      properties: {
        agent: { type: "string", enum: [...specialistKeys(), "all"], description: "Which agent." },
        engine: { type: "string", enum: ["claude-code", "gemini"] },
      },
      required: ["agent", "engine"],
    },
  },
  /* ── Linked computers (the desktop app: Mac, Windows, Linux) ── */
  {
    name: "computer_list",
    description: "List the computers linked through the desktop app, with their system and whether they're online.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "computer_system_info",
    description: "What a linked computer is: model, processor (CPU), graphics card (GPU), memory (RAM), storage, operating system and battery (charge, time left, cycle count, health). Read-only. Use this for any question about the computer's specs, hardware or battery.",
    input_schema: { type: "object", properties: { computer: { type: "string", description: "Optional: the computer's name or system (Windows, macOS, Linux). Leave it out to check every online computer — then say which answer is which." } } },
  },
  {
    name: "computer_open_app",
    description: "Open an app on a linked computer. Omit computer to use the most recently active one.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "The app, e.g. \"Google Chrome\", \"Notepad\", \"Spotify\"." }, computer: { type: "string", description: "Optional: the computer's name or system (Windows, macOS, Linux)." } }, required: ["name"] },
  },
  {
    name: "computer_open_url",
    description: "Open a website on a linked computer, optionally in a Chrome profile (its name or email) — e.g. Gmail is https://mail.google.com in that profile.",
    input_schema: { type: "object", properties: { url: { type: "string" }, chrome_profile: { type: "string" }, computer: { type: "string" } }, required: ["url"] },
  },
  {
    name: "computer_run",
    description: "Everyday actions on a linked computer: list_apps, list_chrome_profiles, set_volume (level: 0–100, \"mute\" or \"unmute\"), media (action: play or pause).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_apps", "list_chrome_profiles", "set_volume", "media"] },
        level: { type: "string", description: "For set_volume." },
        media_action: { type: "string", enum: ["play", "pause"], description: "For media." },
        computer: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "propose_computer_quit_app",
    description: "Queue quitting an app on a linked computer. It may lose unsaved work, so nothing happens until the user approves it.",
    input_schema: { type: "object", properties: { name: { type: "string" }, computer: { type: "string" } }, required: ["name"] },
  },
  {
    name: "propose_computer_power",
    description: "Queue restarting, shutting down or sleeping a linked computer. Nothing happens until the user approves it.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["restart", "shut down", "sleep"] }, computer: { type: "string" } }, required: ["action"] },
  },
  {
    name: "propose_computer_script",
    description: "For any other task on a linked computer: write a short script and queue it. Nothing runs until the user reads and approves it. Set language to what the script is written in: \"shell\" for terminal commands (zsh on macOS, bash on Linux), \"applescript\" for AppleScript on macOS, \"powershell\" on Windows (check computer_list for the system). Never use this for specs, hardware or battery — computer_system_info answers those at once, without approval.",
    input_schema: { type: "object", properties: { purpose: { type: "string" }, script: { type: "string" }, language: { type: "string", enum: ["shell", "applescript", "powershell"] }, computer: { type: "string" } }, required: ["purpose", "script", "language"] },
  },
  /* ── This Mac: apps, Chrome profiles, websites ── */
  {
    name: "mac_system_info",
    description: "What this Mac is: model, chip/processor, graphics, memory (RAM), storage, macOS version and battery (charge, time left, cycle count, health, condition). Read-only. Use this — never mac_applescript — for any question about the Mac's specs, hardware or battery.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mac_list_apps",
    description: "List the apps open on this Mac right now, and which one is in front.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mac_open_app",
    description: "Open (or bring to the front) an app on the Mac by name, e.g. \"Google Chrome\", \"Finder\", \"Visual Studio Code\", \"WhatsApp\".",
    input_schema: { type: "object", properties: { name: { type: "string", description: "The app's name as macOS knows it." } }, required: ["name"] },
  },
  {
    name: "mac_list_chrome_profiles",
    description: "List the Chrome profiles with their names and email addresses. Several share a name (e.g. two with the same person's name), so check this before opening a profile named loosely.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mac_open_url",
    description: "Open a website on the Mac. Give chrome_profile (its name or email) to open it in that Chrome profile — e.g. Gmail is https://mail.google.com in the profile whose inbox they want. Without it, the site opens in the default browser.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The address, e.g. https://mail.google.com or youtube.com." },
        chrome_profile: { type: "string", description: "Optional Chrome profile name or email." },
        browser: { type: "string", description: "Optional browser app, e.g. Safari. Ignored when chrome_profile is given." },
      },
      required: ["url"],
    },
  },
  {
    name: "mac_list_chrome_tabs",
    description: "List every open Chrome tab as window:tab — title — URL.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mac_focus_chrome_tab",
    description: "Bring one open Chrome tab to the front, by the window and tab numbers from mac_list_chrome_tabs.",
    input_schema: { type: "object", properties: { window: { type: "number" }, tab: { type: "number" } }, required: ["window", "tab"] },
  },
  {
    name: "mac_set_volume",
    description: "Set the Mac's output volume (0–100), or mute/unmute it.",
    input_schema: { type: "object", properties: { level: { type: "string", description: "A number 0–100, or \"mute\" / \"unmute\"." } }, required: ["level"] },
  },
  {
    name: "mac_media",
    description: "Pause, play or check the music apps on the Mac (Apple Music, Spotify, VLC, QuickTime). Not for Sarah's own background music, which the app switches itself.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["pause", "play", "status"] } }, required: ["action"] },
  },
  {
    name: "propose_mac_quit_all_apps",
    description: "Queue quitting every open app on the Mac (keeping Chrome and the editor/terminal Sarah runs in). Nothing happens until the user approves it in the UI.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_mac_power",
    description: "Queue restarting, shutting down or sleeping the Mac. Nothing happens until the user approves it in the UI; on restart or shut down, apps are asked to quit first so unsaved work prompts to save.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["restart", "shut down", "sleep"] } }, required: ["action"] },
  },
  {
    name: "propose_mac_quit_app",
    description: "Queue quitting an app on the Mac. It may lose unsaved work, so nothing happens until the user approves it in the UI.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "propose_mac_applescript",
    description: "For any other Mac task the tools above can't do (Finder, System Settings, Notes, Reminders, window layout, clicking in an app…): write an AppleScript that does it and queue it. Nothing runs until the user reads and approves it in the UI. Keep the script short and focused on exactly what they asked. It must be real AppleScript, never a bare shell command (wrap any shell command in do shell script \"…\"). Never use this for specs, hardware or battery questions — mac_system_info answers those at once.",
    input_schema: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "One plain sentence saying what the script does." },
        script: { type: "string", description: "The AppleScript source." },
      },
      required: ["purpose", "script"],
    },
  },
];

function reportToText(r: Report): string {
  const metrics = r.metrics.map((m) => `${m.label}: ${m.value}`).join(", ");
  const notes = r.notes?.length ? `\nNotes: ${r.notes.join(" | ")}` : "";
  return `${r.title} (${r.rangeLabel}) — ${metrics}${notes}`;
}

export type ToolRunResult = { text: string; pendingAction?: PendingAction; clientAction?: ClientAction };

/** Added to every Developer task. */
const GIT_RULE = "Git rule: before any git push, first run git pull on that branch (fetch and integrate the remote changes the way the project does, merge or rebase) and make sure it still builds; if the pull brings conflicts, stop and report them instead of pushing or forcing.";

/**
 * Designs handed to the Developer: their public links go into the task, with
 * instructions to download them into the project and follow its conventions.
 * "latest:3" means the newest three.
 */
function withDesigns(task: string, ids: unknown): string {
  const wanted = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (!wanted.length) return task;
  const userId = currentUserOrThrow();
  const picked: { url: string; prompt: string }[] = [];
  for (const id of wanted) {
    const many = /^latest:(\d+)$/.exec(id.trim());
    if (many) picked.push(...listDesigns(userId, Math.min(Number(many[1]), 10)));
    else picked.push(attachDesign(id)!);
  }
  const unique = [...new Map(picked.map(d => [d.url, d])).values()];
  return `${task}

Images to use (made by the Design agent). Work with local files only:
1. Download each to this computer first, into ~/Documents/UNC Assistant/designs/ (create it if needed), e.g. curl -fsSL -o ~/Documents/UNC\\ Assistant/designs/<descriptive-name>.jpg <url>. Keep these copies there.
2. Copy them into the folder this project uses for this kind of content, with descriptive file names, and reference those project files (with good alt text).
3. Never link to the download URLs below from the project; they are only where to fetch the files from.
Download URLs:
${unique.map(d => `- ${d.url} ("${d.prompt}")`).join("\n")}
Follow the project's own conventions for this (read CLAUDE.md, README and any brief or command for it first). Don't deploy or push unless the task says to; report the files you added and how to preview them.`;
}

/**
 * Photos the user showed, handed to the Developer: Claude Code downloads them
 * into the project (kept out of git) and views them with its Read tool.
 */
function withPhotos(task: string, ids: unknown): string {
  const photos = pickPhotos(currentUserOrThrow(), ids);
  if (!photos.length) return task;
  return `${task}

Photos the user showed of this (screenshots or camera photos). Look at them before you start:
1. Download each into this project's .sarah/photos/ folder, e.g. mkdir -p .sarah/photos && curl -fsSL -o .sarah/photos/photo-1.jpg <url>, and add ".sarah/" to .git/info/exclude so they are never committed.
2. Open each downloaded file with the Read tool to see it (Read shows images). Say briefly what you see, and work from that.
3. Don't put them in the project's own files unless the task says so.
Download URLs:
${photos.map((p, i) => `- photo-${i + 1}: ${p.url}`).join("\n")}`;
}

/** The design a post should carry, by id or "latest"; errors say what to do instead. */
function attachDesign(id: unknown) {
  if (typeof id !== "string" || !id.trim()) return null;
  const design = findDesign(currentUserOrThrow(), id.trim());
  if (!design) throw new Error(id.trim() === "latest" ? "No design has been made yet — ask the Design agent for one first." : "That design wasn't found; use list_designs for the ids.");
  return design;
}

/** Hosted (not on the owner's Mac), the Developer is the Claude Code on the user's own computer, through the desktop app. */
const HOSTED = process.platform !== "darwin";
const devComputer = claudeComputer;
async function devComputerName() { return devComputer(currentUserOrThrow()).name; }
function onDevComputer(action: string, args: Record<string, unknown>, timeoutMs: number) {
  const userId = currentUserOrThrow();
  return runOnDevice(userId, devComputer(userId).id, action, args, timeoutMs);
}
const squashName = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
/**
 * The exact folder for a spoken project on the user's computer (see
 * lib/devContext.ts). The project list is refreshed from the computer when
 * it's stale, so names resolve to real folders instead of guesses.
 */
async function projectOnComputer(said: string | undefined): Promise<string> {
  const userId = currentUserOrThrow();
  if (!knownProjects(userId).fresh) {
    const listing = await onDevComputer("dev_projects", {}, 60_000).catch(() => "");
    if (listing) rememberProjectList(userId, listing);
  }
  return resolveProjectRef(userId, said, await getProjectNames());
}

/** The folder a Developer answer came from ("name (~/path):" on its first line) becomes the current project. */
function noteProjectFrom(userId: string, answer: string) {
  const m = /^[^\n(]+\(((?:~|\/|[A-Za-z]:\\)[^)]*)\):/.exec(answer);
  if (m) setCurrentProject(userId, m[1]);
}

function currentUserOrThrow(): string {
  const id = currentUserId();
  if (!id) throw new Error("No signed-in account for this request.");
  return id;
}

/**
 * Runs a tool and records it as a step of the agent doing the work, for the
 * deck's live agent cards (lib/activity.ts). Design is recorded where the
 * picture is actually made (the imagine route), not here.
 */
export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolRunResult> {
  const end = name === "design_picture" ? () => {} : startStep(currentUserId(), name, input);
  try {
    const result = await runTool(name, input);
    end(true, result.text.split("\n").find(l => l.trim())?.slice(0, 220));
    return result;
  } catch (err) {
    // Google's raw errors become something Sarah can tell the user to fix.
    const message = workspace.explainGoogleError(err);
    end(false, message);
    throw message === (err instanceof Error ? err.message : String(err)) ? err : new Error(message);
  }
}

async function runTool(name: string, input: Record<string, unknown>): Promise<ToolRunResult> {
  switch (name) {
    case "get_connector_status":
      return { text: JSON.stringify(allConnectorStatuses(), null, 2) };
    case "get_seo_report":
      return { text: reportToText(await searchConsole.getSeoReport((input.days as number) || 28)) };
    case "get_facebook_report":
      return { text: reportToText(await meta.getFacebookReport()) };
    case "get_instagram_report":
      return { text: reportToText(await meta.getInstagramReport()) };
    case "get_youtube_report":
      return { text: reportToText(await youtube.getYoutubeReport()) };
    case "get_x_report":
      return { text: reportToText(await x.getXReport()) };
    case "get_tiktok_report":
      return { text: reportToText(await tiktok.getTiktokReport()) };
    case "get_recent_activity": {
      const log = await listActionLog((input.limit as number) || 10);
      if (!log.length) return { text: "No actions have been executed yet." };
      return {
        text: log
          .map((e) => `[${e.at}] ${e.platform} — ${e.summary}: ${e.outcome}${e.detail ? ` (${e.detail})` : ""}`)
          .join("\n"),
      };
    }
    case "list_pending_actions": {
      const pending = (await listPendingActions()).filter((a) => a.status === "pending");
      if (!pending.length) return { text: "No pending actions awaiting approval." };
      return { text: pending.map((a) => `${a.id}: [${a.platform}] ${a.summary}`).join("\n") };
    }
    case "list_designs": {
      const designs = listDesigns(currentUserOrThrow());
      if (!designs.length) return { text: "No designs have been made yet. Ask the Design agent for one first." };
      return { text: designs.map((d, i) => `${i === 0 ? "(latest) " : ""}id ${d.id} · ${new Date(d.createdAt).toLocaleString("en-GB")} · ${d.branded ? "with the brand logo · " : ""}"${d.prompt}" · ${d.url}`).join("\n") };
    }
    case "propose_facebook_post": {
      const design = attachDesign(input.design_id);
      const action = await createPendingAction({
        platform: "meta",
        kind: "facebook_post",
        summary: `Post to Facebook Page${design ? " with the picture" : ""}: "${input.message}"`,
        payload: { message: input.message, link: design ? undefined : input.link, ...(design ? { imageUrl: design.url } : {}) },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been posted yet.`, pendingAction: action };
    }
    case "propose_instagram_post": {
      const design = attachDesign(input.design_id);
      const imageUrl = design?.url ?? (typeof input.imageUrl === "string" && /^https:\/\//.test(input.imageUrl) ? input.imageUrl : null);
      if (!imageUrl) return { text: "Instagram needs a picture. Ask the Design agent to make one, then attach it with design_id \"latest\"." };
      const action = await createPendingAction({
        platform: "meta",
        kind: "instagram_post",
        summary: `Post to Instagram: "${input.caption}"`,
        payload: { imageUrl, caption: input.caption },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been posted yet.`, pendingAction: action };
    }
    case "propose_tweet": {
      const design = attachDesign(input.design_id);
      const action = await createPendingAction({
        platform: "x",
        kind: "tweet",
        summary: `Post to X${design ? " with the picture" : ""}: "${input.text}"`,
        payload: { text: input.text, ...(design ? { imageUrl: design.url, designId: design.id } : {}) },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been posted yet.`, pendingAction: action };
    }
    case "propose_tiktok_post": {
      const action = await createPendingAction({
        platform: "tiktok",
        kind: "tiktok_post",
        summary: `Post to TikTok: "${input.caption}"`,
        payload: { videoUrl: input.videoUrl, caption: input.caption },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been posted yet.`, pendingAction: action };
    }

    case "get_inbox":
    case "search_email": {
      const which = (input.account as string | undefined)?.trim();
      const onlyGmail = which?.toLowerCase() === "gmail";
      const boxes = onlyGmail ? [] : which ? [mailbox.pickAccount(which)] : mailbox.listAccounts();
      const useGmail = (!which || onlyGmail) && workspace.isConfigured();
      if (!boxes.length && !useGmail) return { text: onlyGmail ? "Gmail isn't connected: sign in with Google on the Connections page." : "No email is connected. Add your inboxes under Email on the Connections page (any provider), or sign in with Google for Gmail." };
      // Fewer messages each when several inboxes are checked at once.
      const max = (input.maxResults as number) || (boxes.length > 2 ? 5 : 10);
      const query = String(input.query ?? "");
      // Every inbox answers on its own: one failing (a changed password, an expired sign-in) must not hide the others.
      const parts = await Promise.all([
        ...boxes.map(acct => (name === "get_inbox" ? mailbox.getInbox(acct, max) : mailbox.searchMail(acct, query, max)).catch(err => `${acct.address}: ${err instanceof Error ? err.message : err}`)),
        ...(useGmail ? [(name === "get_inbox" ? workspace.getInboxSummary(max) : workspace.searchEmail(query, max))
          .then(r => `Gmail: ${reportToText(r)}`)
          .catch(err => `Gmail couldn't be checked: ${/invalid_grant/.test(String(err instanceof Error ? err.message : err)) ? "the Google sign-in has expired — sign in with Google again on the Connections page" : err instanceof Error ? err.message : err}. (Only Gmail is affected; the other inboxes still work.)`)] : []),
      ]);
      return { text: parts.join("\n\n") };
    }
    case "read_email": {
      if (!mailbox.isConfigured()) return { text: "Reading a whole message works with the inboxes connected under Email on the Connections page." };
      return { text: await mailbox.readMail(mailbox.pickAccount(input.account as string | undefined), Number(input.id)) };
    }
    case "propose_email": {
      const which = (input.account as string | undefined)?.trim();
      const viaGmail = which?.toLowerCase() === "gmail" || (!which && !mailbox.isConfigured());
      if (viaGmail && !workspace.isConfigured()) return { text: "No email account is connected to send from. Add one under Email on the Connections page, or sign in with Google." };
      const from = viaGmail ? "Gmail" : mailbox.pickAccount(which).address;
      const action = await createPendingAction({
        platform: "email",
        kind: viaGmail ? "send_email" : "mailbox_send",
        summary: `Email from ${from} to ${input.to} — "${input.subject}"\n\n${String(input.body).slice(0, 1500)}`,
        payload: { to: input.to, subject: input.subject, body: input.body, ...(viaGmail ? {} : { from, ...(input.in_reply_to ? { inReplyTo: input.in_reply_to } : {}) }) },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been sent yet.`, pendingAction: action };
    }
    case "get_calendar":
      return { text: reportToText(await workspace.getUpcomingEvents((input.days as number) || 7)) };
    case "propose_calendar_event": {
      const action = await createPendingAction({
        platform: "calendar",
        kind: "create_event",
        summary: `Calendar: "${input.summary}" at ${input.startIso}`,
        payload: {
          summary: input.summary,
          startIso: input.startIso,
          endIso: input.endIso,
          description: input.description,
          attendees: input.attendees,
        },
      });
      return { text: `Draft queued for your approval (id ${action.id}). The event has not been created yet.`, pendingAction: action };
    }
    case "search_drive":
      return { text: reportToText(await workspace.searchDrive(String(input.query ?? ""), (input.maxResults as number) || 10, input.kind === "image" ? "image" : "any")) };
    case "drive_photos": {
      const userId = currentUserOrThrow();
      const ids = Array.isArray(input.file_ids) ? input.file_ids.map(String) : [String(input.file_ids ?? "latest")];
      const files = await workspace.fetchDriveImages(ids);
      const saved = [];
      for (const f of files) saved.push(await savePhoto(userId, f.bytes, `From Drive: ${f.name}`));
      const request = String(input.request ?? "").trim();
      return {
        text: `Opened ${saved.length} from Drive (${files.map(f => f.name).join(", ")}); photo_ids ${JSON.stringify(saved.map(p => p.id))}. They come back to you attached to the next message, so you can see them, then carry on with the request. Reply with one short line in their language, e.g. "Got them — taking a look."`,
        clientAction: { type: "show_saved_photos", photos: saved.map(p => ({ id: p.id, url: p.url })), request: request || "Here are the pictures from my Drive — take a look." },
      };
    }

    case "get_crm_pipeline":
      return { text: reportToText(await crm.getPipeline()) };
    case "add_crm_lead":
      return { text: await crm.addLead((input.fields as Record<string, string>) ?? {}) };
    case "update_crm_stage":
      return { text: await crm.updateLeadStage({ name: input.name as string, stage: input.stage as string }) };

    case "get_revenue":
      return { text: reportToText(await finance.getRevenueReport((input.days as number) || 30)) };
    case "get_paypal_report":
      return { text: reportToText(await paypal.getPaypalReport((input.days as number) || 30)) };
    case "get_bank_report":
      return { text: reportToText(await bank.getBankReport((input.days as number) || 30)) };
    case "get_open_invoices":
      return { text: reportToText(await finance.getUpcomingInvoices()) };
    case "get_traffic":
      return { text: reportToText(await analytics.getTrafficReport((input.days as number) || 28)) };

    case "remember": {
      const category = (CATEGORIES as readonly string[]).includes(input.category as string) ? input.category as Category : "work";
      const fact = [input.topic, input.fact].filter(Boolean).join(": ");
      const saved = addMemory(currentUserOrThrow(), category, fact, "user");
      return { text: saved ? "Remembered." : "Not saved: it looked like a password or key, which are never kept in memory." };
    }
    case "recall": {
      const userId = currentUserOrThrow();
      const facts = await searchMemories(userId, input.query as string | undefined);
      const q = String(input.query ?? "").toLowerCase().split(/\W+/).filter(w => w.length > 2);
      const said = q.length ? recentTurns(userId, 400).filter(t => q.some(w => t.content.toLowerCase().includes(w))).slice(-8) : [];
      if (!facts.length && !said.length) return { text: "Nothing in memory about that." };
      return { text: [
        ...facts.map(f => `[${f.category}] ${f.fact} (${f.updatedAt.slice(0, 10)})`),
        ...(said.length ? ["", "From earlier conversation:", ...said.map(t => `${t.at.slice(0, 10)} ${t.role === "user" ? "User" : "You"}: ${t.content.slice(0, 300)}`)] : []),
      ].join("\n") };
    }
    case "forget": {
      const userId = currentUserOrThrow();
      const matches = await searchMemories(userId, String(input.query ?? ""));
      if (!input.query || !matches.length) return { text: "Nothing in memory matched that." };
      for (const m of matches) deleteMemory(userId, m.id);
      return { text: `Forgot ${matches.length}: ${matches.map(m => m.fact).join(" | ")}` };
    }

    case "list_projects": {
      if (HOSTED) {
        const listing = await onDevComputer("dev_projects", {}, 60_000);
        rememberProjectList(currentUserOrThrow(), listing);
        const current = currentProject(currentUserOrThrow());
        return { text: `${listing}${current ? `\n\nCurrent project: ${current}` : ""}` };
      }
      const projects = await listProjects();
      if (!projects.length) return { text: "Claude Code hasn't been used in any project on this Mac yet." };
      return { text: projects.map((p) => `${p.name} — ${p.path} (${p.source === "claude-code" ? "opened in Claude Code" : "found on this Mac"}, last active ${p.lastActive.slice(0, 10)})`).join("\n") };
    }
    case "ask_developer": {
      if (HOSTED) {
        const answer = await onDevComputer("dev_ask", { project: await projectOnComputer(input.project as string | undefined), task: input.task }, 5 * 60_000);
        noteProjectFrom(currentUserOrThrow(), answer);
        return { text: `Developer (Claude Code) on ${await devComputerName()}: ${answer}` };
      }
      const project = await resolveProject(input.project as string);
      if ("error" in project) return { text: project.error };
      const answer = await askDeveloper(project, input.task as string);
      const others = "alsoAt" in project && project.alsoAt?.length ? ` (used ${project.path}, the most recent; also at ${project.alsoAt.join(", ")})` : "";
      return { text: `Developer (Claude Code) on ${project.name}${others}:\n${answer}` };
    }

    case "propose_developer_task": {
      input.task = withPhotos(withDesigns(String(input.task ?? ""), input.design_ids), input.photo_ids);
      // Always, for every account: never push over someone else's work.
      input.task = `${input.task}\n\n${GIT_RULE}`;
      if (HOSTED) {
        const userId = currentUserOrThrow(), device = devComputer(userId);
        const project = await projectOnComputer(input.project as string | undefined);
        setCurrentProject(userId, project);
        const pending = await createPendingAction({ platform: "computer", kind: "device_command", summary: `Claude Code on ${device.name}, in ${project}: ${input.task}`, payload: { userId, deviceId: device.id, action: "dev_task", args: { project, task: input.task } } });
        return { text: `Task queued for approval (id ${pending.id}). Nothing has run yet; Claude Code on ${device.name} starts once it's approved.`, pendingAction: pending };
      }
      const project = await resolveProject(input.project as string);
      if ("error" in project) return { text: project.error };
      const task = input.task as string;
      const action = await createPendingAction({
        platform: "developer",
        kind: "developer_task",
        summary: `Claude Code in ${project.name} (${project.path.replace(/^\/Users\/[^/]+/, "~")}): ${task}`,
        payload: { path: project.path, task },
      });
      return { text: `Task queued for approval (id ${action.id}). Nothing has run yet; Claude Code starts once it's approved.`, pendingAction: action };
    }

    case "computer_list": {
      const devices = listDevices(currentUserOrThrow());
      return { text: devices.length ? devices.map(d => `${d.name} (${d.os}) — ${isOnline(d) ? "online" : "offline"}`).join("\n") : "No computer is linked yet. Link one on the Account page with the desktop app." };
    }
    case "computer_system_info": {
      const userId = currentUserOrThrow();
      // Named: that computer. Otherwise every online one, labelled, so "my laptop" isn't a guess.
      const devices = input.computer ? [pickDevice(userId, input.computer as string)] : listDevices(userId).filter(isOnline);
      if (!devices.length) return { text: listDevices(userId).length ? "None of the linked computers is online — start the desktop app on the one you mean." : "No computer is linked yet. Link one on the Account page with the desktop app." };
      const reports = await Promise.all(devices.map(async d => {
        const info = await runOnDevice(userId, d.id, "system_info", {}, 45_000).catch(err => `couldn't read it (${err instanceof Error ? err.message : err})`);
        const stale = !/^Battery:/m.test(info) && !/couldn't/.test(info) ? "\n(This computer's desktop app is out of date and can't read the battery — update it from the Download page.)" : "";
        return `${d.name} (${d.os}):\n${info}${stale}`;
      }));
      return { text: reports.join("\n\n") };
    }
    case "computer_open_app": {
      const userId = currentUserOrThrow(), device = pickDevice(userId, input.computer as string | undefined);
      return { text: `${device.name}: ${await runOnDevice(userId, device.id, "open_app", { name: input.name })}` };
    }
    case "computer_open_url": {
      const userId = currentUserOrThrow(), device = pickDevice(userId, input.computer as string | undefined);
      return { text: `${device.name}: ${await runOnDevice(userId, device.id, "open_url", { url: input.url, chrome_profile: input.chrome_profile })}` };
    }
    case "computer_run": {
      const userId = currentUserOrThrow(), device = pickDevice(userId, input.computer as string | undefined);
      const action = input.action as string;
      if (!["list_apps", "list_chrome_profiles", "set_volume", "media"].includes(action)) return { text: "Unknown action." };
      const args = action === "set_volume" ? { level: input.level } : action === "media" ? { action: input.media_action } : {};
      return { text: `${device.name}: ${await runOnDevice(userId, device.id, action, args)}` };
    }
    case "propose_computer_quit_app":
    case "propose_computer_power":
    case "propose_computer_script": {
      // Killing by a broad name takes down the editor, the desktop app itself and everything else built on Node.
      if (name === "propose_computer_script" && /\b(pkill|killall)\b[^\n]*\b(node|npm|npx|python|java|claude|electron|code)\b|\bkill\s+-9\s+-1\b/i.test(String(input.script ?? ""))) {
        return { text: "Refused: that script kills every program of that kind on the computer (the code editor, the desktop app, other projects). To stop one dev server, ask the Developer to stop that project's server by its port; a stuck Developer card closes by itself once its time limit passes." };
      }
      const userId = currentUserOrThrow(), device = pickDevice(userId, input.computer as string | undefined);
      const [action, args, summary] = name === "propose_computer_quit_app" ? ["quit_app", { name: input.name }, `Quit ${input.name} on ${device.name}`]
        : name === "propose_computer_power" ? ["power", { action: input.action }, `${String(input.action)[0].toUpperCase()}${String(input.action).slice(1)} ${device.name}`]
        : ["run_script", { script: input.script, language: input.language }, `On ${device.name} (${device.os}), ${String(input.language || "script")}: ${input.purpose}\n\n${input.script}`];
      const pending = await createPendingAction({ platform: "computer", kind: "device_command", summary: summary as string, payload: { userId, deviceId: device.id, action, args } });
      return { text: `Queued for approval (id ${pending.id}). Nothing has happened on ${device.name} yet.`, pendingAction: pending };
    }

    case "mac_system_info":
      return { text: await systemInfo() };
    case "mac_list_apps": {
      const apps = await listRunningApps();
      return { text: `In front: ${apps.frontmost}\nOpen: ${apps.running.join(", ")}` };
    }
    case "mac_open_app":
      return { text: await openApp(input.name as string) };
    case "mac_list_chrome_profiles":
      return { text: (await listChromeProfiles()).map(p => `${p.name}${p.email ? ` — ${p.email}` : ""}`).join("\n") };
    case "mac_open_url":
      return { text: await openUrl(input.url as string, { chromeProfile: input.chrome_profile as string | undefined, browser: input.browser as string | undefined }) };
    case "mac_list_chrome_tabs":
      return { text: await listChromeTabs() };
    case "mac_focus_chrome_tab":
      return { text: await focusChromeTab(Number(input.window), Number(input.tab)) };
    case "mac_set_volume": {
      const level = String(input.level).trim().toLowerCase();
      return { text: await setVolume(level === "mute" || level === "unmute" ? level : Number(level)) };
    }
    case "mac_media":
      return { text: await controlMediaApps(input.action as "pause" | "play" | "status") };
    case "propose_mac_quit_all_apps": {
      const action = await createPendingAction({ platform: "mac", kind: "mac_quit_all_apps", summary: "Quit all open apps on the Mac (Chrome and the editor/terminal Sarah runs in stay open)", payload: {} });
      return { text: `Queued for approval (id ${action.id}); nothing has been closed yet.`, pendingAction: action };
    }
    case "propose_mac_power": {
      const what = input.action as "restart" | "shut down" | "sleep";
      if (!["restart", "shut down", "sleep"].includes(what)) return { text: "action must be restart, shut down or sleep." };
      const action = await createPendingAction({ platform: "mac", kind: "mac_power", summary: `${what[0].toUpperCase()}${what.slice(1)} the Mac`, payload: { action: what } });
      return { text: `Queued for approval (id ${action.id}). The Mac won't ${what} until it's approved.`, pendingAction: action };
    }
    case "propose_mac_quit_app": {
      const action = await createPendingAction({ platform: "mac", kind: "mac_quit_app", summary: `Quit ${input.name} on the Mac`, payload: { name: input.name } });
      return { text: `Queued for approval (id ${action.id}); ${input.name} stays open until it's approved.`, pendingAction: action };
    }
    case "propose_mac_applescript": {
      const action = await createPendingAction({ platform: "mac", kind: "mac_applescript", summary: `On the Mac: ${input.purpose}\n\n${input.script}`, payload: { script: input.script } });
      return { text: `Queued for approval (id ${action.id}). Nothing has run yet.`, pendingAction: action };
    }

    case "name_project":
      if (HOSTED) {
        const folder = String(input.folder || "").trim();
        if (!folder) return { text: "Which folder is it?" };
        await saveProjectName(squashName(input.name as string), input.name as string, folder);
        return { text: `Saved: "${input.name}" is ${folder}.` };
      }
      return { text: await nameProject(input.name as string, input.folder as string) };

    case "search_claude_chats": {
      if (HOSTED) return { text: `Developer (Claude Code) on past chats, on ${await devComputerName()}:\n${await onDevComputer("dev_chats", { task: input.task }, 5 * 60_000)}` };
      const answer = await askAboutChats(input.task as string);
      return { text: `Developer (Claude Code) on past chats:\n${answer}` };
    }

    case "web_search":
      return { text: await searchWeb(String(input.query || "").slice(0, 500)) };
    case "analyze_market": {
      const userId = currentUserOrThrow();
      const a = await analyze(String(input.symbol ?? ""), input.market as "crypto" | "forex" | "stock" | undefined);
      let text = `${describeAnalysis(a)}\n(Analysis, not a guarantee: no one is right every time.)`;
      if (input.trade === true) {
        if (getSettings(userId).mode === "off") text += "\nNot traded: the autopilot is off. Turn on paper trading, or live trading on the Trading card.";
        else text += `\n${await openFromAnalysis(userId, a)}`;
      }
      return { text };
    }
    case "trading_status":
      return { text: await statusText(currentUserOrThrow()) };
    case "set_trading": {
      const userId = currentUserOrThrow();
      const current = getSettings(userId);
      const brokers = { ...current.brokers };
      if (input.stock_broker) brokers.stock = input.stock_broker as BrokerId;
      if (input.forex_broker) brokers.forex = input.forex_broker as BrokerId;
      if (input.mode === "live") return { text: "Real-money trading is switched on only from the Trading agent card, where the user confirms the risk. Tell them to open it." };
      const s = updateSettings(userId, {
        mode: input.mode as Mode | undefined, riskPct: input.risk_pct as number | undefined, dailyLossPct: input.daily_loss_pct as number | undefined,
        maxPositions: input.max_positions as number | undefined, minConfidence: input.min_confidence as number | undefined,
        intervalMin: input.interval_min as number | undefined, watchlist: input.watchlist as string[] | undefined, brokers,
      });
      return { text: `Saved. Autopilot ${s.mode === "off" ? "is OFF" : s.mode === "paper" ? "trades with practice money" : "trades with REAL money"}; risk ${s.riskPct}% per trade, daily loss limit ${s.dailyLossPct}%, up to ${s.maxPositions} positions, confidence ≥ ${s.minConfidence}%, every ${s.intervalMin} min; watching ${s.watchlist.join(", ")}.${input.mode === "off" ? " Open trades keep their stops and targets; say \"close all trades\" to exit them now." : ""}` };
    }
    case "close_trade":
      return { text: await closeTrades(currentUserOrThrow(), String(input.which ?? "")) };
    case "trading_scan_now": {
      const userId = currentUserOrThrow();
      if (getSettings(userId).mode === "off") return { text: "The autopilot is off; turn on paper trading first (or live on the Trading card)." };
      const notes = await scan(userId, true);
      return { text: notes.length ? notes.join("\n") : "Scanned the watchlist: no market has a setup worth trading right now." };
    }
    case "show_photo": {
      const camera = input.camera === "front" ? "front" : "back";
      return {
        text: "The deck is taking the photo now; it comes back to you with the request in the next message. Reply with one short line in their language, e.g. \"Hold it steady — taking the photo.\"",
        clientAction: { type: "show_photo", camera, request: String(input.request ?? "").trim() },
      };
    }
    case "design_picture": {
      const useCamera = input.use_camera === true;
      const instruction = String(input.instruction ?? "").trim();
      const references = useCamera ? [] : pickPhotos(currentUserOrThrow(), input.photo_ids).map(p => p.id);
      if (references.length) return {
        text: `Design is making the picture now from ${references.length === 1 ? "the photo" : `the ${references.length} photos`} as reference; the result appears on the user's screen. Reply with one short line in their language.`,
        clientAction: { type: "design_picture", useCamera: false, instruction, photoIds: references },
      };
      return {
        text: `${useCamera ? "The deck is taking the photo now and Design will work on it" : "Design is making the picture now"}; the result appears on the user's screen. Reply with one short line in their language, e.g. "On it — taking your photo now."`,
        clientAction: { type: "design_picture", useCamera, instruction },
      };
    }

    case "set_agent_engine": {
      const userId = currentUserOrThrow();
      const engine = input.engine === "claude-code" ? "claude-code" : "gemini";
      setAgentEngine(userId, String(input.agent), engine);
      const who = input.agent === "all" ? "Every agent" : SPECIALISTS[String(input.agent)]?.name ?? String(input.agent);
      const reach = engine === "claude-code" ? (listDevices(userId).length ? " It runs through the desktop app on their computer, which needs to be on." : " No computer is linked yet: they need the desktop app (Download page) signed in on the computer with Claude Code.") : "";
      return { text: `Saved: ${who} now uses ${ENGINES[engine]} from now on.${reach}` };
    }
    case "ask_specialist": {
      const role = input.role as string;
      if (!SPECIALISTS[role]) return { text: `Unknown specialist "${role}". Available: ${specialistKeys().join(", ")}.` };
      const photos = pickPhotos(currentUserOrThrow(), input.photo_ids);
      const answer = await askSpecialist(role, input.request as string, input.context as string | undefined, photos);
      return { text: `${SPECIALISTS[role].name} says:\n${answer}` };
    }

    default:
      return { text: `Unknown tool: ${name}` };
  }
}
