// Copies dist/PixeloramaMCP.zip into Pixelorama's extensions folder.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const zip = join(root, "dist", "PixeloramaMCP.zip");

function dataDir() {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support");
    case "win32":
      return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    default:
      return process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  }
}

if (!existsSync(zip)) {
  console.error("dist/PixeloramaMCP.zip is missing. Run npm run build first.");
  process.exit(1);
}

const target = join(dataDir(), "pixelorama", "extensions");
mkdirSync(target, { recursive: true });
copyFileSync(zip, join(target, "PixeloramaMCP.zip"));
console.log(`Installed to ${target}`);
console.log("Restart Pixelorama and enable Pixelorama MCP in Preferences > Extensions.");
