const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { restoreValidatedCopy } = require("./safe-restore.cjs");

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "gastronomy-restore-test-"),
  );
  t.after(async () => {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith("gastronomy-restore-test-")
    )
      throw new Error("Unsafe fixture cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return root;
}

async function setup(
  t,
  { source = "replacement-data", current = "current-data" } = {},
) {
  const root = await fixture(t);
  const parent = path.join(root, "db");
  await fs.mkdir(parent);
  const sourcePath = path.join(root, "source.sqlite");
  const databasePath = path.join(parent, "current.sqlite");
  await fs.writeFile(sourcePath, source);
  await fs.writeFile(databasePath, current);
  return { root, parent, sourcePath, databasePath };
}

function opts(paths, overrides = {}) {
  return {
    ...paths,
    source: paths.sourcePath,
    backupTo: async (file) => fs.copyFile(paths.databasePath, file),
    validate: async (file) => {
      const bytes = await fs.readFile(file);
      if (!bytes.length) throw new Error("empty database");
    },
    confirm: async () => true,
    close: async () => {},
    open: async () => {},
    ...overrides,
  };
}

async function recoveryFiles(parent) {
  const recoveryRoot = path.join(parent, "recovery");
  const dirs = await fs
    .readdir(recoveryRoot)
    .catch((e) => (e.code === "ENOENT" ? [] : Promise.reject(e)));
  return dirs.map((name) => path.join(recoveryRoot, name, "current.sqlite"));
}

test("cancel leaves live database untouched and does not close it", async (t) => {
  const paths = await setup(t);
  let closed = false;
  const result = await restoreValidatedCopy(
    opts(paths, {
      confirm: async () => false,
      close: async () => {
        closed = true;
      },
    }),
  );
  assert.deepEqual(result, { restored: false, recoveryPath: null });
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  assert.equal(closed, false);
  assert.deepEqual(await recoveryFiles(paths.parent), []);
});

test("rejects an invalid staged source before asking for confirmation", async (t) => {
  const paths = await setup(t);
  let confirmations = 0;
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        validate: async (file) => {
          if (file.includes(".gastronomy-restore-"))
            throw new Error("invalid source");
        },
        confirm: async () => {
          confirmations++;
          return true;
        },
      }),
    ),
    /invalid source/,
  );
  assert.equal(confirmations, 0);
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  assert.deepEqual(await fs.readdir(paths.parent), ["current.sqlite"]);
});

test("backup failure does not touch the live database", async (t) => {
  const paths = await setup(t);
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        backupTo: async () => {
          throw new Error("backup failed");
        },
      }),
    ),
    /backup failed/,
  );
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  assert.deepEqual(await recoveryFiles(paths.parent), []);
});

test("recovery-copy validation failure happens before close and leaves database unchanged", async (t) => {
  const paths = await setup(t);
  let validations = 0;
  let closed = false;
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        validate: async () => {
          if (++validations === 2) throw new Error("invalid recovery");
        },
        close: async () => {
          closed = true;
        },
      }),
    ),
    /invalid recovery/,
  );
  assert.equal(closed, false);
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
});

test("restores the validated source and retains a validated recovery copy", async (t) => {
  const paths = await setup(t);
  const events = [];
  const result = await restoreValidatedCopy(
    opts(paths, {
      validate: async (file) => {
        events.push(path.resolve(file));
        assert.ok((await fs.readFile(file)).length);
      },
      close: async () => events.push("close"),
      open: async () => events.push("open"),
    }),
  );
  assert.equal(result.restored, true);
  assert.equal(
    await fs.readFile(paths.databasePath, "utf8"),
    "replacement-data",
  );
  assert.equal(await fs.readFile(result.recoveryPath, "utf8"), "current-data");
  assert.match(result.recoveryPath, /recovery[\\/]before-restore-/);
  assert.ok(
    events.indexOf("close") > 0 &&
      events.indexOf("open") > events.indexOf("close"),
  );
  const entries = await fs.readdir(paths.parent);
  assert.deepEqual(
    entries.filter((name) => name.startsWith(".gastronomy-restore-")),
    [],
  );
});

test("validates a staging copy of the source, not a source changed during confirmation", async (t) => {
  const paths = await setup(t);
  const result = await restoreValidatedCopy(
    opts(paths, {
      confirm: async () => {
        await fs.writeFile(paths.sourcePath, "changed-after-check");
        return true;
      },
    }),
  );
  assert.equal(result.restored, true);
  assert.equal(
    await fs.readFile(paths.databasePath, "utf8"),
    "replacement-data",
  );
});

test("open failure rolls back to retained recovery copy and cleans staging", async (t) => {
  const paths = await setup(t);
  let opens = 0;
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        open: async () => {
          if (++opens === 1) throw new Error("open failed");
        },
      }),
    ),
    /recuperaron los datos anteriores/,
  );
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  const copies = await recoveryFiles(paths.parent);
  assert.equal(copies.length, 1);
  assert.equal(await fs.readFile(copies[0], "utf8"), "current-data");
  assert.deepEqual(
    (await fs.readdir(paths.parent)).filter((name) =>
      name.startsWith(".gastronomy-restore-"),
    ),
    [],
  );
});

test("replacement write failure recovers the prior file without deleting its recovery snapshot", async (t) => {
  const paths = await setup(t);
  const originalCopy = fs.copyFile;
  let reopened = false;
  fs.copyFile = async (source, destination, ...args) => {
    if (
      String(source).includes(".gastronomy-restore-") &&
      destination === paths.databasePath
    )
      throw new Error("controlled replacement write failure");
    return originalCopy(source, destination, ...args);
  };
  try {
    await assert.rejects(
      restoreValidatedCopy(
        opts(paths, {
          open: async () => {
            reopened = true;
          },
        }),
      ),
      (error) => {
        assert.match(error.message, /recuperaron los datos anteriores/);
        assert.match(error.cause.message, /replacement write failure/);
        return true;
      },
    );
  } finally {
    fs.copyFile = originalCopy;
  }
  assert.equal(reopened, true);
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  const copies = await recoveryFiles(paths.parent);
  assert.equal(copies.length, 1);
  assert.equal(await fs.readFile(copies[0], "utf8"), "current-data");
});

test("rollback removes WAL/SHM files written by a failed open before restoring prior bytes", async (t) => {
  const paths = await setup(t);
  let opens = 0;
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        open: async () => {
          if (++opens === 1) {
            await fs.writeFile(`${paths.databasePath}-wal`, "uncommitted wal");
            await fs.writeFile(`${paths.databasePath}-shm`, "shared memory");
            throw new Error("open failed");
          }
        },
      }),
    ),
    /recuperaron los datos anteriores/,
  );
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  await assert.rejects(fs.stat(`${paths.databasePath}-wal`), {
    code: "ENOENT",
  });
  await assert.rejects(fs.stat(`${paths.databasePath}-shm`), {
    code: "ENOENT",
  });
});

test("close failure before replacement propagates without pretending rollback ran", async (t) => {
  const paths = await setup(t);
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        close: async () => {
          throw new Error("close failed");
        },
      }),
    ),
    /close failed/,
  );
  assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  const copies = await recoveryFiles(paths.parent);
  assert.equal(copies.length, 1);
  assert.equal(await fs.readFile(copies[0], "utf8"), "current-data");
});

test("rollback failure reports the retained recovery path and preserves that copy", async (t) => {
  const paths = await setup(t);
  let opens = 0;
  await assert.rejects(
    restoreValidatedCopy(
      opts(paths, {
        open: async () => {
          if (++opens <= 2)
            throw new Error(
              opens === 1 ? "initial open failed" : "rollback open failed",
            );
        },
      }),
    ),
    (error) => {
      assert.match(error.message, /recovery/i);
      assert.match(error.message, /before-restore-/);
      return true;
    },
  );
  const copies = await recoveryFiles(paths.parent);
  assert.equal(copies.length, 1);
  assert.equal(await fs.readFile(copies[0], "utf8"), "current-data");
});

test("rejects restoring from the active database or either SQLite sidecar", async (t) => {
  const paths = await setup(t);
  for (const source of [
    paths.databasePath,
    `${paths.databasePath}-wal`,
    `${paths.databasePath}-shm`,
  ]) {
    await assert.rejects(
      restoreValidatedCopy(opts({ ...paths, sourcePath: source }, { source })),
      /Elegí una copia guardada/,
    );
    assert.equal(await fs.readFile(paths.databasePath, "utf8"), "current-data");
  }
});

test("validates both the staged source and recovery backup", async (t) => {
  const paths = await setup(t);
  const validated = [];
  await restoreValidatedCopy(
    opts(paths, {
      validate: async (file) => validated.push(path.resolve(file)),
    }),
  );
  assert.equal(validated.length, 2);
  assert.ok(validated.some((file) => file.includes(".gastronomy-restore-")));
  assert.ok(
    validated.some((file) =>
      file.includes(`${path.sep}recovery${path.sep}before-restore-`),
    ),
  );
});
