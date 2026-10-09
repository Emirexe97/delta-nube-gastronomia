export function createValidatedBackup(
  destination: string,
  operations: {
    backupTo: (temporaryPath: string) => Promise<unknown>;
    validate: (temporaryPath: string) => void | Promise<void>;
  },
): Promise<void>;
