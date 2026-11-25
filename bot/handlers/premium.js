import { getUserByTelegramId } from "../../lib/users.js";
import { getUserPlanInfo } from "../../lib/plans.js";
import {
  getPlans,
  getPremiumConfig,
  getProject
} from "../../lib/config.js";

import {
  grantPremium,
  grantTrial,
  canStartTrial
} from "../../lib/subscriptions.js";

import {
  recordPayment,
  claimPayment,
  markGranted
} from "../../lib/payments.js";

import {
  answerCallback,
  showScreen,
  telegramRequest
} from "../telegram.js";

// Telegram Stars: currency XTR, no provider token.
const CURRENCY = "XTR";

// Offers (durations, prices, labels, trial) come from config.json -> premium;
// texts and the device limit come from plan.json.
function payloadFor(optionId, telegramId) {
  return `premium:${optionId}:${telegramId}`;
}

function parsePayload(payload) {
  const match = /^premium:([a-z0-9_-]{1,20}):(\d+)$/i.exec(
    String(payload ?? "")
  );

  return match ? { optionId: match[1], telegramId: match[2] } : null;
}

function findOption(optionId) {
  return getPremiumConfig().options.find(o => o.id === optionId) ?? null;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "неизвестно";
  }

  return date.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function featureLines(plan) {
  return (plan.features || []).map(
    line =>
      "• " + String(line).replaceAll("{devices}", String(plan.devices))
  );
}

function backButton() {
  return {
    text: "Назад",
    callback_data: "back",
    icon_custom_emoji_id: "5877629862306385808"
  };
}

// Premium screen: features, offers as buttons, the trial button while it is available.
async function renderPremium(callbackQuery) {
  const premiumPlan = getPlans().premium || {};
  const config = getPremiumConfig();
  const user = await getUserByTelegramId(callbackQuery.from.id);
  const info = user ? await getUserPlanInfo(user.id) : null;

  const isPremium = info?.plan.plan === "premium";
  const endless = isPremium && !info.subscription.expires_at;
  const trialAvailable =
    Boolean(user) &&
    config.trial.enabled &&
    (await canStartTrial(user.id));

  let text = `💎 ${premiumPlan.name || "Premium"}\n\n`;

  if (premiumPlan.features?.length) {
    text += `${featureLines(premiumPlan).join("\n")}\n\n`;
  }

  if (endless) {
    text += "✅ У вас Premium без срока действия.";
  } else if (!config.options.length) {
    text += "Покупка временно недоступна.";
  } else {
    text += config.options
      .map(o => `${o.label} — ${o.stars} ⭐`)
      .join("\n");

    if (isPremium) {
      text +=
        `\n\n✅ ${info.plan.name} активен до ${formatDate(info.subscription.expires_at)}.` +
        "\nПокупка продлит его.";
    }
  }

  const rows = [];

  if (trialAvailable && !endless) {
    rows.push([
      {
        text: `Попробовать ${config.trial.days} дн. бесплатно`,
        callback_data: "trial_premium",
        style: "primary"
      }
    ]);
  }

  if (!endless) {
    for (const option of config.options) {
      rows.push([
        {
          text: `${option.label} — ${option.stars} ⭐`,
          callback_data: `buy_premium:${option.id}`,
          style: "success"
        }
      ]);
    }
  }

  rows.push([backButton()]);

  await showScreen(callbackQuery, {
    text,
    replyMarkup: { inline_keyboard: rows }
  });
}

export async function showPremium(callbackQuery) {
  await answerCallback(callbackQuery.id);
  await renderPremium(callbackQuery);
}

export async function handleBuyPremium(callbackQuery, optionId) {
  const option = findOption(optionId);

  if (!option) {
    await answerCallback(callbackQuery.id, "Этот тариф больше недоступен");
    return;
  }

  const telegramId = callbackQuery.from.id;
  const user = await getUserByTelegramId(telegramId);

  if (!user) {
    await answerCallback(callbackQuery.id, "Сначала отправь боту /start");
    return;
  }

  await answerCallback(callbackQuery.id);

  const name = getPlans().premium?.name || "Premium";

  await telegramRequest("sendInvoice", {
    chat_id: telegramId,
    title: `${name}: ${option.label}`.slice(0, 32),
    description: (
      getPlans().premium?.description ||
      `${name} для ${getProject().name}`
    ).slice(0, 255),
    payload: payloadFor(option.id, telegramId),
    currency: CURRENCY,
    prices: [
      {
        label: `${name}: ${option.label}`.slice(0, 32),
        amount: option.stars
      }
    ]
  });
}

export async function handleTrialPremium(callbackQuery) {
  const config = getPremiumConfig();
  const user = await getUserByTelegramId(callbackQuery.from.id);

  if (!user) {
    await answerCallback(callbackQuery.id, "Сначала отправь боту /start");
    return;
  }

  if (!config.trial.enabled) {
    await answerCallback(callbackQuery.id, "Пробный период недоступен");
    return;
  }

  const expiresAt = await grantTrial(user.id, config.trial.days);

  if (!expiresAt) {
    await answerCallback(
      callbackQuery.id,
      "Пробный период уже использован или у вас активен Premium"
    );
    await renderPremium(callbackQuery);
    return;
  }

  await answerCallback(
    callbackQuery.id,
    `Premium на ${config.trial.days} дн. активирован`
  );

  await telegramRequest("sendMessage", {
    chat_id: callbackQuery.from.id,
    text:
      `✅ Пробный Premium активен до ${formatDate(expiresAt)}.\n\n` +
      "Откройте «Моя подписка»: там ссылка Premium. Free-ссылка на это время перестаёт работать, " +
      "после окончания Premium она заработает снова."
  });

  await renderPremium(callbackQuery);
}

// Telegram waits only 10 seconds for this answer, so it does nothing but cheap checks.
export async function handlePreCheckout(query) {
  const answer = (ok, errorMessage) =>
    telegramRequest("answerPreCheckoutQuery", {
      pre_checkout_query_id: query.id,
      ok,
      ...(ok ? {} : { error_message: errorMessage })
    });

  try {
    const parsed = parsePayload(query.invoice_payload);
    const option = parsed ? findOption(parsed.optionId) : null;

    if (
      !parsed ||
      parsed.telegramId !== String(query.from.id) ||
      !option ||
      query.currency !== CURRENCY ||
      Number(query.total_amount) !== option.stars
    ) {
      await answer(false, "Цена или тариф изменились. Откройте Premium заново.");
      return;
    }

    const user = await getUserByTelegramId(query.from.id);

    if (!user) {
      await answer(false, "Сначала отправьте боту /start.");
      return;
    }

    await answer(true);
  } catch (error) {
    console.error("Pre-checkout error:", error);

    try {
      await answer(false, "Не удалось обработать заказ. Попробуйте позже.");
    } catch (inner) {
      console.error("Pre-checkout answer failed:", inner);
    }
  }
}

// Premium is granted only here, after Telegram confirmed the payment. Errors are thrown on
// purpose: the webhook then answers 500 and Telegram delivers the payment again.
export async function handleSuccessfulPayment(message) {
  const payment = message.successful_payment;
  const parsed = parsePayload(payment.invoice_payload);
  const option = parsed ? findOption(parsed.optionId) : null;

  if (payment.currency !== CURRENCY) {
    throw new Error(`Unexpected payment currency: ${payment.currency}`);
  }

  if (!parsed || parsed.telegramId !== String(message.from.id)) {
    throw new Error(`Unexpected payment payload: ${payment.invoice_payload}`);
  }

  if (!option) {
    throw new Error(`Paid option no longer exists: ${parsed.optionId}`);
  }

  const user = await getUserByTelegramId(message.from.id);

  if (!user) {
    throw new Error(`Payment from unknown user ${message.from.id}`);
  }

  const chargeId = payment.telegram_payment_charge_id;

  await recordPayment({
    userId: user.id,
    chargeId,
    providerChargeId: payment.provider_payment_charge_id || null,
    amount: Number(payment.total_amount),
    currency: payment.currency,
    payload: payment.invoice_payload,
    plan: "premium",
    days: option.days
  });

  // Only one delivery of this charge gets past here; repeats are ignored.
  if (!(await claimPayment(chargeId))) {
    return { duplicate: true };
  }

  const expiresAt = await grantPremium(user.id, option.days);

  await markGranted(chargeId, expiresAt);

  try {
    await telegramRequest("sendMessage", {
      chat_id: message.chat.id,
      text:
        `✅ Premium (${option.label}) активен до ${formatDate(expiresAt)}.\n\n` +
        "Откройте «Моя подписка» и обновите её в приложении: Free-ссылка на это время " +
        "перестаёт работать, нужна ссылка Premium."
    });
  } catch (error) {
    // the purchase is already granted; a failed notification must not undo or repeat it
    console.error("Payment confirmation failed:", error);
  }

  return { duplicate: false, expiresAt };
}

export async function handlePaySupport(message) {
  await telegramRequest("sendMessage", {
    chat_id: message.chat.id,
    text:
      "💳 Поддержка по оплате\n\n" +
      `Если с оплатой что-то пошло не так, напишите в поддержку: ${getProject().support}.`
  });
}
