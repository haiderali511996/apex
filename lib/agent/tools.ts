import type Anthropic from "@anthropic-ai/sdk";
import {
  searchConsole, meta, youtube, x, tiktok,
  workspace, crm, finance, paypal, bank, analytics,
  allConnectorStatuses,
} from "./connectors";
import { createPendingAction, listPendingActions, listActionLog, rememberFact, recallFacts } from "./store";
import { askSpecialist } from "./specialist";
import { SPECIALISTS, specialistKeys } from "./roles";
import { askAboutChats, askDeveloper, listProjects, nameProject, resolveProject } from "./developer";
import { isOnline, listDevices, pickDevice, runOnDevice } from "@/lib/devices";
import { currentUserId } from "@/lib/credentials";
import { controlMediaApps, focusChromeTab, systemInfo, listChromeProfiles, listChromeTabs, listRunningApps, openApp, openUrl, setVolume } from "./mac";
import type { ClientAction, PendingAction, Report } from "./types";

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
    name: "propose_facebook_post",
    description: "Draft a Facebook Page post for the user to review and approve. This does NOT publish anything — it only queues the post for the user to confirm in the UI.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Post text." },
        link: { type: "string", description: "Optional link to attach." },
      },
      required: ["message"],
    },
  },
  {
    name: "propose_instagram_post",
    description: "Draft an Instagram post (image + caption) for the user to review and approve. Does NOT publish anything.",
    input_schema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "Publicly reachable image URL." },
        caption: { type: "string" },
      },
      required: ["imageUrl", "caption"],
    },
  },
  {
    name: "propose_tweet",
    description: "Draft a post on X for the user to review and approve. Does NOT publish anything.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "Tweet text, max 280 chars." } },
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
    description: "Read the user's unread Gmail inbox — senders, subjects and snippets. Use for inbox triage.",
    input_schema: {
      type: "object",
      properties: { maxResults: { type: "number", description: "How many unread messages. Default 10." } },
    },
  },
  {
    name: "search_email",
    description: "Search the user's Gmail with a Gmail search query (e.g. 'from:client@x.com newer_than:7d').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search syntax." },
        maxResults: { type: "number" },
      },
      required: ["query"],
    },
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
    description: "Search the user's Google Drive for files by name.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match in the file name." },
        maxResults: { type: "number" },
      },
      required: ["query"],
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
        topic: { type: "string", description: "Short subject, e.g. a client or project name." },
        fact: { type: "string", description: "The thing to remember." },
      },
      required: ["topic", "fact"],
    },
  },
  {
    name: "recall",
    description: "Look up previously stored facts. Call this when the user references past decisions, clients or history.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Optional filter. Omit to list everything remembered." } },
    },
  },

  /* ── Developer: Claude Code on this Mac ── */
  {
    name: "list_projects",
    description: "List the code projects on this Mac, most recently active first: ones Haider has opened in Claude Code, plus project folders found in his home, Desktop, Documents, Downloads and code folders. Call this when he asks what projects exist, or before ask_developer when unsure of a name.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "ask_developer",
    description: "Hand a question about one of the user's code projects to the Developer agent — Claude Code running on this Mac. It reads and searches the project's files and answers: what a project does, where something is implemented, how a feature works, what's unfinished, or a code review. It cannot change files. It can take a minute, so tell the user you're checking first.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name (as spoken is fine), or a folder path inside his home folder." },
        task: { type: "string", description: "The question or task, written out in full for a developer who hasn't heard the conversation." },
      },
      required: ["project", "task"],
    },
  },

  {
    name: "propose_developer_task",
    description: "Queue a task for the Developer (Claude Code on this Mac) that runs terminal commands or changes files in a project — git pull, installing dependencies, running tests or the build, fixing a bug, making an edit. Nothing runs until Haider approves it in the UI; then Claude Code does it with the terminal and reports back. Use this instead of telling Haider to run commands himself.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name (as spoken is fine), or a folder path inside his home folder." },
        task: { type: "string", description: "Exactly what to do, written out in full, e.g. \"Run git pull origin main and report what changed.\"" },
      },
      required: ["project", "task"],
    },
  },
  {
    name: "name_project",
    description: "Save what Haider calls a project (e.g. \"Lifemed Live\", as pinned in his Claude app) and which folder it is, once he confirms it, so the name works directly next time.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name Haider uses." },
        folder: { type: "string", description: "The folder: a path, or a folder name from list_projects." },
      },
      required: ["name", "folder"],
    },
  },
  {
    name: "search_claude_chats",
    description: "Ask the Developer (Claude Code) about Haider's past Claude Code chats, across all projects: what was discussed, decided, built or left unfinished, and when. Use when he mentions a previous chat or session, or asks what he worked on. Read-only; can take a minute.",
    input_schema: {
      type: "object",
      properties: { task: { type: "string", description: "What to find or summarize, written out in full." } },
      required: ["task"],
    },
  },

  /* ── Design: Gemini pictures, carried out on Haider's screen ── */
  {
    name: "design_picture",
    description: "Hand a picture request to the Design agent on Haider's screen. With use_camera true, the deck takes a photo with his webcam right now and Design edits it per the instruction (leave the instruction empty to just take the photo). With use_camera false, Design makes a new picture from the instruction — a logo, poster, illustration. Use this whenever he asks for a photo, picture, selfie, image or design, in any wording or language — you do have a camera through this tool.",
    input_schema: {
      type: "object",
      properties: {
        use_camera: { type: "boolean", description: "True to take a photo with the webcam first." },
        instruction: { type: "string", description: "What Design should make or change, in his words. Empty to just take a photo." },
      },
      required: ["use_camera", "instruction"],
    },
  },

  /* ── Specialists ── */
  {
    name: "ask_specialist",
    description: `Delegate to a focused specialist for thinking, writing or planning work: ${specialistKeys().join(", ")}. Use this for strategy, research, editing, sales copy, campaign planning, quotes/scoping, fabrication advice, or design direction. Fetch any live data first and pass it in as context.`,
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", enum: specialistKeys(), description: "Which specialist to ask." },
        request: { type: "string", description: "What you need from them." },
        context: { type: "string", description: "Any live data or background they should work from." },
      },
      required: ["role", "request"],
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
    input_schema: { type: "object", properties: { computer: { type: "string", description: "Optional: the computer's name or system (Windows, macOS, Linux)." } } },
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
    description: "List the apps open on Haider's MacBook right now, and which one is in front.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mac_open_app",
    description: "Open (or bring to the front) an app on the Mac by name, e.g. \"Google Chrome\", \"Finder\", \"Visual Studio Code\", \"WhatsApp\".",
    input_schema: { type: "object", properties: { name: { type: "string", description: "The app's name as macOS knows it." } }, required: ["name"] },
  },
  {
    name: "mac_list_chrome_profiles",
    description: "List Haider's Chrome profiles with their names and email addresses. Several share a name (two \"Haider\", two \"Work\"), so check this before opening a profile he names loosely.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "mac_open_url",
    description: "Open a website on the Mac. Give chrome_profile (its name or email) to open it in that Chrome profile — e.g. Gmail is https://mail.google.com in the profile whose inbox he wants. Without it, the site opens in the default browser.",
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
    description: "Queue quitting every open app on the Mac (keeping Chrome and the editor/terminal Sarah runs in). Nothing happens until Haider approves it in the UI.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_mac_power",
    description: "Queue restarting, shutting down or sleeping the Mac. Nothing happens until Haider approves it in the UI; on restart or shut down, apps are asked to quit first so unsaved work prompts to save.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: ["restart", "shut down", "sleep"] } }, required: ["action"] },
  },
  {
    name: "propose_mac_quit_app",
    description: "Queue quitting an app on the Mac. It may lose unsaved work, so nothing happens until Haider approves it in the UI.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "propose_mac_applescript",
    description: "For any other Mac task the tools above can't do (Finder, System Settings, Notes, Reminders, window layout, clicking in an app…): write an AppleScript that does it and queue it. Nothing runs until Haider reads and approves it in the UI. Keep the script short and focused on exactly what he asked. It must be real AppleScript, never a bare shell command (wrap any shell command in do shell script \"…\"). Never use this for specs, hardware or battery questions — mac_system_info answers those at once.",
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

function currentUserOrThrow(): string {
  const id = currentUserId();
  if (!id) throw new Error("No signed-in account for this request.");
  return id;
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolRunResult> {
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
    case "propose_facebook_post": {
      const action = await createPendingAction({
        platform: "meta",
        kind: "facebook_post",
        summary: `Post to Facebook Page: "${input.message}"`,
        payload: { message: input.message, link: input.link },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been posted yet.`, pendingAction: action };
    }
    case "propose_instagram_post": {
      const action = await createPendingAction({
        platform: "meta",
        kind: "instagram_post",
        summary: `Post to Instagram: "${input.caption}"`,
        payload: { imageUrl: input.imageUrl, caption: input.caption },
      });
      return { text: `Draft queued for your approval (id ${action.id}). Nothing has been posted yet.`, pendingAction: action };
    }
    case "propose_tweet": {
      const action = await createPendingAction({
        platform: "x",
        kind: "tweet",
        summary: `Post to X: "${input.text}"`,
        payload: { text: input.text },
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
      return { text: reportToText(await workspace.getInboxSummary((input.maxResults as number) || 10)) };
    case "search_email":
      return { text: reportToText(await workspace.searchEmail(input.query as string, (input.maxResults as number) || 10)) };
    case "propose_email": {
      const action = await createPendingAction({
        platform: "email",
        kind: "send_email",
        summary: `Email ${input.to} — "${input.subject}"`,
        payload: { to: input.to, subject: input.subject, body: input.body },
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
      return { text: reportToText(await workspace.searchDrive(input.query as string, (input.maxResults as number) || 10)) };

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
      const entry = await rememberFact(input.topic as string, input.fact as string);
      return { text: `Remembered under "${entry.topic}".` };
    }
    case "recall": {
      const facts = await recallFacts(input.query as string | undefined);
      if (!facts.length) return { text: "Nothing remembered on that yet." };
      return { text: facts.map((f) => `[${f.topic}] ${f.fact} (noted ${f.at.slice(0, 10)})`).join("\n") };
    }

    case "list_projects": {
      const projects = await listProjects();
      if (!projects.length) return { text: "Claude Code hasn't been used in any project on this Mac yet." };
      return { text: projects.map((p) => `${p.name} — ${p.path} (${p.source === "claude-code" ? "opened in Claude Code" : "found on this Mac"}, last active ${p.lastActive.slice(0, 10)})`).join("\n") };
    }
    case "ask_developer": {
      const project = await resolveProject(input.project as string);
      if ("error" in project) return { text: project.error };
      const answer = await askDeveloper(project, input.task as string);
      const others = "alsoAt" in project && project.alsoAt?.length ? ` (used ${project.path}, the most recent; also at ${project.alsoAt.join(", ")})` : "";
      return { text: `Developer (Claude Code) on ${project.name}${others}:\n${answer}` };
    }

    case "propose_developer_task": {
      const project = await resolveProject(input.project as string);
      if ("error" in project) return { text: project.error };
      const task = input.task as string;
      const action = await createPendingAction({
        platform: "developer",
        kind: "developer_task",
        summary: `Claude Code in ${project.name} (${project.path.replace(/^\/Users\/[^/]+/, "~")}): ${task}`,
        payload: { path: project.path, task },
      });
      return { text: `Task queued for Haider's approval (id ${action.id}). Nothing has run yet; Claude Code starts once he approves it.`, pendingAction: action };
    }

    case "computer_list": {
      const devices = listDevices(currentUserOrThrow());
      return { text: devices.length ? devices.map(d => `${d.name} (${d.os}) — ${isOnline(d) ? "online" : "offline"}`).join("\n") : "No computer is linked yet. Link one on the Account page with the desktop app." };
    }
    case "computer_system_info": {
      const userId = currentUserOrThrow(), device = pickDevice(userId, input.computer as string | undefined);
      return { text: `${device.name}:\n${await runOnDevice(userId, device.id, "system_info", {}, 45_000)}` };
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
      return { text: `Queued for Haider's approval (id ${action.id}); nothing has been closed yet.`, pendingAction: action };
    }
    case "propose_mac_power": {
      const what = input.action as "restart" | "shut down" | "sleep";
      if (!["restart", "shut down", "sleep"].includes(what)) return { text: "action must be restart, shut down or sleep." };
      const action = await createPendingAction({ platform: "mac", kind: "mac_power", summary: `${what[0].toUpperCase()}${what.slice(1)} the Mac`, payload: { action: what } });
      return { text: `Queued for Haider's approval (id ${action.id}). The Mac won't ${what} until he approves.`, pendingAction: action };
    }
    case "propose_mac_quit_app": {
      const action = await createPendingAction({ platform: "mac", kind: "mac_quit_app", summary: `Quit ${input.name} on the Mac`, payload: { name: input.name } });
      return { text: `Queued for Haider's approval (id ${action.id}); ${input.name} stays open until he approves.`, pendingAction: action };
    }
    case "propose_mac_applescript": {
      const action = await createPendingAction({ platform: "mac", kind: "mac_applescript", summary: `On the Mac: ${input.purpose}\n\n${input.script}`, payload: { script: input.script } });
      return { text: `Queued for Haider's approval (id ${action.id}). Nothing has run yet.`, pendingAction: action };
    }

    case "name_project":
      return { text: await nameProject(input.name as string, input.folder as string) };

    case "search_claude_chats": {
      const answer = await askAboutChats(input.task as string);
      return { text: `Developer (Claude Code) on past chats:\n${answer}` };
    }

    case "design_picture": {
      const useCamera = input.use_camera === true;
      const instruction = String(input.instruction ?? "").trim();
      return {
        text: `${useCamera ? "The deck is taking the photo now and Design will work on it" : "Design is making the picture now"}; the result appears on Haider's screen. Reply with one short line in his language, e.g. "On it — taking your photo now."`,
        clientAction: { type: "design_picture", useCamera, instruction },
      };
    }

    case "ask_specialist": {
      const role = input.role as string;
      if (!SPECIALISTS[role]) return { text: `Unknown specialist "${role}". Available: ${specialistKeys().join(", ")}.` };
      const answer = await askSpecialist(role, input.request as string, input.context as string | undefined);
      return { text: `${SPECIALISTS[role].name} says:\n${answer}` };
    }

    default:
      return { text: `Unknown tool: ${name}` };
  }
}
