import { handleUpdate } from "../../bot/index.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret =
    req.headers["x-telegram-bot-api-secret-token"];

  if (
    !secret ||
    receivedSecret !== secret
  ) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    await handleUpdate(req.body);

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error("Bot error:", error);

    // A payment that could not be processed must be re-sent by Telegram (the handler is
    // idempotent), so only that case answers with an error. Everything else is acknowledged,
    // otherwise one bad update would block the bot.
    if (req.body?.message?.successful_payment) {
      return res.status(500).json({
        ok: false
      });
    }

    return res.status(200).json({
      ok: false
    });
  }
}
