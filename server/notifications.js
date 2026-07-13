// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Cegin Contributors
// This file is part of Cegin — https://github.com/cmadzz/cegin
// =============================================================================
// Chef Terry's Notification Engine
//
// Sends push notifications via Expo Push API.
// No extra app needed — uses native Android/iOS notification system.
//
// Flow:
//   1. Mobile app registers for a push token (expo-notifications)
//   2. Token gets saved to the server DB
//   3. Cron jobs call sendNotification() which posts to Expo's push service
//   4. Phone buzzes with a native notification
//
// Expo Push API: https://docs.expo.dev/push-notifications/sending-notifications/
// =============================================================================

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification to one or more Expo push tokens.
 *
 * @param {string[]} tokens - Array of Expo push tokens
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} [opts] - Optional overrides
 * @param {string} [opts.sound] - Sound name (default: 'default')
 * @param {number} [opts.badge] - Badge count
 * @param {string} [opts.data] - Extra data payload
 * @returns {Promise<{sent: number, failed: number}>}
 */
async function sendPush(tokens, title, body, opts = {}) {
  if (!tokens || tokens.length === 0) return { sent: 0, failed: 0 };

  // Build the messages array — one per token
  const messages = tokens.map(token => ({
    to: token,
    sound: opts.sound || 'default',
    title: title || 'Chef Terry',
    body: body || '',
    data: opts.data || {},
    ...(opts.badge !== undefined ? { badge: opts.badge } : {}),
  }));

  try {
    const resp = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[expo-push] HTTP ${resp.status}: ${text}`);
      return { sent: 0, failed: tokens.length };
    }

    const result = await resp.json();
    const tickets = result.data || [];

    // Check for errors in tickets
    let sent = 0, failed = 0;
    for (const ticket of tickets) {
      if (ticket.status === 'ok') {
        sent++;
      } else {
        failed++;
        console.error(`[expo-push] Ticket error for token: ${ticket.message} (${ticket.details?.error})`);
      }
    }

    console.log(`[expo-push] Sent ${sent}/${tokens.length} notifications for "${title}"`);
    return { sent, failed };
  } catch (err) {
    console.error(`[expo-push] Send error:`, err.message);
    return { sent: 0, failed: tokens.length };
  }
}

/**
 * Send the morning digest notification.
 *
 * @param {string[]} tokens - User's Expo push tokens
 * @param {Array} todayMeals - Array of { meal, title, prep_minutes, cook_minutes, ingredients }
 */
async function sendMorningDigest(tokens, todayMeals) {
  if (!todayMeals || todayMeals.length === 0) {
    return sendPush(tokens,
      '🌅 Good morning!',
      "You haven't planned any meals for today yet. Want me to suggest something?"
    );
  }

  // Find the most important meal (dinner > lunch > breakfast > snack > dessert)
  const priority = ['dinner', 'lunch', 'breakfast', 'snack', 'dessert'];
  const sorted = [...todayMeals].sort((a, b) =>
    priority.indexOf(a.meal) - priority.indexOf(b.meal)
  );

  const mainMeal = sorted[0];
  const mealLabel = mainMeal.meal.charAt(0).toUpperCase() + mainMeal.meal.slice(1);

  // Build prep reminder based on cook time
  let prepHint = '';
  const totalMinutes = (mainMeal.prep_minutes || 0) + (mainMeal.cook_minutes || 0);
  if (totalMinutes > 60) {
    prepHint = `\n⏱ ~${totalMinutes} min total — start prep early!`;
  } else if (mainMeal.prep_minutes > 15) {
    prepHint = `\n🔪 ${mainMeal.prep_minutes} min prep needed.`;
  }

  // Smart ingredient tips
  let ingredientTip = '';
  try {
    const ingredients = JSON.parse(mainMeal.ingredients || '[]');
    const lower = ingredients.map(i => (typeof i === 'string' ? i : i.name || '').toLowerCase());

    if (lower.some(i => i.includes('sourdough') || i.includes('starter'))) {
      ingredientTip += '\n🫙 Take the starter out of the fridge!';
    }
    if (lower.some(i => i.includes('frozen') || i.includes('chicken') || i.includes('beef'))) {
      ingredientTip += '\n🧊 Check if anything needs defrosting.';
    }
  } catch {}

  // Multiple meals summary
  let summary = '';
  if (sorted.length > 1) {
    const others = sorted.slice(1).map(m => {
      const label = m.meal.charAt(0).toUpperCase() + m.meal.slice(1);
      return `${label}: ${m.title}`;
    }).join(', ');
    summary = `\n📋 Also: ${others}`;
  }

  return sendPush(tokens, `🍳 ${mealLabel}: ${mainMeal.title}`, `${prepHint}${ingredientTip}${summary}`.trim());
}

/**
 * Send a perishable item alert.
 *
 * @param {string[]} tokens - User's Expo push tokens
 * @param {Array} expiringItems - Array of { item_name, expires_at }
 * @param {Array} expiredItems - Array of already-expired items
 */
async function sendPerishableAlert(tokens, expiringItems, expiredItems) {
  const lines = [];

  if (expiredItems && expiredItems.length > 0) {
    lines.push(`🚨 Expired: ${expiredItems.map(i => i.item_name).join(', ')}`);
  }

  if (expiringItems && expiringItems.length > 0) {
    const names = expiringItems.map(i => {
      const daysLeft = Math.ceil((new Date(i.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
      return `${i.item_name} (${daysLeft}d)`;
    }).join(', ');
    lines.push(`⏰ Expiring soon: ${names}`);
  }

  if (lines.length === 0) return { sent: 0, failed: 0 };

  lines.push('Should we swap a meal to use these up?');

  return sendPush(tokens, '🥬 Fridge Alert', lines.join('\n'));
}

module.exports = { sendPush, sendMorningDigest, sendPerishableAlert };
