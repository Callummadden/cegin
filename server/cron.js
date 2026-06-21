// =============================================================================
// Chef Terry's Cron Scheduler
//
// Runs inside the Express server container.
// Checks every minute if it's time to fire a scheduled notification.
//
// Jobs:
//   1. Morning Digest — 8:00 AM daily
//      Checks today's meal plan, sends prep reminders.
//
//   2. Perishable Alert — every 6 hours (8am, 2pm, 8pm)
//      Checks scanned fridge items for expiring/expired ingredients.
// =============================================================================

const dbModule = require('./db');
const { sendMorningDigest, sendPerishableAlert } = require('./notifications');

// Track which jobs have already fired today (reset at midnight)
let lastMorningDigest = null;    // 'YYYY-MM-DD'
let lastPerishableCheck = null;  // 'YYYY-MM-DD-HH' (hour bucket)

const getDateString = dbModule.localDateStr;

/**
 * Morning Digest Job
 * Fires at 8:00 AM server time.
 */
async function runMorningDigest() {
  const now = new Date();
  const hour = now.getHours();
  const today = getDateString();

  // Only fire at 8 AM, and only once per day
  if (hour !== 8 || lastMorningDigest === today) return;

  lastMorningDigest = today;
  console.log('[cron] Running morning digest...');

  try {
    const subscribers = dbModule.getSubscribedUsers();
    let sentCount = 0;

    for (const user of subscribers) {
      if (!user.morning_digest || user.push_tokens.length === 0) continue;

      const todayMeals = dbModule.getTodayMeals(user.user_id);
      const result = await sendMorningDigest(user.push_tokens, todayMeals);
      if (result.sent > 0) sentCount++;
    }

    console.log(`[cron] Morning digest sent to ${sentCount} subscribers`);
  } catch (err) {
    console.error('[cron] Morning digest error:', err.message);
  }
}

/**
 * Perishable Alert Job
 * Fires at 8am, 2pm, 8pm.
 */
async function runPerishableAlert() {
  const now = new Date();
  const hour = now.getHours();
  const today = getDateString();

  // Fire at 8am, 2pm, 8pm
  if (![8, 14, 20].includes(hour)) return;

  const bucket = `${today}-${hour}`;
  if (lastPerishableCheck === bucket) return;

  lastPerishableCheck = bucket;
  console.log('[cron] Running perishable alert check...');

  try {
    const subscribers = dbModule.getSubscribedUsers();
    let alertCount = 0;

    for (const user of subscribers) {
      if (!user.perishable_alerts || user.push_tokens.length === 0) continue;

      const expiring = dbModule.getExpiringItems(user.user_id, 2); // within 2 days
      const expired = dbModule.getExpiredItems(user.user_id);

      if (expiring.length > 0 || expired.length > 0) {
        const result = await sendPerishableAlert(user.push_tokens, expiring, expired);
        if (result.sent > 0) alertCount++;
      }
    }

    console.log(`[cron] Perishable alerts sent to ${alertCount} subscribers`);
  } catch (err) {
    console.error('[cron] Perishable alert error:', err.message);
  }
}

/**
 * Start the cron scheduler.
 * Checks every 60 seconds.
 */
function startCron() {
  console.log('[cron] Chef Terry\'s notification engine started');

  // Run immediately on startup (in case we missed a window)
  runMorningDigest().catch(() => {});
  runPerishableAlert().catch(() => {});

  // Check every 60 seconds
  setInterval(() => {
    runMorningDigest().catch(() => {});
    runPerishableAlert().catch(() => {});
  }, 60 * 1000);
}

module.exports = { startCron };
