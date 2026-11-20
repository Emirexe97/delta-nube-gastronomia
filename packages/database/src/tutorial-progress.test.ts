import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import { SqliteGastronomyRepository } from "./sqlite-repository";
import { assertTutorialProgressInput } from "@gastronomy/contracts";

test("tutorial contract rejects malformed payloads and client-supplied identity", () => {
  for (const invalid of [
    null,
    [],
    {},
    { version: 2, status: "SKIPPED", stepId: "welcome" },
    { version: 1, status: ["COMPLETED"], stepId: "finish" },
    {
      version: 1,
      status: "SKIPPED",
      stepId: "welcome",
      accountKey: "another-account",
    },
    {
      version: 1,
      status: "SKIPPED",
      stepId: "welcome",
      userId: "another-user",
    },
  ]) {
    assert.throws(() => assertTutorialProgressInput(invalid));
  }
});

test("tutorial progress defaults, persists per account, validates input, and writes no business records", () => {
  const path = join(tmpdir(), `gastronomy-tutorial-${randomUUID()}.sqlite`);
  let repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: true });
  try {
    assert.deepEqual(repo.getTutorialProgress(), {
      version: 1,
      status: "NOT_STARTED",
      stepId: "welcome",
    });
    const initialOrders = Number(
      (repo.db.prepare("SELECT COUNT(*) n FROM orders").get() as any).n,
    );
    const initialAudit = Number(
      (repo.db.prepare("SELECT COUNT(*) n FROM audit_log").get() as any).n,
    );
    for (const [status, stepId] of [
      ["IN_PROGRESS", "order"],
      ["SKIPPED", "preparation"],
      ["COMPLETED", "finish"],
    ] as const) {
      assert.deepEqual(
        repo.saveTutorialProgress({ version: 1, status, stepId }),
        { version: 1, status, stepId },
      );
    }
    assert.deepEqual(repo.getTutorialProgress("account:other@example.com"), {
      version: 1,
      status: "NOT_STARTED",
      stepId: "welcome",
    });
    repo.saveTutorialProgress(
      { version: 1, status: "SKIPPED", stepId: "payment" },
      " account:OTHER@example.com ",
    );
    assert.equal(
      repo.getTutorialProgress("account:other@example.com").stepId,
      "payment",
    );
    assert.throws(() =>
      repo.saveTutorialProgress({
        version: 1,
        status: "NOT_STARTED",
        stepId: "welcome",
      } as any),
    );
    assert.throws(() =>
      repo.saveTutorialProgress({
        version: 1,
        status: "COMPLETED",
        stepId: "nope",
      } as any),
    );
    assert.deepEqual(repo.getTutorialProgress(), {
      version: 1,
      status: "COMPLETED",
      stepId: "finish",
    });
    assert.equal(
      Number((repo.db.prepare("SELECT COUNT(*) n FROM orders").get() as any).n),
      initialOrders,
    );
    assert.equal(
      Number(
        (repo.db.prepare("SELECT COUNT(*) n FROM audit_log").get() as any).n,
      ),
      initialAudit,
    );
  } finally {
    repo.close();
  }
  repo = new SqliteGastronomyRepository(path, { seedStarterCatalog: true });
  try {
    assert.deepEqual(repo.getTutorialProgress(), {
      version: 1,
      status: "COMPLETED",
      stepId: "finish",
    });
    assert.deepEqual(repo.getTutorialProgress("account:other@example.com"), {
      version: 1,
      status: "SKIPPED",
      stepId: "payment",
    });
  } finally {
    repo.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  }
});
