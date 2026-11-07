// Local-only owner-panel preview. All credentials and data are ephemeral.
import {
  createHmac,
  randomBytes,
  randomUUID,
  generateKeyPairSync,
} from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import { createLicenseServer } from "../dist/server.js";
import { hashPanelPassword } from "../dist/panel-auth.js";

const host = "127.0.0.1";
const originFor = (port) => `http://${host}:${port}`;
const password = randomBytes(18).toString("base64url");
const username = "owner-preview";
const simulatePayments = process.argv.slice(2).includes("--simular-cobros");
if (
  process.argv.slice(2).some((arg) => arg !== "--simular-cobros") ||
  process.argv.slice(2).filter((arg) => arg === "--simular-cobros").length > 1
) {
  throw new Error("Uso: node scripts/preview-merchants.mjs [--simular-cobros]");
}
const simulatedBuyerEmail = "comprador_prueba@testuser.com";
const webhookSecret = randomBytes(32).toString("hex");
const subscriptions = new Map();
const charges = new Map();
let nextSubscriptionId = 0;
const mockGateway = {
  buyerEmail: simulatedBuyerEmail,
  async create({ reference, payerEmail, amountCents }) {
    const subscription = {
      id: `preview-sub-${++nextSubscriptionId}`,
      reference,
      payerEmail,
      amountCents,
      status: "PENDING",
      checkoutUrl: null,
    };
    subscriptions.set(subscription.id, subscription);
    return subscription;
  },
  async getSubscription(id) {
    const subscription = subscriptions.get(id);
    if (!subscription) throw new Error("Adhesión simulada desconocida");
    return subscription;
  },
  async cancel(id) {
    const subscription = await this.getSubscription(id);
    const cancelled = {
      ...subscription,
      status: "CANCELLED",
      checkoutUrl: null,
    };
    subscriptions.set(id, cancelled);
    return cancelled;
  },
  async getCharge(id) {
    const charge = charges.get(id);
    if (!charge) throw new Error("Cuota simulada desconocida");
    return charge;
  },
};
const db = new DatabaseSync(":memory:");
const { privateKey } = generateKeyPairSync("ed25519");
const { port } = await reserveLoopbackPort();
const panelAuth = {
  username,
  passwordHash: await hashPanelPassword(password),
  origin: originFor(port),
  secureCookies: false,
};
const app = createLicenseServer(
  {
    dbPath: resolve("preview-only-memory.sqlite"),
    adminToken: randomBytes(48).toString("base64url"),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    panelAuth,
    ...(simulatePayments
      ? { sandboxBilling: { gateway: mockGateway, webhookSecret } }
      : {}),
  },
  db,
);

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = createHttpServer();
    probe.once("error", reject);
    probe.listen(0, host, () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      const selected = { port: address.port };
      probe.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}

const now = Date.now();
const seed = db.prepare(
  "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,1,?,?,?,?)",
);
const addMerchant = (
  id,
  name,
  days,
  status = "ACTIVE",
  installationId = null,
) => {
  seed.run(
    id,
    name,
    new Date(now + days * 86_400_000).toISOString(),
    status,
    randomBytes(32).toString("hex"),
    installationId,
    new Date(now - 30 * 86_400_000).toISOString(),
  );
};
addMerchant(
  "preview-cafe-01",
  "Café Aurora",
  24,
  "ACTIVE",
  "preview-device-01",
);
addMerchant("preview-bar-02", "Bar del Puerto", 1, "ACTIVE");
addMerchant("preview-bistro-03", "Bistró Mercado", -10, "SUSPENDED");
db.prepare(
  "INSERT INTO accounts(email,password_hash,license_id,status,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?)",
).run(
  "caja@aurora.example.test",
  "preview-only-not-a-login-hash",
  "preview-cafe-01",
  new Date(now - 30 * 86_400_000).toISOString(),
  new Date(now - 30 * 86_400_000).toISOString(),
);

app.server.on("error", (error) => {
  console.error("Preview server error:", error.message);
  app.close();
  process.exitCode = 1;
});
app.server.listen(port, host, () => {
  console.log(
    simulatePayments
      ? "SIMULADOR LOCAL DE COBROS: gateway y datos ficticios en memoria; no se contacta Mercado Pago ni se abre checkout."
      : "Gastronomía panel preview (datos ficticios en memoria; no se llama a Mercado Pago)",
  );
  console.log(`Consola: ${originFor(port)}/manage`);
  console.log(`Usuario: ${username}`);
  console.log(`Contraseña temporal: ${password}`);
  console.log(
    "Escucha sólo en 127.0.0.1. Ctrl+C para cerrar y descartar la base y credenciales.",
  );
  if (simulatePayments) {
    console.log(`Comprador de prueba fijo: ${simulatedBuyerEmail}`);
    console.log(
      "Después de crear una adhesión en la ficha, escribí: aprobar | rechazar | reintegrar",
    );
    console.log(
      "Cada comando simula y firma un webhook dirigido sólo a esta instancia local; después actualizá la ficha.",
    );
  }
});

let stopping = false;
let commandLine;
async function simulateCommand(command) {
  if (!new Set(["aprobar", "rechazar", "reintegrar"]).has(command)) {
    console.log(
      "Comando no reconocido. Opciones: aprobar, rechazar, reintegrar.",
    );
    return;
  }
  const current = db
    .prepare(
      "SELECT ref,provider_id,email,cents,state FROM mp_test_subscriptions ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
    .get();
  if (
    !current ||
    !current.provider_id ||
    current.email !== simulatedBuyerEmail
  ) {
    console.log(
      "Todavía no hay una adhesión simulada reciente. Creala desde el panel y volvé a intentar.",
    );
    return;
  }
  if (current.state === "CANCELLED") {
    console.log(
      "La última adhesión está cancelada. Creá otra desde el panel antes de simular un resultado.",
    );
    return;
  }
  let charge = [...charges.values()].find(
    (item) => item.subscriptionId === current.provider_id,
  );
  if (command === "reintegrar" && (!charge || charge.status !== "APPROVED")) {
    console.log(
      "Primero ejecutá aprobar para tener una cuota simulada aprobada que se pueda reintegrar.",
    );
    return;
  }
  if (charge?.status === "REVERSED") {
    console.log(
      "Esta cuota ya está reintegrada; creá otra adhesión para simular un nuevo ciclo.",
    );
    return;
  }
  if (command === "rechazar" && charge?.status === "APPROVED") {
    console.log("La cuota ya está aprobada; usá reintegrar para revertirla.");
    return;
  }
  if (!charge) {
    charge = {
      id: `preview-installment-${randomUUID()}`,
      subscriptionId: current.provider_id,
      reference: current.ref,
      payerEmail: current.email,
      amountCents: current.cents,
      currency: "ARS",
      paymentId: null,
      status: "PENDING",
      debitDate: new Date().toISOString(),
    };
  }
  if (command === "aprobar") {
    charge = {
      ...charge,
      paymentId: charge.paymentId ?? `preview-payment-${randomUUID()}`,
      status: "APPROVED",
    };
  } else if (command === "rechazar") {
    charge = { ...charge, paymentId: null, status: "REJECTED" };
  } else {
    charge = { ...charge, status: "REVERSED" };
  }
  charges.set(charge.id, charge);
  async function sendEvent(topic, id) {
    const timestamp = String(Math.floor(Date.now() / 1000)),
      requestId = randomUUID();
    const manifest = `id:${id.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
    const signature = createHmac("sha256", webhookSecret)
      .update(manifest)
      .digest("hex");
    return fetch(
      `${originFor(port)}/billing/test/mercadopago/webhook?type=${topic}&data.id=${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": requestId,
          "x-signature": `ts=${timestamp},v1=${signature}`,
        },
        body: JSON.stringify({ type: topic, data: { id } }),
        redirect: "error",
      },
    );
  }
  try {
    const sub = subscriptions.get(current.provider_id);
    if (sub && sub.status === "PENDING") {
      sub.status = "AUTHORIZED";
      if (!(await sendEvent("subscription_preapproval", sub.id)).ok)
        throw new Error("Local subscription not confirmed");
    }
    const response = await sendEvent(
      "subscription_authorized_payment",
      charge.id,
    );
    if (!response.ok) {
      console.log(
        `Webhook simulado rechazado por la instancia local (HTTP ${response.status}); no cambió el ensayo.`,
      );
      return;
    }
    console.log(
      `Resultado simulado '${command}' aceptado por el webhook local para ${current.provider_id}. Actualizá la ficha del panel.`,
    );
    if (command === "aprobar")
      console.log(
        "El período que ves es sólo la vigencia simulada del ensayo; paidThrough real no se modifica.",
      );
    if (command === "rechazar")
      console.log(
        "La cuota queda rechazada; no se acredita período de prueba.",
      );
    if (command === "reintegrar")
      console.log(
        "La cuota queda revertida; la vigencia simulada del ensayo deja de computarla.",
      );
  } catch {
    console.log(
      "No se pudo entregar el evento a loopback; no se llamó a ningún proveedor externo.",
    );
  }
}
if (simulatePayments) {
  commandLine = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "simulador> ",
  });
  let sequence = Promise.resolve();
  commandLine.on("line", (line) => {
    const command = line.trim().toLowerCase();
    if (command === "salir") {
      commandLine.close();
      return;
    }
    sequence = sequence
      .then(() => simulateCommand(command))
      .catch(() => console.log("No se pudo procesar el comando local."))
      .finally(() => commandLine.prompt());
  });
  commandLine.on("close", () => {
    if (!stopping) {
      stopping = true;
      app.close();
    }
  });
  commandLine.prompt();
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    commandLine?.close();
    app.close();
  });
}
await once(app.server, "close");
