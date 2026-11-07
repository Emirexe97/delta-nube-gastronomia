# Isolated account + waiter VPS pilot

This folder is a bounded deployment definition for the explicitly approved account/license and waiter pilot. It is not a production deployment recipe. It runs only the existing `scripts/hosting/app.js` package under an immutable, already-present Node 22 runtime image; Compose is forbidden from pulling or building an image.

## Safety boundary

- Project: `gastronomy_account_waiter_pilot`; dedicated root: `/home/deploy/gastronomy-account-waiter-pilot`.
- Only two services: `license` and `waiter`, on one internal-only network. No published ports, public admin, host sockets, production mounts, external networks, or env files.
- The read-only release mounts and separate writable pilot state mounts must be populated under this root. Each service's `HOME` points only to its own state mount.
- License gets 512 MiB / 0.5 CPU; waiter gets 128 MiB / 0.25 CPU. Both are capped at 64 processes and swap is capped to memory.
- This does not authorize touching/restarting any production/POS/license deployment. Do not connect pilot services to production systems or feed them customer data. Root handles any edge proxy/DNS/firewall integration separately; this definition exposes no ports.
- The license service may require secret-bearing config in its private `state/license` directory. Never put secrets in the release mount, Compose environment, command line, or this repository. Waiter config must remain a one-store fictitious pilot as enforced by `scripts/hosting/app.js`.

## Offline validation

Run tests with Node only:

```sh
node docker/vps-pilot/test.mjs
```

On the target host, render Compose configuration to JSON and validate it before any startup:

```sh
cd /home/deploy/gastronomy-account-waiter-pilot
docker compose -f compose.yml config --format json > /tmp/gastronomy-account-waiter-pilot.compose.json
node preflight.mjs /tmp/gastronomy-account-waiter-pilot.compose.json /home/deploy/gastronomy-account-waiter-pilot
```

Preflight fails closed unless both service definitions, image digest, entrypoint, identity, resource bounds, environment, mount paths/modes, local healthchecks, and internal network match the allowlist. A passed check is not authorization to start/restart services; review the rendered configuration and pilot data separately first.
