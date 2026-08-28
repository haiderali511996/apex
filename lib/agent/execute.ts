import { meta, x, tiktok, workspace } from "./connectors";
import { appendActionLog } from "./store";
import type { PendingAction } from "./types";

/** Runs the real, irreversible platform call for an approved pending action. Only call this after the user has explicitly confirmed. */
export async function runPendingAction(action: PendingAction): Promise<string> {
  let result: string;
  try {
    switch (action.kind) {
      case "facebook_post":
        result = await meta.publishFacebookPost(action.payload as { message: string; link?: string });
        break;
      case "instagram_post":
        result = await meta.publishInstagramPost(action.payload as { imageUrl: string; caption: string });
        break;
      case "tweet":
        result = await x.publishTweet(action.payload as { text: string });
        break;
      case "tiktok_post":
        result = await tiktok.publishTiktokVideo(action.payload as { videoUrl: string; caption: string });
        break;
      case "send_email":
        result = await workspace.sendEmail(action.payload as { to: string; subject: string; body: string });
        break;
      case "create_event":
        result = await workspace.createCalendarEvent(
          action.payload as { summary: string; startIso: string; endIso: string; description?: string; attendees?: string[] }
        );
        break;
      default:
        throw new Error(`Unknown action kind: ${action.kind}`);
    }
    await appendActionLog({ platform: action.platform, kind: action.kind, summary: action.summary, outcome: "success", detail: result });
    return result;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await appendActionLog({ platform: action.platform, kind: action.kind, summary: action.summary, outcome: "failure", detail });
    throw err;
  }
}
