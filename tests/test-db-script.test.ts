import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/test-db.sh", import.meta.url));

describe("scripts/test-db.sh", () => {
  it("gets past its setup on macOS's bash 3.2 (an empty RUN_AS list under set -u)", () => {
    // PGBIN is an empty folder, so the script stops at initdb either way. The bug made it stop
    // one step earlier with "RUN_AS[@]: unbound variable" (bash older than 4.4 only).
    const pgbin = mkdtempSync(join(tmpdir(), "no-postgres-"));
    try {
      const r = spawnSync("bash", [script], { env: { ...process.env, PGBIN: pgbin }, encoding: "utf8" });
      expect(r.stderr).not.toContain("unbound variable");
      expect(r.stderr).toContain(`${pgbin}/initdb`);
    } finally {
      rmSync(pgbin, { recursive: true, force: true });
    }
  });
});
