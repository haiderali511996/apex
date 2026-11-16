import type { ConnectorStatus } from "../types";
import * as searchConsole from "./googleSearchConsole";
import * as meta from "./meta";
import * as youtube from "./youtube";
import * as x from "./x";
import * as tiktok from "./tiktok";
import * as workspace from "./google";
import * as crm from "./sheetsCrm";
import * as finance from "./stripe";
import * as paypal from "./paypal";
import * as bank from "./wise";
import * as analytics from "./analytics";
import * as mailbox from "./mailbox";

export { searchConsole, meta, youtube, x, tiktok, workspace, crm, finance, paypal, bank, analytics };

export function allConnectorStatuses(): ConnectorStatus[] {
  // Every inbox under Email on the Connections page (any provider), one line
  // each, so "what's connected?" names them and not only Gmail.
  const inboxes: ConnectorStatus[] = mailbox.addresses().map(address => ({ platform: "email", label: `Email inbox ${address}`, configured: true, missingEnv: [], capabilities: ["read", "write"] }));
  return [
    ...inboxes,
    searchConsole.status(),
    meta.status(),
    youtube.status(),
    x.status(),
    tiktok.status(),
    ...workspace.status(),
    crm.status(),
    finance.status(),
    paypal.status(),
    bank.status(),
    analytics.status(),
  ];
}
