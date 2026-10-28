import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
// made by installs and builds, so a fresh checkout doesn't have them
const generated = new Set(["node_modules", ".next", "next-env.d.ts", "tsconfig.tsbuildinfo"]);

describe("fresh checkout", () => {
  it("passes npx tsc --noEmit right after the install step", () => {
    const dir = mkdtempSync(join(tmpdir(), "fresh-checkout-"));
    try {
      cpSync(root, dir, { recursive: true, filter: (src) => !generated.has(basename(src)) });
      symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
      const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
      // what `npm install` runs once packages are in place (no download needed here)
      const install = spawnSync("npm", ["run", "--if-present", "postinstall"], { cwd: dir, env, encoding: "utf8" });
      const tsc = spawnSync("npx", ["tsc", "--noEmit"], { cwd: dir, env, encoding: "utf8" });
      expect(tsc.status, install.stdout + install.stderr + tsc.stdout + tsc.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
