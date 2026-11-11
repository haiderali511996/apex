// Copies the website's desktop action list into the app, so both run the exact same, fixed set of actions.
import { copyFileSync } from "node:fs";
copyFileSync(new URL("../../public/downloads/sarah-desktop.mjs", import.meta.url), new URL("../src/actions.mjs", import.meta.url));
console.log("actions.mjs updated");
