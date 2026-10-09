const fs = require("node:fs/promises");
const { basename, dirname, join, resolve } = require("node:path");

async function createValidatedBackup(destination, { backupTo, validate }) {
  const target = resolve(destination);
  const parent = dirname(target);
  const temporaryDirectory = await fs.mkdtemp(
    join(parent, ".gastronomy-backup-"),
  );
  const temporaryFile = join(temporaryDirectory, "backup.sqlite");
  try {
    await backupTo(temporaryFile);
    await validate(temporaryFile);
    // Same directory/filesystem: publish only the complete, validated file.
    // Never unlink the existing destination, including if rename fails.
    await fs.rename(temporaryFile, target);
  } finally {
    if (
      dirname(resolve(temporaryDirectory)) === parent &&
      basename(temporaryDirectory).startsWith(".gastronomy-backup-")
    ) {
      try {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
      } catch (error) {
        // Cleanup must not hide a creation/validation error or report a published copy as failed.
        console.warn(
          "No se pudo limpiar el archivo temporal de la copia.",
          error,
        );
      }
    }
  }
}

module.exports = { createValidatedBackup };
