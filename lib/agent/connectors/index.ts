import type { ConnectorStatus } from "../types";
import * as searchConsole from "./googleSearchConsole";
import * as meta from "./meta";
import * as youtube from "./youtube";
import * as x from "./x";
import * as tiktok from "./tiktok";
import * as workspace from "./google";
import * as crm from "./sheetsCrm";
import * as finance from "./stripe";
import * as analytics from "./analytics";

export { searchConsole, meta, youtube, x, tiktok, workspace, crm, finance, analytics };

export function allConnectorStatuses(): ConnectorStatus[] {
  return [
    searchConsole.status(),
    meta.status(),
    youtube.status(),
    x.status(),
    tiktok.status(),
    ...workspace.status(),
    crm.status(),
    finance.status(),
    analytics.status(),
  ];
}
