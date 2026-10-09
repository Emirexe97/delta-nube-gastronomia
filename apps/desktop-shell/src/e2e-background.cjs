const { basename, dirname, resolve } = require("node:path");

function isBackgroundTest({ flag, isPackaged, userDataPath, tempRoot }) {
  if (flag !== "1" || isPackaged) return false;
  if (!userDataPath || !tempRoot) {
    throw new Error("Background E2E requires an isolated temporary profile");
  }
  const profile = resolve(userDataPath);
  const name = basename(profile);
  if (
    dirname(profile) !== resolve(tempRoot) ||
    !name.startsWith("gastronomy-") ||
    name.length <= "gastronomy-".length
  ) {
    throw new Error(
      "Background E2E requires an isolated gastronomy-* profile in the system temp directory",
    );
  }
  return true;
}

module.exports = { isBackgroundTest };
