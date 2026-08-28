import type Anthropic from "@anthropic-ai/sdk";
import { searchConsole, meta, youtube, x, tiktok, allConnectorStatuses } from "./connectors";
import { createPendingAction, listPendingActions, listActionLog } from "./store";
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
    default:
      return { text: `Unknown tool: ${name}` };
  }
}
