import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const gitignore = fileURLToPath(new URL("../.gitignore", import.meta.url));

// The README's setup starts with `cp .env.example .env.local`, so the example must reach a git clone.
describe(".gitignore", () => {
  it("keeps .env.example in git and still ignores real env files", () => {
    const repo = mkdtempSync(join(tmpdir(), "gitignore-"));
    try {
      spawnSync("git", ["init", "-q"], { cwd: repo });
      copyFileSync(gitignore, join(repo, ".gitignore"));
      const ignored = (f: string) => spawnSync("git", ["check-ignore", "-q", f], { cwd: repo }).status === 0;
      expect(ignored(".env.example")).toBe(false);
      expect(ignored(".env.local")).toBe(true);
      expect(ignored(".env")).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
