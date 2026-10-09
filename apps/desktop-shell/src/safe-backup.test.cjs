const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { createValidatedBackup } = require("./safe-backup.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "safe-backup-test-"));
  t.after(() => {
    if (
      !path
        .resolve(root)
        .startsWith(path.resolve(os.tmpdir()) + path.sep + "safe-backup-test-")
    )
      throw new Error("Unsafe fixture cleanup path");
    return fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

function backupTo(contents, observed) {
  return async (file) => {
    observed?.(file);
    await fs.writeFile(file, contents);
  };
}

test("backup failure after a partial write preserves the old destination and removes its temp directory", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "backup.sqlite");
  await fs.writeFile(destination, "old bytes");
  let tempDir;

  await assert.rejects(
    createValidatedBackup(destination, {
      backupTo: async (file) => {
        tempDir = path.dirname(file);
        await fs.writeFile(file, "partial bytes");
        throw new Error("backup failed");
      },
      validate: async () =>
        assert.fail("must not validate after backup failure"),
    }),
    /backup failed/,
  );

  assert.equal(await fs.readFile(destination, "utf8"), "old bytes");
  await assert.rejects(fs.stat(tempDir), { code: "ENOENT" });
});

test("cleanup failure does not mask a backup error or turn a published copy into failure", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "backup.sqlite");
  await fs.writeFile(destination, "old bytes");
  const originalRm = fs.rm;
  const originalWarn = console.warn;
  const leftovers = [];
  const warnings = [];
  fs.rm = async (file, options) => {
    if (
      path.dirname(file) === root &&
      path.basename(file).startsWith(".gastronomy-backup-")
    ) {
      leftovers.push(file);
      throw new Error("cleanup failed");
    }
    return originalRm(file, options);
  };
  console.warn = (...args) => warnings.push(args);
  try {
    const primaryError = new Error("primary backup failure");
    await assert.rejects(
      createValidatedBackup(destination, {
        backupTo: async () => {
          throw primaryError;
        },
        validate: () => assert.fail("must not validate"),
      }),
      (error) => error === primaryError,
    );
    assert.equal(await fs.readFile(destination, "utf8"), "old bytes");
    await createValidatedBackup(destination, {
      backupTo: backupTo("published bytes"),
      validate: () => {},
    });
    assert.equal(await fs.readFile(destination, "utf8"), "published bytes");
    assert.equal(warnings.length, 2);
  } finally {
    fs.rm = originalRm;
    console.warn = originalWarn;
    for (const file of leftovers)
      await originalRm(file, { recursive: true, force: true });
  }
});

test("validation failure preserves an existing destination and cleans the temp directory", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "backup.sqlite");
  await fs.writeFile(destination, "old bytes");
  let tempDir;

  await assert.rejects(
    createValidatedBackup(destination, {
      backupTo: await backupTo("new bytes", (file) => {
        tempDir = path.dirname(file);
      }),
      validate: async (file) => {
        assert.equal(await fs.readFile(file, "utf8"), "new bytes");
        throw new Error("invalid backup");
      },
    }),
    /invalid backup/,
  );

  assert.equal(await fs.readFile(destination, "utf8"), "old bytes");
  await assert.rejects(fs.stat(tempDir), { code: "ENOENT" });
});

test("publishes only after backup and validation succeed", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "backup.sqlite");
  await fs.writeFile(destination, "old bytes");
  const events = [];

  await createValidatedBackup(destination, {
    backupTo: async (file) => {
      events.push("backup");
      assert.equal(await fs.readFile(destination, "utf8"), "old bytes");
      await fs.writeFile(file, "new bytes");
    },
    validate: async (file) => {
      events.push("validate");
      assert.equal(await fs.readFile(destination, "utf8"), "old bytes");
      assert.equal(await fs.readFile(file, "utf8"), "new bytes");
    },
  });

  assert.deepEqual(events, ["backup", "validate"]);
  assert.equal(await fs.readFile(destination, "utf8"), "new bytes");
});

test("creates a new destination only after successful validation", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "new.sqlite");
  await createValidatedBackup(destination, {
    backupTo: await backupTo("new bytes"),
    validate: async (file) =>
      assert.equal(await fs.readFile(file, "utf8"), "new bytes"),
  });
  assert.equal(await fs.readFile(destination, "utf8"), "new bytes");

  const failedDestination = path.join(root, "failed.sqlite");
  await assert.rejects(
    createValidatedBackup(failedDestination, {
      backupTo: await backupTo("bad bytes"),
      validate: async () => {
        throw new Error("invalid");
      },
    }),
    /invalid/,
  );
  await assert.rejects(fs.stat(failedDestination), { code: "ENOENT" });
});

test("failed publication onto an existing directory preserves contents and cleans temp files", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "destination");
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, "keep.txt"), "keep me");
  let tempDir;

  await assert.rejects(
    createValidatedBackup(destination, {
      backupTo: await backupTo("new bytes", (file) => {
        tempDir = path.dirname(file);
      }),
      validate: async () => {},
    }),
  );

  assert.equal(
    await fs.readFile(path.join(destination, "keep.txt"), "utf8"),
    "keep me",
  );
  await assert.rejects(fs.stat(tempDir), { code: "ENOENT" });
});

test("concurrent backups use distinct temp directories and publish whole validated files", async (t) => {
  const root = await fixture(t);
  const destination = path.join(root, "backup.sqlite");
  const tempDirs = new Set();
  const contents = ["first complete backup", "second complete backup"];

  await Promise.all(
    contents.map((content) =>
      createValidatedBackup(destination, {
        backupTo: async (file) => {
          tempDirs.add(path.dirname(file));
          await new Promise((resolve) => setTimeout(resolve, 10));
          await fs.writeFile(file, content);
        },
        validate: async (file) => {
          assert.equal(await fs.readFile(file, "utf8"), content);
        },
      }),
    ),
  );

  assert.equal(tempDirs.size, 2);
  assert.ok(contents.includes(await fs.readFile(destination, "utf8")));
  for (const dir of tempDirs)
    await assert.rejects(fs.stat(dir), { code: "ENOENT" });
});
