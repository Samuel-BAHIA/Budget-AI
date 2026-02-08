import fs from "fs";
import path from "path";

const targets = [".next", "out", ".turbo"];
for (const t of targets) {
  const p = path.join(process.cwd(), t);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    console.log(`Removed ${t}`);
  }
}
