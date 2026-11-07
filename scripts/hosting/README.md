# Hostinger pilot package

This creates a source staging directory for the explicitly bounded `license` or `waiter` pilot; it does not deploy or produce an archive. Build the matching service and workspace dependencies first, then run:

```sh
node scripts/hosting/package.mjs --kind=license --out=/path/to/new-output
```

Use `--kind=waiter` for the isolated waiter relay. Output must be a new directory outside this repository. Zip the resulting `hosting-<kind>-pilot` directory manually for transfer. It contains compiled service/vendor code only, no configuration or secrets. Hostinger app entry is `app.js`; set `HOSTING_PILOT_KIND` to the matching kind and `PORT` is supplied by the host.

Upload a separately prepared `config.json` to the account home directory (`homedir()`), not the release directory, in `.deltanube-gastronomy-hosting-<kind>-pilot-v1/config.json`; the app enforces directory permissions `700` and changes config file mode to `600` at startup. It must include `{ "marker":"hosting-pilot-v1", "kind":"license|waiter", "origin":"https://exact-origin" }` plus the corresponding credentials/config. License adds `privateKey` (Ed25519 PEM), `adminToken` (32+ bytes), and optionally both `panelUsername` and `panelPasswordHash`. Waiter adds exactly one store, with `isFictitious:true`, one site, valid token hashes and `receiveInstallationId`; provisioning secrets are forbidden. Do not include real customer data.

Without config, the process exposes only a 503 `/health` response and does not start either business service. The waiter wrapper permits only `/health`, `/waiter`, `/waiter/`, and `/v1/waiter/*`; it does not enable catalog, order, admin, tenant provisioning, or backup routes. Data files are kept in the persistent home-directory pilot folder. On each license-service restart with an existing database, startup first creates a consistent SQLite `VACUUM INTO` snapshot paired with the active config in a private timestamped `backups/` subdirectory (directory mode `700`, files `600`); if snapshot/config backup fails, the license service does not start. No backup is exposed over HTTP. Backups are retained; no automatic deletion policy is enabled.
