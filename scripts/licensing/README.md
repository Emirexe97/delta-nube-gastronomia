# Local authority backup operator

This is a narrow operator tool for creating an **encrypted local copy** of the licensing authority bundle and validating that copy in an isolated remote restore-check environment. It does not restore or replace the live authority.

## Requirements and custody limits

- Windows PowerShell 7 on the same Windows user profile that will create and later validate the archive.
- OpenSSH `ssh.exe` available on `PATH`, and a pre-provisioned host key for `145.223.121.144` in that user's `known_hosts`. Host-key checking is strict; the script does not enroll keys or ask for passwords.
- The fixed remote helpers must be installed: `/home/deploy/gastronomy-licensing/scripts/authority-backup.sh` and `/home/deploy/gastronomy-licensing/scripts/authority-restore-check.sh`.
- Archive data is captured as binary bytes in memory, limited to 64 MiB, then protected using Windows DPAPI `CurrentUser`. Files and the sanitized JSON receipt are placed in `%LOCALAPPDATA%\DeltaNube\LicensingBackups`; that directory is restricted to the current user and `SYSTEM`.
- DPAPI `CurrentUser` is bound to this Windows account/profile. This is **not portable** to another PC/profile and is not full PC-loss recovery or a complete custody strategy. Keep a separately approved recovery plan; never copy plaintext authority material to another location.
- SSH transport uses `BatchMode=yes` and `StrictHostKeyChecking=yes`. No secret is put in process arguments, environment variables, logs, or stdout. SSH stderr is intentionally suppressed from output.

## Commands

```powershell
pwsh -NoProfile -File .\scripts\licensing\authority-backup.ps1 Backup
pwsh -NoProfile -File .\scripts\licensing\authority-backup.ps1 ValidateRestore -Archive "$env:LOCALAPPDATA\DeltaNube\LicensingBackups\authority-YYYYMMDDTHHMMSSZ.dnbak"
```

`Backup` emits one sanitized JSON receipt (no archive contents or key material). It refuses to overwrite an archive. `ValidateRestore` decrypts only in memory, checks the plaintext SHA-256 against the receipt, and streams bytes over SSH stdin to the predefined validator. The remote validator must unpack only into isolated temporary storage (e.g. a Docker tmpfs), report sanitized JSON, and must never modify production authority state.

Do not add a `Restore` mode. Do not delete or recursively clean the backup directory as part of routine operation. The script refuses directory/reparse-point archive paths and only removes its own uniquely named temporary file within the private backup directory.

## Checks and remote helpers

Run `pwsh -NoProfile -File scripts/licensing/authority-backup.test.ps1` for five local regression groups. It AST-extracts the actual production helpers and never executes the production SSH path. Checks cover DPAPI roundtrip and tampering, ciphertext hash after protection, process success, output caps, timeout and nonzero exit handling.

Install `authority-backup.sh`, `authority-restore-check.sh` and `authority-restore-check.mjs` under the fixed remote scripts directory with owner deploy, directory0700 and scripts0700/validator0600. Backup pauses **only** the licensing api and streams a coherent tar of its own DB and keys; an EXIT trap starts that api and waits for healthy status. Validation runs a separate non-root Docker container with no network, read-only root filesystem and disposable tmpfs; no live data/secret mounts. Only the expected authority tar members are accepted. Restored SQLite integrity, key pairing and real API activation/verification/renewal are checked on the copy, never production.

## Public packaged pilot (manual opt-in only)

`node scripts/licensing/public-pilot.mjs --run-public-pilot` is a Windows-only **mutating operator smoke**, not part of regular test suites. It builds a temporary unpacked Electron directory (not NSIS), verifies real packaged state and isolated profile, and uses the configured public HTTPS authority with its original public key. Each run creates **one tagged technical license** in the authority, activates via UI, observes real grace expiry/write denial, renews idempotently and confirms operations resume. No customer or actual payment is created; the temporary POS profile is deleted, while the technical license remains as audit evidence.

Never run automatically or repeatedly just to check health. No trace or secret-bearing screenshot is recorded; codes/tokens/admin credentials are not printed. The fixed admin operation travels through SSH and reads the token only inside the service container. Sanitized receipt is written to ignored `.licensing-local/public-pilot-receipt.json`. Normal availability monitoring should use GET `/health`, not this pilot.
