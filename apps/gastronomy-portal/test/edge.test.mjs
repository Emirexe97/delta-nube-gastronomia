// Run with a local Caddy v2 executable; never contacts a real license authority.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const host = "gastronomia.deltanubeweb.com";
const slash = (s) => s.replaceAll("\\", "/");
const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
function visit(port, path, method = "GET", body = "", headers = {}) {
  return new Promise((resolve, reject) => {
    const q = request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: { host, ...headers },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (s) => {
          text += s;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, text, headers: res.headers }),
        );
      },
    );
    q.on("error", reject);
    q.end(body);
  });
}

test(
  "portada aislada: la política de licencias es idéntica con y sin la portada",
  { timeout: 30000 },
  async (t) => {
    const temp = await mkdtemp(join(tmpdir(), "dng-portal-edge-"));
    const children = [];
    const upstream = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.writeHead(202, { "x-fixture": "license-upstream" });
      res.end(
        JSON.stringify([
          req.method,
          req.url,
          req.headers.authorization,
          Buffer.concat(chunks).toString(),
        ]),
      );
    });
    const upstreamPort = await listen(upstream);
    t.after(async () => {
      for (const child of children) {
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill();
          await exited;
        }
      }
      upstream.closeAllConnections();
      await new Promise((done) => upstream.close(done));
      await rm(temp, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 150,
      });
    });
    const original = await readFile(
      join(root, "docker/licensing/Caddyfile.snippet"),
      "utf8",
    );
    const fragment = slash(join(root, "docker/gastronomy-portal/portal.caddy"));

    async function startEdge(withPortal) {
      const probe = createServer(),
        port = await listen(probe);
      await new Promise((done) => probe.close(done));
      const config =
        `{\n admin off\n persist_config off\n auto_https off\n storage file_system {\n root "${slash(temp)}/storage"\n }\n}\n` +
        original
          .replace(
            host + " {",
            `http://${host}:${port} {\n bind 127.0.0.1\n${withPortal ? ' import "' + fragment + '"' : ""}`,
          )
          .replace("gastronomy-license-api:8097", `127.0.0.1:${upstreamPort}`);
      const configPath = join(temp, String(port) + ".caddy");
      await writeFile(configPath, config);
      const child = spawn(
        process.env.CADDY_BIN || "caddy",
        ["run", "--adapter", "caddyfile", "--config", configPath],
        {
          cwd: temp,
          windowsHide: true,
          env: {
            ...process.env,
            GASTRONOMY_PORTAL_ROOT: slash(
              join(root, "apps/gastronomy-portal/public"),
            ),
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      children.push(child);
      let logs = "",
        problem;
      child.stderr.on("data", (b) => {
        logs += b;
      });
      child.on("error", (e) => {
        problem = e;
      });
      for (let i = 0; i < 100; i++) {
        if (problem) throw problem;
        if (child.exitCode !== null) throw new Error(logs);
        try {
          if ((await visit(port, "/health")).status === 202) {
            return port;
          }
        } catch {
          /* listener not bound yet */
        }
        await delay(35);
      }
      child.kill();
      throw new Error("Caddy did not start: " + logs);
    }
    const before = await startEdge(false),
      after = await startEdge(true);
    for (const [method, path] of [
      ["GET", "/health"],
      ["GET", "/manage/"],
      ["POST", "/manage/api/login"],
      ["POST", "/v1/activate"],
      ["POST", "/v1/verify"],
      ["POST", "/v2/devices/challenge"],
      ["POST", "/v2/devices/lease"],
      ["POST", "/v2/devices/request"],
      ["GET", "/admin"],
      ["POST", "/admin/licenses"],
      ["GET", "/otra-ruta"],
      ["GET", "/ayuda/privada"],
      ["POST", "/"],
      ["POST", "/ayuda/"],
    ]) {
      const send = (port) =>
        visit(port, path, method, method === "POST" ? "synthetic" : "", {
          authorization: "Bearer synthetic",
        });
      const old = await send(before),
        next = await send(after);
      assert.deepEqual(
        [next.status, next.text, next.headers["x-fixture"]],
        [old.status, old.text, old.headers["x-fixture"]],
        method + " " + path,
      );
      assert.equal(next.status, path.startsWith("/admin") ? 404 : 202);
    }
    for (const [path, type] of [
      ["/", "text/html"],
      ["/ayuda/", "text/html"],
      ["/carta-de-ejemplo/", "text/html"],
      ["/portal-assets/site.css", "text/css"],
      ["/portal-assets/simbolo.png", "image/png"],
      ["/portal-assets/marca.png", "image/png"],
      ["/portal-assets/mesa.webp", "image/webp"],
      ["/portal-assets/inter-latin-variable.woff2", "font/woff2"],
    ]) {
      const page = await visit(after, path);
      assert.equal(page.status, 200, path);
      assert.ok(page.headers["content-type"].startsWith(type));
      assert.ok(page.text.length > 100);
      assert.equal(page.headers["x-fixture"], undefined);
      assert.ok(
        page.headers["content-security-policy"].includes("default-src 'none'"),
      );
      const head = await visit(after, path, "HEAD");
      assert.equal(head.status, 200);
      assert.equal(head.text, "");
    }
    assert.equal(
      (await visit(after, "/portal-assets/missing-file")).status,
      404,
    );
    for (const path of ["/ayuda", "/carta-de-ejemplo"]) {
      const redirect = await visit(after, path);
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.location, path + "/");
    }
  },
);
