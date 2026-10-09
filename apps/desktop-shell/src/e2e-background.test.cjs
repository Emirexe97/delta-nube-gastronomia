const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { isBackgroundTest } = require("./e2e-background.cjs");

const tempRoot = path.join(os.tmpdir(), "gastronomy-background-tests");
const isolatedProfile = path.join(tempRoot, "gastronomy-run-123");

function input(overrides = {}) {
  return {
    flag: "1",
    isPackaged: false,
    userDataPath: isolatedProfile,
    tempRoot,
    ...overrides,
  };
}

test("disabled or non-exact background flags do not activate background mode", () => {
  for (const flag of [undefined, "0", "true"]) {
    assert.equal(
      isBackgroundTest(input({ flag })),
      false,
      `flag ${String(flag)}`,
    );
  }
});

test("packaged applications ignore the background flag without validating paths", () => {
  assert.equal(
    isBackgroundTest(
      input({ isPackaged: true, userDataPath: os.homedir(), tempRoot: "" }),
    ),
    false,
  );
});

test("accepts a named isolated profile directly under the temporary root", () => {
  assert.equal(isBackgroundTest(input()), true);
});

test("rejects non-isolated profiles when background mode is explicitly enabled", () => {
  const cases = [
    ["real user profile", os.homedir()],
    ["temporary root itself", tempRoot],
    ["non-prefixed profile", path.join(tempRoot, "profile-run-123")],
    ["nested profile", path.join(tempRoot, "gastronomy-run-123", "nested")],
    [
      "outside profile",
      path.join(path.dirname(tempRoot), "gastronomy-run-123"),
    ],
    ["traversal escape", path.join(tempRoot, "..", "gastronomy-run-123")],
    ["empty suffix", path.join(tempRoot, "gastronomy-")],
  ];

  for (const [label, userDataPath] of cases) {
    assert.throws(
      () => isBackgroundTest(input({ userDataPath })),
      /isolated/i,
      label,
    );
  }
});
