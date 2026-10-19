import nodemailer from "nodemailer";

// Читаем переменные окружения лениво
const env = () => process.env;

const isResendConfigured = () => Boolean(env().RESEND_API_KEY);
const isSmtpConfigured = () => Boolean(env().SMTP_HOST && env().SMTP_USER && env().SMTP_PASS);

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = env();
    const port = Number(SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

function buildOtpHtml(code, type = "registration") {
  const isReset = type === "password_reset";
  const title = isReset ? "Сброс пароля" : "Подтверждение email";
  const description = isReset
    ? "Ваш код для сброса пароля:"
    : "Ваш код подтверждения электронной почты:";
  const footer = isReset
    ? "Если вы не запрашивали сброс пароля на UyTap, просто проигнорируйте это письмо."
    : "Если вы не регистрировались на UyTap, просто проигнорируйте это письмо.";

  return `<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
      <tr>
        <td align="center">
          <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:32px;box-shadow:0 4px 12px rgba(0,0,0,0.05);">
            <tr>
              <td align="center" style="font-size:30px;font-weight:800;color:#111;letter-spacing:1px;">
                Uy<span style="color:#e11d48;">Tap</span>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:20px;color:#333;font-size:16px;">
                ${description}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 0;">
                <div style="display:inline-block;padding:16px 32px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:36px;font-weight:700;letter-spacing:10px;color:#0f172a;">
                  ${code}
                </div>
              </td>
            </tr>
            <tr>
              <td align="center" style="color:#b91c1c;font-size:14px;font-weight:600;">
                Никому не сообщайте этот код. Срок действия: 10 минут.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-top:20px;border-top:1px solid #f1f5f9;margin-top:20px;color:#94a3b8;font-size:12px;line-height:1.5;">
                ${footer}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Отправка через Resend HTTP API (рекомендуется для Render / Serverless, так как работает по HTTPS без блокировок портов)
 */
async function sendViaResend({ toEmail, subject, html, text }) {
  const apiKey = env().RESEND_API_KEY;
  const from = env().RESEND_FROM || env().SMTP_FROM || "UyTap <onboarding@resend.dev>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject,
      html,
      text,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Resend API error: ${response.status} ${response.statusText}`);
  }

  return { provider: "resend", id: data.id };
}

/**
 * Отправляет OTP-код на email.
 * Приоритет провайдеров:
 * 1. Resend API (если задан RESEND_API_KEY) — самый надежный вариант для Render
 * 2. SMTP (если заданы SMTP_HOST, SMTP_USER, SMTP_PASS)
 * 3. Dev Fallback — логирование в консоль (если ничего не задано)
 */
export async function sendOtpEmail(toEmail, code, type = "registration") {
  const isReset = type === "password_reset";
  const subject = isReset ? "UyTap: Сброс пароля" : "UyTap — код подтверждения email";
  const text = isReset
    ? `Ваш код для сброса пароля UyTap: ${code}. Никому не сообщайте этот код. Срок действия: 10 минут.`
    : `Ваш код подтверждения UyTap: ${code}. Никому не сообщайте этот код. Срок действия: 10 минут.`;
  const html = buildOtpHtml(code, type);

  // 1. Попытка отправки через Resend
  if (isResendConfigured()) {
    try {
      return await sendViaResend({ toEmail, subject, html, text });
    } catch (err) {
      console.error("[EmailService] Ошибка отправки через Resend:", err.message);
      // Если SMTP тоже не настроен, пробрасываем ошибку
      if (!isSmtpConfigured()) throw err;
      console.warn("[EmailService] Переключаемся на резервный SMTP...");
    }
  }

  // 2. Попытка отправки через SMTP (nodemailer)
  if (isSmtpConfigured()) {
    try {
      await getTransporter().sendMail({
        from: env().SMTP_FROM || env().SMTP_USER,
        to: toEmail,
        subject,
        text,
        html,
      });
      return { provider: "smtp" };
    } catch (err) {
      console.error("[EmailService] Ошибка отправки через SMTP:", err.message);
      throw err;
    }
  }

  // 3. Dev Fallback (для локальной разработки или тестовой среды)
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n======================================================`);
    console.log(` [DEV EMAIL OTP] [${type.toUpperCase()}]`);
    console.log(` Получатель: ${toEmail}`);
    console.log(` Код:        ${code}`);
    console.log(` (Письмо не отправлено в сеть, т.к. не заданы RESEND_API_KEY или SMTP_*)`);
    console.log(`======================================================\n`);
    return { provider: "dev_console", dev: true };
  }

  // В production окружении логировать коды в консоль категорически запрещено,
  // а отправка без реального почтового шлюза недопустима.
  console.error(
    `[EmailService] Критическая ошибка конфигурации: почтовый шлюз (Resend или SMTP) не настроен в production окружении`
  );
  throw new Error("Сервис отправки email не настроен: почтовый провайдер недоступен");
}

