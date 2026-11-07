import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

test(
  "la vista previa permite ensayar rechazo, aprobación repetida y reintegro sólo por loopback",
  { timeout: 15000 },
  async () => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/preview-merchants.mjs", import.meta.url),
        ),
        "--simular-cobros",
      ],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    const closed = once(child, "exit");
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (data) => {
      output += data;
    });
    async function waitFor(check) {
      for (let i = 0; i < 120; i++) {
        if (await check()) return;
        await delay(20);
      }
      throw new Error("La vista previa no confirmó el paso esperado");
    }
    try {
      await waitFor(() => /Contraseña temporal: \S+\r?\n/.test(output));
      const base = output.match(
        /Consola: (http:\/\/127\.0\.0\.1:\d+)\/manage/,
      )[1];
      const login = await fetch(base + "/manage/api/login", {
        method: "POST",
        headers: { origin: base, "content-type": "application/json" },
        body: JSON.stringify({
          username: "owner-preview",
          password: output.match(/Contraseña temporal: (\S+)/)[1],
        }),
      });
      assert.equal(login.status, 200);
      const headers = {
        origin: base,
        cookie: login.headers.get("set-cookie").split(";")[0],
        "x-panel-csrf": (await login.json()).csrfToken,
        "content-type": "application/json",
      };
      const url = base + "/manage/api/merchants/preview-bistro-03";
      const detail = async () => (await fetch(url, { headers })).json();
      const original = (await detail()).merchant;
      assert.equal(
        (
          await fetch(url + "/sandbox", {
            method: "POST",
            headers,
            body: JSON.stringify({
              payerEmail: "comprador_prueba@testuser.com",
              amountArs: "160.10",
            }),
          })
        ).status,
        200,
      );
      for (const [command, state] of [
        ["rechazar", "REJECTED"],
        ["aprobar", "APPROVED"],
        ["aprobar", "APPROVED"],
        ["reintegrar", "REVERSED"],
      ]) {
        const offset = output.length;
        child.stdin.write(command + "\n");
        await waitFor(() =>
          output.slice(offset).includes("aceptado por el webhook local"),
        );
        const result = await detail();
        assert.equal(result.sandbox.lastPaymentStatus, state);
        assert.equal(result.sandbox.status, "AUTHORIZED");
        assert.deepEqual(result.merchant, original);
      }
      child.stdin.end("salir\n");
      assert.equal((await closed)[0], 0);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  },
);
