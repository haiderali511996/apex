import type { ConnectorStatus } from "../types";
import * as searchConsole from "./googleSearchConsole";
import * as meta from "./meta";
import * as youtube from "./youtube";
import * as x from "./x";
import * as tiktok from "./tiktok";

export { searchConsole, meta, youtube, x, tiktok };

export function allConnectorStatuses(): ConnectorStatus[] {
  return [searchConsole.status(), meta.status(), youtube.status(), x.status(), tiktok.status()];
}
