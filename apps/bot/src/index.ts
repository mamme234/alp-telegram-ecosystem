import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const apiBaseUrl = process.env.BACKEND_URL || 'http://localhost:4000';

if (!token) {
  console.error('ALP Bot is not configured. Set TELEGRAM_BOT_TOKEN.');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

async function registerUser(msg: TelegramBot.Message) {
  const payload = {
    telegram_user_id: msg.from?.id,
    username: msg.from?.username || null,
    first_name: msg.from?.first_name || null,
    last_name: msg.from?.last_name || null,
    photo_url: msg.from?.photo_url || null,
    language_code: msg.from?.language_code || 'en',
  };

  const response = await fetch(`${apiBaseUrl}/api/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return response.ok ? await response.json() : null;
}

function buildMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Open ALP', web_app: { url: process.env.TELEGRAM_WEBAPP_URL || 'https://example.com' } },
      ]],
    },
  };
}

bot.onText(/\/start/, async (msg) => {
  await registerUser(msg);

  const text = `Welcome to ALP, ${msg.from?.first_name || 'friend'}!\n\nYour ALP account is ready. Open the app to view your balance, rewards, referrals, and tasks.`;

  await bot.sendMessage(msg.chat.id, text, buildMainMenu());
});

bot.onText(/\/help/, async (msg) => {
  const text = `ALP help:\n\n/start – start or refresh your ALP account\n/help – view commands\n/profile – view profile\n/balance – view balance\n/tasks – view active tasks\n/referral – manage referrals\n/leaderboard – view scoreboards\n/support – contact ALP support`;
  await bot.sendMessage(msg.chat.id, text, buildMainMenu());
});

bot.onText(/\/profile/, async (msg) => {
  const data = await registerUser(msg);
  const user = data?.user;
  const text = `ALP Profile\n\nName: ${user?.firstName || msg.from?.first_name || 'Unknown'}\nUsername: @${user?.username || msg.from?.username || 'unknown'}\nALP ID: ${user?.id || 'n/a'}`;
  await bot.sendMessage(msg.chat.id, text, buildMainMenu());
});

bot.onText(/\/balance/, async (msg) => {
  const data = await registerUser(msg);
  const wallet = data?.wallet;
  const text = `ALP Balance\n\nAvailable: ${wallet?.availableBalance ?? 0} points\nPending: ${wallet?.pendingBalance ?? 0} points\nTotal earned: ${wallet?.totalEarned ?? 0} points`;
  await bot.sendMessage(msg.chat.id, text, buildMainMenu());
});

bot.onText(/\/tasks/, async (msg) => {
  const user = await registerUser(msg);
  const response = await fetch(`${apiBaseUrl}/api/tasks`);
  const result = await response.json();
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];

  const list = tasks.length > 0
    ? tasks.slice(0, 5).map((task: any) => `• ${task.title} — ${task.reward} points`).join('\n')
    : 'No tasks are available yet.';

  const text = `Available tasks\n\n${list}`;
  await bot.sendMessage(msg.chat.id, text, buildMainMenu());
});

bot.onText(/\/referral/, async (msg) => {
  const user = await registerUser(msg);
  const response = await fetch(`${apiBaseUrl}/api/referrals`, {
    headers: { 'x-user-id': user?.user?.id || '' },
  });
  const result = await response.json();
  const text = `ALP referral link\n${result.referralLink || 'Unavailable'}\n\nTotal referrals: ${result.totalReferrals ?? 0}`;
  await bot.sendMessage(msg.chat.id, text, buildMainMenu());
});

bot.onText(/\/leaderboard/, async (msg) => {
  const response = await fetch(`${apiBaseUrl}/api/leaderboard`);
  const result = await response.json();
  const leaderboard = Array.isArray(result.leaderboard) ? result.leaderboard : [];
  const top = leaderboard.slice(0, 5).map((entry: any, index: number) => `${index + 1}. ${entry.label} — ${entry.score}`).join('\n');
  await bot.sendMessage(msg.chat.id, `ALP Leaderboard\n\n${top || 'No leaderboard data yet.'}`, buildMainMenu());
});

bot.onText(/\/support/, async (msg) => {
  await bot.sendMessage(msg.chat.id, 'ALP support is available through the admin dashboard and the support section in the ALP app. Please contact the platform administrator for help.', buildMainMenu());
});

bot.on('polling_error', (error) => {
  console.error('Bot polling error:', error.message);
});

console.log('ALP Bot started.');
