import type Anthropic from "@anthropic-ai/sdk";
import {
  searchConsole, meta, youtube, x, tiktok,
  workspace, crm, finance, analytics,
  allConnectorStatuses,
} from "./connectors";
import { createPendingAction, listPendingActions, listActionLog, rememberFact, recallFacts } from "./store";
import { askSpecialist } from "./specialist";
import { SPECIALISTS, specialistKeys } from "./roles";
import type { PendingAction, Report } from "./types";

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
];

function reportToText(r: Report): string {
  const metrics = r.metrics.map((m) => `${m.label}: ${m.value}`).join(", ");
  const notes = r.notes?.length ? `\nNotes: ${r.notes.join(" | ")}` : "";
  return `${r.title} (${r.rangeLabel}) — ${metrics}${notes}`;
}

export type ToolRunResult = { text: string; pendingAction?: PendingAction };

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
