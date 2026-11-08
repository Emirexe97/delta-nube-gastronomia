import { SqliteGastronomyRepository, type SqliteRepositoryOptions } from "./sqlite-repository";

/** Operational fixtures run *after* the same first-PIN change used by a real terminal. */
export function configuredTestRepository(path: string, { adminPin: operationalPin = "2468", ...options }: SqliteRepositoryOptions) {
  const repo = new SqliteGastronomyRepository(path, { ...options, adminPin: "1234" });
  try {
    if (repo.isInitialAdminPinSetupRequired()) repo.setInitialAdminPin({ currentPin: "1234", newPin: operationalPin });
    return repo;
  } catch (error) {
    repo.close();
    throw error;
  }
}
