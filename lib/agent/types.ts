export type Platform =
  | "search_console"
  | "meta"
  | "youtube"
  | "x"
  | "tiktok"
  | "email"
  | "calendar"
  | "drive"
  | "crm"
  | "finance"
  | "analytics"
  | "developer"
  | "mac"
  | "computer";

export type ConnectorStatus = {
  platform: Platform;
  label: string;
  configured: boolean;
  missingEnv: string[];
  capabilities: ("read" | "write")[];
};

export type ReportMetric = {
  label: string;
  value: string | number;
  change?: string;
};

export type Report = {
  platform: Platform;
  title: string;
  rangeLabel: string;
  metrics: ReportMetric[];
  notes?: string[];
  fetchedAt: string;
};

export type PendingAction = {
  id: string;
  platform: Platform;
  kind: string;
  summary: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  result?: string;
};

export type ActionLogEntry = {
  id: string;
  platform: Platform;
  kind: string;
  summary: string;
  outcome: "success" | "failure";
  detail?: string;
  at: string;
};

/**
 * Something only the browser can do — use the camera, show a picture — that a
 * tool asks the deck to carry out after the reply arrives.
 */
export type ClientAction =
  | { type: "design_picture"; useCamera: boolean; instruction: string; photoIds?: string[] }
  /** Pictures saved from elsewhere (Drive): shown in the chat, then `request` is sent with them so Sarah sees them. */
  | { type: "show_saved_photos"; photos: { id: string; url: string }[]; request: string }
  /** Take a photo so Sarah (and the agent she hands it to) can see something; then `request` is sent with it. */
  | { type: "show_photo"; camera: "front" | "back"; request: string };
