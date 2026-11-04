import { meta, x, tiktok, workspace } from "./connectors";
import { appendActionLog } from "./store";
import { runDeveloperTask } from "./developer";
import { power, quitAllApps, quitApp, runAppleScript } from "./mac";
import { runOnDevice } from "@/lib/devices";
import { currentUserId } from "@/lib/credentials";
import type { PendingAction } from "./types";

/** Runs the real, irreversible platform call for an approved pending action. Only call this after the user has explicitly confirmed. */
export async function runPendingAction(action: PendingAction): Promise<string> {
  let result: string;
  try {
    // These act on the machine the server runs on, which is only the owner's own when that's their Mac.
    if ((/^mac_/.test(action.kind) || action.kind === "developer_task") && process.platform !== "darwin") {
      throw new Error("This runs on the server's own computer, which isn't yours here. Use the desktop app instead.");
    }
    switch (action.kind) {
      case "facebook_post":
        result = await meta.publishFacebookPost(action.payload as { message: string; link?: string; imageUrl?: string });
        break;
      case "instagram_post":
        result = await meta.publishInstagramPost(action.payload as { imageUrl: string; caption: string });
        break;
      case "tweet":
        result = await x.publishTweet(action.payload as { text: string; imageUrl?: string });
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
      case "developer_task": {
        const { path, task } = action.payload as { path: string; task: string };
        result = await runDeveloperTask(path, task);
        break;
      }
      case "mac_quit_app":
        result = await quitApp((action.payload as { name: string }).name);
        break;
      case "device_command": {
        const { userId, deviceId, action: what, args } = action.payload as { userId: string; deviceId: string; action: string; args: Record<string, unknown> };
        // Approvals live in each account's own store; this is a second lock.
        if (userId !== currentUserId()) throw new Error("This action belongs to another account.");
        // A restart may cut the connection before the answer comes back.
        result = await runOnDevice(userId, deviceId, what, args, what === "power" ? 15_000 : 60_000).catch(err => {
          if (what === "power") return "Sent to the computer.";
          throw err;
        });
        break;
      }
      case "mac_quit_all_apps":
        result = await quitAllApps();
        break;
      case "mac_power":
        result = await power((action.payload as { action: "restart" | "shut down" | "sleep" }).action);
        break;
      case "mac_applescript":
        result = await runAppleScript((action.payload as { script: string }).script);
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
