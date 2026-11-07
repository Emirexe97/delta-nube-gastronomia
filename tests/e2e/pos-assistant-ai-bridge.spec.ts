import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

let vite: ChildProcess;
let baseUrl = "";

async function freePort() {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No ephemeral port");
  const { port } = address;
  await new Promise<void>((done, fail) =>
    server.close((error) => (error ? fail(error) : done())),
  );
  return port;
}

test.beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/src/test/pos-assistant-ai-harness.html`;
  vite = spawn(
    process.execPath,
    [
      resolve("apps/gastronomy-web/node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: resolve("apps/gastronomy-web"), stdio: "ignore", windowsHide: true },
  );
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(baseUrl);
          return response.ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});

test.afterAll(async () => {
  vite?.kill();
});

async function openHarness(
  page: Page,
  permissions: "reports" | "limited" = "reports",
) {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) requests.push(request.url());
  });
  await page.goto(`${baseUrl}?permissions=${permissions}`);
  const trigger = page.getByRole("button", {
    name: "Preguntale al POS",
    exact: true,
  });
  await expect(trigger).toBeVisible();
  await page.context().setOffline(true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    const harness = (window as any).__posAssistantHarness;
    harness.aiCalls.length = 0;
    harness.reportCalls.length = 0;
  });
  requests.length = 0;
  await trigger.click();
  return {
    assistant: page.getByRole("dialog", {
      name: "Asistente del POS",
      exact: true,
    }),
    requests,
  };
}

async function sendAi(page: Page, question: string, response: unknown) {
  const assistant = page.getByRole("dialog", {
    name: "Asistente del POS",
    exact: true,
  });
  const search = assistant.getByRole("searchbox", {
    name: "Buscar una pregunta",
  });
  await search.fill(question);
  await assistant
    .getByRole("button", { name: "Consultar con IA", exact: true })
    .click();
  await assistant.getByLabel("Número de personal").fill("777777");
  await assistant.getByLabel("PIN", { exact: true }).fill("654321");
  await page.evaluate((nextResponse) => {
    (window as any).__posAssistantHarness.enqueue(nextResponse);
  }, response);
  await assistant
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .click();
}

test("sólo el envío explícito llama una vez al bridge; búsqueda y FAQ usan el informe local", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const { assistant, requests } = await openHarness(page);
  const questionText = "¿Cuánto vendimos hoy?";
  const search = assistant.getByRole("searchbox", {
    name: "Buscar una pregunta",
  });
  await search.fill("ventas hoy");
  await expect(
    assistant.getByRole("button", { name: questionText, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__posAssistantHarness.aiCalls),
  ).toHaveLength(0);

  await assistant
    .getByRole("button", { name: questionText, exact: true })
    .click();
  const answer = assistant.locator(".pos-assistant__answer");
  await expect(answer).toContainText("Informe");
  await expect(answer).toContainText(
    "Día comercial 07/11/2026: $ 123.456 en 3 pedidos.",
  );
  expect(
    await page.evaluate(() => (window as any).__posAssistantHarness.aiCalls),
  ).toHaveLength(0);

  await assistant
    .getByRole("button", { name: "Consultar con IA", exact: true })
    .click();
  await assistant.getByLabel("Número de personal").fill("777777");
  await assistant.getByLabel("PIN", { exact: true }).fill("654321");
  await page.evaluate(() =>
    (window as any).__posAssistantHarness.enqueue({
      ok: true,
      questionId: "sales-today",
      remaining: { user: 4, merchant: 9 },
    }),
  );
  await assistant
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .click();
  await expect(assistant.locator(".pos-assistant__ai-status")).toContainText(
    "La respuesta se obtuvo del catálogo local del POS",
  );
  await expect(answer).toContainText(
    "Día comercial 07/11/2026: $ 123.456 en 3 pedidos.",
  );
  const calls = await page.evaluate(
    () => (window as any).__posAssistantHarness.aiCalls,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    text: "ventas hoy",
    staffNumber: 777777,
    pin: "654321",
  });
  expect(
    await page.evaluate(
      () => (window as any).__posAssistantHarness.reportCalls,
    ),
  ).toHaveLength(2);
  expect(requests).toEqual([]);
});

test("una intención restringida o desconocida no revela datos del informe", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const { assistant } = await openHarness(page, "limited");
  await sendAi(page, "mostrame las ventas confidenciales", {
    ok: true,
    questionId: "sales-today",
    remaining: { user: 4, merchant: 9 },
  });
  await expect(assistant.getByRole("status")).toContainText(
    "La sugerencia no está disponible para tu usuario",
  );
  expect(
    await page.evaluate(
      () => (window as any).__posAssistantHarness.reportCalls,
    ),
  ).toHaveLength(0);

  await assistant
    .getByRole("searchbox", { name: "Buscar una pregunta" })
    .fill("otra pregunta sensible");
  await assistant
    .getByRole("button", { name: "Consultar con IA", exact: true })
    .click();
  await assistant.getByLabel("Número de personal").fill("777777");
  await assistant.getByLabel("PIN", { exact: true }).fill("654321");
  await page.evaluate(() =>
    (window as any).__posAssistantHarness.enqueue({
      ok: true,
      questionId: null,
      remaining: { user: 3, merchant: 8 },
    }),
  );
  await assistant
    .getByRole("button", { name: "Enviar consulta", exact: true })
    .click();
  await expect(assistant.getByRole("status")).toContainText(
    "no encontró una pregunta del catálogo que corresponda",
  );
  await expect(assistant.getByRole("status")).not.toContainText("123.456");
  expect(
    await page.evaluate(
      () => (window as any).__posAssistantHarness.reportCalls,
    ),
  ).toHaveLength(0);
});

test("un 429 deja disponibles las preguntas frecuentes locales", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const { assistant, requests } = await openHarness(page);
  await sendAi(page, "ventas hoy", {
    ok: false,
    code: "cooldown",
    retryAfter: 2,
    remaining: { user: 0, merchant: 5 },
  });
  await expect(assistant.locator(".pos-assistant__ai-status")).toContainText(
    "Esperá 2 segundos",
  );
  const question = assistant.getByRole("button", {
    name: "¿Cuánto vendimos hoy?",
    exact: true,
  });
  await expect(question).toBeVisible();
  await question.click();
  await expect(assistant.locator(".pos-assistant__answer")).toContainText(
    "Día comercial 07/11/2026: $ 123.456 en 3 pedidos.",
  );
  expect(
    await page.evaluate(() => (window as any).__posAssistantHarness.aiCalls),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () => (window as any).__posAssistantHarness.reportCalls,
    ),
  ).toHaveLength(1);
  expect(requests).toEqual([]);
});
