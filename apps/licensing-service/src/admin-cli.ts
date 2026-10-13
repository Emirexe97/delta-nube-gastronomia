import { readFile } from "node:fs/promises";

const [command, tokenFile, ...args] = process.argv.slice(2);
const baseUrl = process.env.LICENSE_API_URL ?? "http://127.0.0.1:8097";

async function main(): Promise<void> {
  const endpoint = new URL(baseUrl);
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== "https:" &&
      !(
        endpoint.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)
      ))
  ) {
    throw new Error(
      "Use HTTPS or a local SSH tunnel; credentials must not be part of the URL.",
    );
  }
  if (
    !command ||
    !tokenFile ||
    !["create", "renew", "list"].includes(command)
  ) {
    throw new Error(
      "Usage: admin-cli.js <create|renew|list> <token-file> [arguments]",
    );
  }
  let path: string;
  let method = "GET";
  let payload: Record<string, string> | undefined;
  if (command === "create") {
    const [businessName, paidThrough] = args;
    if (!businessName || !isCanonicalIso(paidThrough))
      throw new Error(
        "create requires <business-name> <paidThrough-ISO-exclusive>",
      );
    path = "/admin/licenses";
    method = "POST";
    payload = { businessName, paidThrough };
  } else if (command === "renew") {
    const [licenseId, paidThrough, reason, idempotencyKey] = args;
    if (
      !licenseId ||
      !isCanonicalIso(paidThrough) ||
      !reason ||
      !idempotencyKey
    )
      throw new Error(
        "renew requires <license-id> <paidThrough-ISO-exclusive> <reason> <idempotency-key>",
      );
    path = `/admin/licenses/${encodeURIComponent(licenseId)}/renew`;
    method = "POST";
    payload = { paidThrough, reason, idempotencyKey };
  } else {
    if (args.length) throw new Error("list accepts no extra arguments");
    path = "/admin/licenses";
  }
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (Buffer.byteLength(token) < 32)
    throw new Error("Admin token file must contain at least 32 bytes");
  const response = await fetch(new URL(path, baseUrl), {
    method,
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = await response
    .json()
    .catch(() => ({ error: "invalid_server_response" }));
  if (!response.ok) {
    const code =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "request_failed";
    throw new Error(`API ${response.status}: ${code}`);
  }
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function isCanonicalIso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Request failed"}\n`,
  );
  process.exitCode = 1;
});
