# Windows update hosting — HTTPS deployed, updater inactive

The **static HTTPS hosting layer only** was deployed on 2026-11-16 at `https://actualizaciones.deltanubeweb.com/gastronomia/windows/x64/`. DNS resolves to the intended VPS and TLS was verified externally with normal certificate validation. The dedicated root is empty: no release files, signing keys, or updater configuration were changed. Authenticode remains deferred and the updater remains disabled. See [deployment verification](../../docs/qa/UPDATE_HTTPS_DEPLOYMENT_20261116.md).

## Serving contract

| Item | Rule |
|---|---|
| Host | `actualizaciones.deltanubeweb.com` (requires DNS to point to the intended VPS and reachable HTTPS) |
| URL prefix | `/gastronomia/windows/x64/` |
| Dedicated static root | `/srv/updates/gastronomy/windows/x64` (URL prefix is stripped for versioned files; manifest rewrites to `/release.json`) |
| Existing publication mount | Host `/opt/pos/delta-nube-pos/updates` is already mounted read-only at `/srv/updates`; publish only inside its `gastronomy` subdirectory |
| Manifest | `release.json` at `/gastronomia/windows/x64/release.json` (Ed25519 envelope; runtime integration tested locally, not enabled) |
| Files | Immutable, versioned artifacts under public URL `gastronomia/windows/x64/versions/X.Y.Z/`; disk path `gastronomy/windows/x64/versions/X.Y.Z/` |
| Directory browsing | Disabled; other paths return 404 |
| Cache policy | Default `no-store`; manifest `no-cache, no-store, must-revalidate`; versioned artifacts `public, max-age=31536000, immutable` only for 2xx/304 responses |
| Secrets | No credentials, private keys, or signing materials in this tree or the public root |

The existing app `latest.yml` is **not** compatible and is not served as a fallback. The Windows runtime can read `release.json` in the explicit Ed25519 mode; it remains disabled until key custody and a real installed update are validated. The hostname is isolated from the POS hostname, and the route serves only the stated prefix; all other paths return 404. Keep the Caddy mount read-only and publish only public files in its dedicated `gastronomy` subtree. Do not place symlinks in it (Caddy's path sanitization does not make symlinks a safe publication boundary).

The independent [private pilot](../../docs/qa/WINDOWS_ED25519_PILOT_RUNBOOK.md) reserves `/gastronomia/piloto/windows/x64/` in the client only. The existing Caddy configuration does not serve that prefix. Do not add it to the public allowlist; the pilot requires a separately authorized, access-restricted route.

## Deployment procedure (completed for HTTPS only)

1. Use the existing read-only mount: host `/opt/pos/delta-nube-pos/updates` → Caddy `/srv/updates`. Create only the dedicated host subdirectory `gastronomy` for this channel; do not add a mount or recreate the edge. Confirm Caddy can traverse/read files.
2. Configure DNS for `actualizaciones.deltanubeweb.com` to the intended VPS. Completed in Hostinger: A `145.223.121.144`, TTL 300, verified against authoritative DNS and 1.1.1.1. TLS is now verified externally.
3. Add `Caddyfile.snippet` as a **standalone site block** in the actual edge Caddyfile. Do not nest it inside another site block or replace the existing Caddyfile. Check for conflicting host blocks first.
4. Adapt/validate the complete candidate configuration before activation, e.g. `caddy adapt --config /path/to/candidate-Caddyfile --adapter caddyfile --validate`. Review the adapted config and confirm all existing hosts/routes remain present.
5. Back up the active config and use the established validated deployment procedure. The active Caddyfile is a single-file bind mount: preserve its inode; do NOT replace it by rename or the container may retain the old file. Serialize the write, revalidate the mounted content, and only then reload Caddy. Do not kill/restart the process as a substitute. Verify the reload and test this hostname plus representative existing hosts; have a rollback copy ready.

Use the real complete Caddy configuration and the target deployment's service manager; do not validate this isolated snippet as if it were the full edge configuration. The linked deployment report records completed validation, backup, reload and external checks.

## Release publication order (future workflow)

An authorized publisher writes to the **host** directory. Caddy keeps read-only access; do not grant write access to the serving container. The private signing key is held separately and never copied into this publication tree.

1. Build and independently validate versioned artifacts and the `release.json` schema, signature envelope, URLs, and checksums. Do not publish until the updater and release tooling have been validated with an installed Windows test.
2. Copy artifacts to a temporary staging directory on the same filesystem as the publication root; verify names and checksums, then atomically rename into `gastronomy/windows/x64/versions/X.Y.Z/`.
3. Publish/replace `release.json` **last**, atomically, only after every artifact it references is present and reachable. Never overwrite an existing versioned artifact; a correction needs a new version/path.
4. Check HTTPS responses for an expected versioned file and the manifest, and confirm unlisted paths/directories are not exposed. Do not publish credentials or private keys.

## Scope and status

- Deployed configuration: `docker/updates/Caddyfile.snippet`, appended as a standalone block to the full edge configuration. Existing routes were preserved and the Caddyfile inode retained during writes.
- Verified: DNS, complete Caddy validation, reload without restart, trusted external TLS, HTTP-to-HTTPS redirect, 11 negative/missing-file requests, and unchanged representative existing-host status codes.
- Not done on this host: release publication, real artifact/download verification, updater activation, or installer generation. The later Ed25519 runtime verification and loopback tests did not touch this host.
- Windows distribution remains inactive until hosting, updater compatibility, feed/signature policy, and a real update are configured and verified. Authenticode is specifically deferred.

## References

- [Caddy `file_server`](https://caddyserver.com/docs/caddyfile/directives/file_server) — root usage, directory browsing opt-in, and symlink caveat.
- [Caddy command line](https://caddyserver.com/docs/command-line) — `caddy adapt` validation and reload guidance.
- [Caddy `header`](https://caddyserver.com/docs/caddyfile/directives/header) — response header configuration.
