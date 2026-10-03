import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebAppUrl: process.env.TELEGRAM_WEBAPP_URL || '',
  adminSecret: process.env.ADMIN_SECRET || 'change-me',
  adminUsername: process.env.ADMIN_USERNAME || 'alpadmin',
};
