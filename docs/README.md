# ALP Telegram Ecosystem

## Overview

ALP is a production-oriented Telegram ecosystem formed by a Telegram Bot, Telegram Mini App, backend API, PostgreSQL database, and admin dashboard. The bot and mini app share the same backend and user store, and all financial actions are recorded in durable database transactions.

## Included components

- Telegram bot for onboarding and commands
- Telegram Mini App with premium mobile-first dashboard
- Backend API with Telegram WebApp verification
- Prisma-managed PostgreSQL schema
- Admin dashboard with configuration status and system monitoring

## Local development

1. Copy `.env.example` to `.env`
2. Ensure PostgreSQL is running
3. Install dependencies: `npm install`
4. Run Prisma migration: `npm run prisma:migrate`
5. Start the full stack: `npm run dev`

## App ports

- Backend: 4000
- Mini App: 3001
- Admin: 3002

## Production deployment

- Configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBAPP_URL`, `DATABASE_URL`, and `ADMIN_SECRET`
- Build: `npm run build`
- Start the backend and bot as deployed services
- Keep secrets server-side only

## Notes

- Empty states are used when no real data exists
- No fake balances or fake transactions are committed in production
- Telegram authentication is validated on the server before trusting app identity
