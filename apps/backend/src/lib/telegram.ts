import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';

export function buildTelegramInitDataFromUser(user: { id: number; username?: string; first_name?: string; last_name?: string; photo_url?: string; language_code?: string }) {
  const payload = new URLSearchParams({
    user: JSON.stringify({
      id: user.id,
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      photo_url: user.photo_url || '',
      language_code: user.language_code || 'en',
    }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  });

  return payload.toString();
}

export function verifyTelegramInitData(initData: string | undefined, botToken: string) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  Array.from(params.keys()).forEach((key) => {
    if (key === 'hash') params.delete(key);
  });

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return calculatedHash === hash ? Object.fromEntries(new URLSearchParams(initData).entries()) : null;
}

export function createBotClient(token: string) {
  if (!token) {
    throw new Error('ALP Bot is not configured.');
  }

  return new TelegramBot(token, { polling: true });
}
