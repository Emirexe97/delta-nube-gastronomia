const fs = require("node:fs/promises");
const { basename, dirname, join, resolve } = require("node:path");
const { createValidatedBackup } = require("./safe-backup.cjs");

async function cleanOwnedDirectory(directory, parent, prefix) {
  if (
    dirname(resolve(directory)) !== resolve(parent) ||
    !basename(directory).startsWith(prefix)
  )
    throw new Error("La carpeta temporal no pertenece a esta restauración.");
  try {
    await fs.rm(directory, { recursive: true, force: true });
  } catch (error) {
    console.warn("No se pudo limpiar el temporal de restauración.", error);
  }
}

async function restoreValidatedCopy({
  source,
  databasePath,
  backupTo,
  validate,
  confirm,
  close,
  open,
}) {
  const parent = dirname(resolve(databasePath));
  const normalize = (path) =>
    process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  if (
    [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].some(
      (path) => normalize(path) === normalize(source),
    )
  )
    throw new Error("Elegí una copia guardada, no los datos que están en uso.");
  const stagingDirectory = await fs.mkdtemp(
    join(parent, ".gastronomy-restore-"),
  );
  const stagedSource = join(stagingDirectory, "selected.sqlite");
  let recoveryDirectory;
  let recoveryPath;
  let recoveryReady = false;
  try {
    const sourceStat = await fs.stat(source);
    await fs.copyFile(source, stagedSource);
    await validate(stagedSource);
    if (
      !(await confirm({
        fileName: basename(source),
        modifiedAt: sourceStat.mtime,
      }))
    )
      return { restored: false, recoveryPath: null };

    const recoveryParent = join(parent, "recovery");
    await fs.mkdir(recoveryParent, { recursive: true });
    recoveryDirectory = await fs.mkdtemp(
      join(recoveryParent, "before-restore-"),
    );
    recoveryPath = join(recoveryDirectory, "current.sqlite");
    await createValidatedBackup(recoveryPath, { backupTo, validate });
    recoveryReady = true;
    // Do not close or replace the live database before its recovery copy is validated.
    await close();
    try {
      await fs.rm(`${databasePath}-wal`, { force: true });
      await fs.rm(`${databasePath}-shm`, { force: true });
      await fs.copyFile(stagedSource, databasePath);
      await open();
    } catch (error) {
      try {
        // An unsuccessful open may have created sidecars; they belong to the failed source.
        await close();
        await fs.rm(`${databasePath}-wal`, { force: true });
        await fs.rm(`${databasePath}-shm`, { force: true });
        await fs.copyFile(recoveryPath, databasePath);
        await open();
      } catch (rollbackError) {
        throw new Error(
          `No se pudieron recuperar los datos automáticamente. La copia previa está en ${recoveryPath}.`,
          { cause: rollbackError },
        );
      }
      throw new Error(
        `No se restauró la copia. Se recuperaron los datos anteriores. Copia previa: ${recoveryPath}.`,
        { cause: error },
      );
    }
    return { restored: true, recoveryPath };
  } finally {
    if (recoveryDirectory && !recoveryReady)
      await cleanOwnedDirectory(
        recoveryDirectory,
        join(parent, "recovery"),
        "before-restore-",
      );
    await cleanOwnedDirectory(stagingDirectory, parent, ".gastronomy-restore-");
  }
}

module.exports = { restoreValidatedCopy };
