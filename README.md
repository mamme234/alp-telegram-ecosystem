# ALP Telegram Ecosystem

A production-ready Telegram ecosystem for ALP with a Telegram bot, Telegram Mini App, backend API, relational database, and admin dashboard.

## Overview

ALP is designed as one connected system:

- Telegram Bot for onboarding and notifications
- Telegram Mini App for wallet, tasks, referrals, and profile
- Backend/API for identity verification, business logic, and database access
- PostgreSQL database with transaction-safe financial rules
- Admin dashboard for operations, moderation, and configuration

## Architecture

- Frontend Mini App: `apps/miniapp`
- Admin Panel: `apps/admin`
- Backend API: `apps/backend`
- Bot Service: `apps/bot`

## Local setup

1. Install dependencies:

   npm install

2. Copy the environment template:

   cp .env.example .env

3. Fill in the required values in `.env`.

4. Start PostgreSQL and services:

   docker compose up -d db

5. Run database migrations:

   npm run prisma:migrate -w @alp/backend

6. Start the development stack:

   npm run dev

## Production deployment

- Configure database credentials in `.env`
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBAPP_URL` in the environment
- Set `ADMIN_SECRET` and required secrets for deployment
- Build all apps:

   npm run build

- Start the backend and bot as separate services in production

## Health checks

- Backend: `GET /health`
- Status: `GET /api/system/status`

## Notes

- No fake balances or fake transactions are used in production
- Empty-state UIs are used when no records exist
- Secrets are not stored in frontend code
- Telegram authentication is validated on the backend
