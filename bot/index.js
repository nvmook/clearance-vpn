import { getConfig } from "../lib/config.js";

import { helpText } from "./texts.js";

import {
  handleDevices,
  handleDeleteDevice,
  handleRestoreMenu,
  handleRestoreDevice
} from "./handlers/devices.js";

import {
  showPremium,
  handleBuyPremium,
  handleTrialPremium,
  handlePreCheckout,
  handleSuccessfulPayment,
  handlePaySupport
} from "./handlers/premium.js";

import { handleStart } from "./handlers/start.js";
import { handleSubscription } from "./handlers/subscription.js";
import { getMainKeyboard } from "./keyboards/main.js";

import {
  answerCallback,
  getMenuPhoto,
  showScreen
} from "./telegram.js";

const mainMenuMessage =
  "Выбери нужный раздел:";

function isAdmin(telegramId) {
  const adminIds = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean);

  return adminIds.includes(String(telegramId));
}

async function showTextSection(
  callbackQuery,
  text,
  replyMarkup
) {
  await showScreen(callbackQuery, {
    text,
    replyMarkup
  });
}

async function showMainMenu(callbackQuery) {
  await showScreen(callbackQuery, {
    text: mainMenuMessage,
    replyMarkup: getMainKeyboard(),
    photo: getMenuPhoto()
  });
}

function getBackKeyboard() {
  return {
    inline_keyboard: [
      [
        {
          text: "Назад",
          callback_data: "back",
          icon_custom_emoji_id: "5877629862306385808"
        }
      ]
    ]
  };
}

async function showStats(callbackQuery) {
  await showTextSection(
    callbackQuery,
    "📊 Статистика\n\n" +
      "Статистика пользователя скоро будет доступна.",
    getBackKeyboard()
  );
}

async function showHelp(callbackQuery) {
  await showTextSection(
    callbackQuery,
    helpText(),
    getBackKeyboard()
  );
}

export async function handleUpdate(update) {
  const config = getConfig();

  // Payments are handled before the maintenance check: a user who already paid must get Premium,
  // and Telegram cancels a payment that is not confirmed within 10 seconds.
  if (update?.pre_checkout_query) {
    await handlePreCheckout(update.pre_checkout_query);
    return;
  }

  if (update?.message?.successful_payment) {
    await handleSuccessfulPayment(update.message);
    return;
  }

  if (update?.message) {
    if (/^\/paysupport(@\w+)?(\s|$)/.test(update.message.text || "")) {
      await handlePaySupport(update.message);
      return;
    }

    if (/^\/start(@\w+)?(\s|$)/.test(update.message.text || "")) {
      await handleStart(
        update.message,
        config.maintenance,
        isAdmin(update.message.from?.id)
      );
    }

    return;
  }

  if (!update?.callback_query) {
    return;
  }

  const callbackQuery = update.callback_query;

  if (
    config.maintenance &&
    !isAdmin(callbackQuery.from?.id)
  ) {
    await answerCallback(
      callbackQuery.id,
      "🛠 Бот временно находится на технических работах"
    );

    return;
  }

  const data = callbackQuery.data || "";

  if (data === "back") {
    await answerCallback(callbackQuery.id);
    await showMainMenu(callbackQuery);
    return;
  }

  if (data === "subscription") {
    await handleSubscription(callbackQuery);
    return;
  }

  if (data === "devices") {
    await handleDevices(callbackQuery);
    return;
  }

  if (data === "restore_menu") {
    await handleRestoreMenu(callbackQuery);
    return;
  }

  if (data.startsWith("delete_device:")) {
    const deviceId = Number(data.split(":")[1]);

    if (Number.isInteger(deviceId)) {
      await handleDeleteDevice(callbackQuery, deviceId);
      return;
    }
  }

  if (data.startsWith("restore_device:")) {
    const deviceId = Number(data.split(":")[1]);

    if (Number.isInteger(deviceId)) {
      await handleRestoreDevice(callbackQuery, deviceId);
      return;
    }
  }

  if (data === "premium") {
    await showPremium(callbackQuery);
    return;
  }

  if (data.startsWith("buy_premium:")) {
    await handleBuyPremium(callbackQuery, data.slice("buy_premium:".length));
    return;
  }

  if (data === "trial_premium") {
    await handleTrialPremium(callbackQuery);
    return;
  }

  if (data === "stats") {
    await answerCallback(callbackQuery.id);
    await showStats(callbackQuery);
    return;
  }

  if (data === "help") {
    await answerCallback(callbackQuery.id);
    await showHelp(callbackQuery);
    return;
  }

  await answerCallback(callbackQuery.id);
}
