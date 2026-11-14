import { createTransport } from "nodemailer";
import { readFileSync } from "node:fs";

export type RegistrationMail = { to: string; subject: string; text: string };

/** SMTP is operator-configured, never selected or controlled by a public request. */
export function createRegistrationMailer(
  env: NodeJS.ProcessEnv,
  makeTransport = createTransport,
) {
  const host = env.REGISTRATION_SMTP_HOST;
  const port = Number(env.REGISTRATION_SMTP_PORT ?? 465);
  const user = env.REGISTRATION_SMTP_USER;
  const file = env.REGISTRATION_SMTP_PASSWORD_FILE;
  const from = env.REGISTRATION_MAIL_FROM;
  if (
    !host ||
    !/^[a-zA-Z0-9.-]+$/.test(host) ||
    ![465, 587].includes(port) ||
    !user ||
    !file ||
    !from ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from)
  )
    throw new Error(
      "Configure REGISTRATION_SMTP_HOST/PORT/USER/PASSWORD_FILE and REGISTRATION_MAIL_FROM",
    );
  const pass = readFileSync(file, "utf8").trim();
  if (!pass) throw new Error("Registration SMTP password file is empty");
  const transport = makeTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 8000,
    dnsTimeout: 4000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  return async (message: RegistrationMail): Promise<void> => {
    const result = await transport.sendMail({
      from: { name: "Delta Nube Gastronomía", address: from },
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (!result.accepted?.length || result.rejected?.length)
      throw new Error("mail_unavailable");
  };
}
