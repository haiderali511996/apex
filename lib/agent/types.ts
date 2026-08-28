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
  | "analytics";

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
