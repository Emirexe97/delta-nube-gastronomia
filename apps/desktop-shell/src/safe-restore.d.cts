export function restoreValidatedCopy(operations: {
  source: string;
  databasePath: string;
  backupTo(path: string): Promise<unknown>;
  validate(path: string): void | Promise<void>;
  confirm(details: { fileName: string; modifiedAt: Date }): Promise<boolean>;
  close(): void | Promise<void>;
  open(): void | Promise<void>;
}): Promise<{ restored: boolean; recoveryPath: string | null }>;
