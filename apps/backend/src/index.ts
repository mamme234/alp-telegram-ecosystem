import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { PrismaClient, UserStatus, TaskStatus, SubmissionStatus, WalletTransactionType, WithdrawalStatus, AuditAction } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const PORT = Number(process.env.PORT || 4000);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const WEBAPP_URL = process.env.TELEGRAM_WEBAPP_URL || '';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

function safeNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getUserIdentifierFromHeader(req: Request): string | null {
  const explicitUser = req.headers['x-user-id'];
  if (typeof explicitUser === 'string' && explicitUser.length > 0) return explicitUser;
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  return null;
}

function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function serializeUser(user: any) {
  return {
    id: user.id,
    telegramUserId: user.telegramUserId.toString(),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    languageCode: user.languageCode,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function ensureSystemSettings() {
  const defaults = [
    { key: 'referral_reward', value: '50', description: 'Reward for a successful referral' },
    { key: 'task_grant_limit', value: '1', description: 'Limit number of reward grants per task completion' },
    { key: 'withdrawal_provider_enabled', value: process.env.WITHDRAWAL_PROVIDER_ENABLED === 'true' ? 'true' : 'false', description: 'Whether withdrawal provider enabled' },
    { key: 'mini_app_url', value: WEBAPP_URL || 'https://example.com', description: 'ALP Telegram Mini App URL' },
    { key: 'leaderboard_metric', value: 'total_earned', description: 'Leaderboard metric' },
  ];

  for (const item of defaults) {
    await prisma.systemSetting.upsert({
      where: { key: item.key },
      update: { value: item.value, description: item.description },
      create: { key: item.key, value: item.value, description: item.description },
    });
  }
}

async function createAuditLog(params: { adminId?: string; userId?: string; action: AuditAction; target?: string; metadata?: Record<string, any> }) {
  await prisma.auditLog.create({
    data: {
      adminId: params.adminId || null,
      userId: params.userId || null,
      action: params.action,
      target: params.target || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  }).catch(() => undefined);
}

async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || 'alpadmin';
  const secret = process.env.ADMIN_SECRET || 'change-me';
  if (!username || !secret) return;

  await prisma.admin.upsert({
    where: { username },
    update: { email: process.env.ADMIN_EMAIL || null, secretHash: crypto.createHash('sha256').update(secret).digest('hex') },
    create: {
      username,
      email: process.env.ADMIN_EMAIL || null,
      secretHash: crypto.createHash('sha256').update(secret).digest('hex'),
    },
  });
}

async function getUserByRequest(req: Request) {
  const userId = getUserIdentifierFromHeader(req);
  if (!userId) return null;

  return await prisma.user.findUnique({ where: { id: userId } });
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'CONNECTED';
  } catch (error) {
    return 'ERROR';
  }
}

function verifyTelegramInitData(initData: string | undefined, botToken: string): Record<string, string> | null {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;

  const dataToCheck: string[] = [];
  for (const [key, value] of Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (key === 'hash') continue;
    dataToCheck.push(`${key}=${value}`);
  }

  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataToCheck.join('\n')).digest('hex');

  if (computedHash !== hash) return null;

  const parsed: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (key !== 'hash') parsed[key] = value;
  }

  return parsed;
}

async function upsertTelegramUser(payload: {
  telegram_user_id: string | number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  photo_url?: string | null;
  language_code?: string | null;
}) {
  const telegramUserId = BigInt(payload.telegram_user_id);
  const existing = await prisma.user.findUnique({ where: { telegramUserId } });

  if (existing) {
    return await prisma.user.update({
      where: { id: existing.id },
      data: {
        username: payload.username || existing.username,
        firstName: payload.first_name || existing.firstName,
        lastName: payload.last_name || existing.lastName,
        photoUrl: payload.photo_url || existing.photoUrl,
        languageCode: payload.language_code || existing.languageCode,
      },
    });
  }

  const createdUser = await prisma.user.create({
    data: {
      telegramUserId,
      username: payload.username || null,
      firstName: payload.first_name || null,
      lastName: payload.last_name || null,
      photoUrl: payload.photo_url || null,
      languageCode: payload.language_code || null,
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.wallet.upsert({
    where: { userId: createdUser.id },
    update: {},
    create: { userId: createdUser.id, availableBalance: 0, pendingBalance: 0, totalEarned: 0, totalWithdrawn: 0 },
  });

  return createdUser;
}

async function awardPoints(userId: string, amount: number, type: WalletTransactionType, description: string, reference: string) {
  if (amount <= 0) return null;

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findUnique({ where: { reference } });
    if (existing) return existing;

    const wallet = await tx.wallet.upsert({
      where: { userId },
      update: {
        availableBalance: { increment: amount },
        totalEarned: { increment: amount },
        updatedAt: new Date(),
      },
      create: {
        userId,
        availableBalance: amount,
        pendingBalance: 0,
        totalEarned: amount,
        totalWithdrawn: 0,
      },
    });

    const transaction = await tx.walletTransaction.create({
      data: {
        userId,
        type,
        amount,
        description,
        reference,
        status: 'SUCCESS',
      },
    });

    return { wallet, transaction };
  });
}

async function createWithdrawalRequest(userId: string, amount: number, method: string, destination: string) {
  return await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new Error('Wallet not found');
    if (wallet.availableBalance < amount) throw new Error('Insufficient balance');

    const withdrawn = await tx.wallet.update({
      where: { userId },
      data: {
        availableBalance: { decrement: amount },
        pendingBalance: { increment: amount },
      },
    });

    const request = await tx.withdrawal.create({
      data: {
        userId,
        amount,
        method,
        destination,
        status: WithdrawalStatus.PENDING,
      },
    });

    await tx.walletTransaction.create({
      data: {
        userId,
        type: WalletTransactionType.WITHDRAWAL,
        amount: -amount,
        description: `Withdrawal request: ${method}`,
        reference: `withdrawal_${request.id}`,
        status: 'PENDING',
      },
    });

    return { wallet: withdrawn, request };
  });
}

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ ok: true, status: 'healthy', service: 'alp-backend' });
});

app.get('/api/system/status', async (req: Request, res: Response) => {
  try {
    const dbStatus = await checkDatabase();
    const botStatus = BOT_TOKEN ? 'CONNECTED' : 'NOT CONFIGURED';
    const miniAppStatus = WEBAPP_URL ? 'CONNECTED' : 'NOT CONFIGURED';
    const notificationStatus = BOT_TOKEN ? 'CONNECTED' : 'NOT CONFIGURED';
    const withdrawalStatus = process.env.WITHDRAWAL_PROVIDER_ENABLED === 'true' ? 'CONNECTED' : 'NOT CONFIGURED';

    res.json({
      backend: 'CONNECTED',
      database: dbStatus,
      telegramBot: botStatus,
      telegramMiniApp: miniAppStatus,
      notificationSystem: notificationStatus,
      withdrawalProvider: withdrawalStatus,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: 'ALP system status could not be retrieved.' });
  }
});

app.post('/api/auth/telegram', async (req: Request, res: Response) => {
  try {
    const { initData, telegram_user_id, username, first_name, last_name, photo_url, language_code } = req.body || {};
    if (!telegram_user_id && !initData) {
      return res.status(400).json({ error: 'Telegram identity data is required.' });
    }

    let verifiedData: Record<string, string> | null = null;
    if (initData) {
      verifiedData = verifyTelegramInitData(initData, BOT_TOKEN);
      if (!verifiedData) {
        return res.status(401).json({ error: 'Telegram authentication could not be verified.' });
      }
    }

    const payload = {
      telegram_user_id: verifiedData?.['user'] ? JSON.parse(verifiedData['user']).id : telegram_user_id,
      username: verifiedData?.['user'] ? JSON.parse(verifiedData['user']).username || username : username,
      first_name: verifiedData?.['user'] ? JSON.parse(verifiedData['user']).first_name || first_name : first_name,
      last_name: verifiedData?.['user'] ? JSON.parse(verifiedData['user']).last_name || last_name : last_name,
      photo_url: verifiedData?.['user'] ? JSON.parse(verifiedData['user']).photo_url || photo_url : photo_url,
      language_code: verifiedData?.['user'] ? JSON.parse(verifiedData['user']).language_code || language_code : language_code,
    };

    const user = await upsertTelegramUser(payload);
    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });

    return res.json({ ok: true, user: serializeUser(user), wallet });
  } catch (error: any) {
    return res.status(500).json({ error: 'Unable to load your ALP account. Please try again.' });
  }
});

app.get('/api/users/me', async (req: Request, res: Response) => {
  try {
    const user = await getUserByRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    const referrals = await prisma.referral.count({ where: { referrerId: user.id } });
    const recentActivity = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return res.json({
      user: serializeUser(user),
      wallet,
      referrals,
      recentActivity,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Unable to load your ALP account. Please try again.' });
  }
});

app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ tasks });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load tasks.' });
  }
});

app.post('/api/tasks/:id/submit', async (req: Request, res: Response) => {
  try {
    const user = await getUserByRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const taskId = req.params.id;
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    const existing = await prisma.taskSubmission.findFirst({ where: { taskId, userId: user.id } });
    if (existing && existing.status !== SubmissionStatus.REJECTED) {
      return res.status(409).json({ error: 'This task has already been submitted.' });
    }

    const submission = await prisma.taskSubmission.create({
      data: {
        userId: user.id,
        taskId,
        rewardAmount: task.reward,
        status: SubmissionStatus.PENDING,
        notes: req.body?.notes || '',
      },
    });

    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Task submitted',
        message: `Your completion for “${task.title}” is pending verification.`,
        channel: 'TELEGRAM',
        status: 'QUEUED',
      },
    });

    res.json({ ok: true, submission });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to submit the task.' });
  }
});

app.get('/api/referrals', async (req: Request, res: Response) => {
  try {
    const user = await getUserByRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const code = `${user.telegramUserId.toString().slice(-6)}`.toUpperCase();
    const referralLink = `https://t.me/ALP_BOT?start=${code}`;

    const history = await prisma.referral.findMany({
      where: { referrerId: user.id },
      orderBy: { createdAt: 'desc' },
    });

    const totalReferrals = await prisma.referral.count({ where: { referrerId: user.id } });
    const successfulReferrals = await prisma.referral.count({ where: { referrerId: user.id, status: 'SUCCESS' } });
    const totalRewards = await prisma.walletTransaction.aggregate({
      where: { userId: user.id, type: WalletTransactionType.REFERRAL_REWARD },
      _sum: { amount: true },
    });

    res.json({
      code,
      referralLink,
      totalReferrals,
      successfulReferrals,
      referralRewards: totalRewards._sum.amount || 0,
      history,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load referral information.' });
  }
});

app.get('/api/wallet', async (req: Request, res: Response) => {
  try {
    const user = await getUserByRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    const transactions = await prisma.walletTransaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    res.json({ wallet, transactions });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load wallet information.' });
  }
});

app.post('/api/withdrawals', async (req: Request, res: Response) => {
  try {
    const user = await getUserByRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    if (process.env.WITHDRAWAL_PROVIDER_ENABLED !== 'true') {
      return res.status(503).json({
        error: 'Withdrawals are currently unavailable because no payment provider is configured.',
      });
    }

    const amount = safeNumber(req.body?.amount);
    const method = String(req.body?.method || '').trim();
    const destination = String(req.body?.destination || '').trim();

    if (!amount || amount <= 0 || !method || !destination) {
      return res.status(400).json({ error: 'Withdrawal amount, method, and destination are required.' });
    }

    const result = await createWithdrawalRequest(user.id, amount, method, destination);
    res.json({ ok: true, withdrawal: result.request });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Unable to create withdrawal request.' });
  }
});

app.get('/api/notifications', async (req: Request, res: Response) => {
  try {
    const user = await getUserByRequest(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized.' });

    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });

    res.json({ notifications });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load notifications.' });
  }
});

app.get('/api/leaderboard', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { wallet: true },
      where: { status: UserStatus.ACTIVE },
    });

    const rows = users
      .map((user) => ({
        userId: user.id,
        label: user.username || `${user.firstName || 'ALP'} ${user.lastName || ''}`.trim() || `User ${user.telegramUserId}`,
        score: user.wallet?.totalEarned || 0,
      }))
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

    res.json({ leaderboard: rows.map((row, index) => ({ ...row, rank: index + 1 })) });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load leaderboard.' });
  }
});

app.get('/api/announcements', async (req: Request, res: Response) => {
  try {
    const items = await prisma.announcement.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishAt: 'desc' },
    });
    res.json({ announcements: items });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load announcements.' });
  }
});

app.post('/api/admin/login', async (req: Request, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    const expectedUsername = process.env.ADMIN_USERNAME || 'alpadmin';
    const expectedPassword = process.env.ADMIN_SECRET || 'change-me';

    if (username !== expectedUsername || password !== expectedPassword) {
      return res.status(401).json({ error: 'Unauthorized admin access.' });
    }

    const admin = await prisma.admin.upsert({
      where: { username },
      update: { email: process.env.ADMIN_EMAIL || null },
      create: { username, email: process.env.ADMIN_EMAIL || null, secretHash: crypto.createHash('sha256').update(expectedPassword).digest('hex') },
    });

    await createAuditLog({ adminId: admin.id, action: AuditAction.ADMIN_LOGIN, target: 'admin', metadata: { username } });

    return res.json({ ok: true, admin: { id: admin.id, username: admin.username, email: admin.email } });
  } catch (error: any) {
    return res.status(500).json({ error: 'Admin login failed.' });
  }
});

app.use('/api/admin', async (req: Request, res: Response, next: NextFunction) => {
  const adminUsername = String(req.headers['x-admin-username'] || '');
  const adminSecret = String(req.headers['x-admin-secret'] || '');
  const expectedUsername = process.env.ADMIN_USERNAME || 'alpadmin';
  const expectedSecret = process.env.ADMIN_SECRET || 'change-me';

  if (adminUsername !== expectedUsername || adminSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Admin access required.' });
  }

  next();
});

app.get('/api/admin/dashboard', async (req: Request, res: Response) => {
  try {
    const [totalUsers, activeUsers, newUsers, totalRewards, pendingWithdrawals, completedTasks, referralCount] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      prisma.user.count({ where: { createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) } } }),
      prisma.walletTransaction.aggregate({ _sum: { amount: true } }),
      prisma.withdrawal.count({ where: { status: WithdrawalStatus.PENDING } }),
      prisma.taskSubmission.count({ where: { status: SubmissionStatus.APPROVED } }),
      prisma.referral.count(),
    ]);

    res.json({
      statistics: {
        totalUsers,
        activeUsers,
        newUsers,
        totalRewards: totalRewards._sum.amount || 0,
        pendingWithdrawals,
        completedTasks,
        referralCount,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load admin dashboard.' });
  }
});

app.get('/api/admin/users', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { wallet: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users: users.map((user) => ({ ...serializeUser(user), wallet: user.wallet })) });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load users.' });
  }
});

app.post('/api/admin/tasks', async (req: Request, res: Response) => {
  try {
    const data = req.body || {};
    const task = await prisma.task.create({
      data: {
        title: String(data.title || '').trim(),
        description: String(data.description || '').trim(),
        reward: safeNumber(data.reward),
        type: String(data.type || 'OTHER').toUpperCase(),
        requirements: String(data.requirements || '').trim(),
        status: TaskStatus.AVAILABLE,
        startAt: data.startAt ? new Date(data.startAt) : null,
        endAt: data.endAt ? new Date(data.endAt) : null,
      },
    });

    await createAuditLog({ action: AuditAction.TASK_CREATION, target: task.id, metadata: { title: task.title, reward: task.reward } });
    res.json({ ok: true, task });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to create task.' });
  }
});

app.patch('/api/admin/tasks/:id', async (req: Request, res: Response) => {
  try {
    const updated = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        title: req.body.title,
        description: req.body.description,
        reward: req.body.reward,
        requirements: req.body.requirements,
        status: req.body.status,
        startAt: req.body.startAt ? new Date(req.body.startAt) : undefined,
        endAt: req.body.endAt ? new Date(req.body.endAt) : undefined,
      },
    });

    await createAuditLog({ action: AuditAction.TASK_MODIFICATION, target: updated.id, metadata: { title: updated.title } });
    res.json({ ok: true, task: updated });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to update task.' });
  }
});

app.post('/api/admin/task-submissions/:id/approve', async (req: Request, res: Response) => {
  try {
    const submission = await prisma.taskSubmission.update({
      where: { id: req.params.id },
      data: { status: SubmissionStatus.APPROVED },
      include: { task: true, user: true },
    });

    await awardPoints(submission.userId, submission.rewardAmount, WalletTransactionType.TASK_REWARD, `Task reward: ${submission.task.title}`, `task_reward_${submission.id}`);

    await prisma.notification.create({
      data: {
        userId: submission.userId,
        title: 'Reward credited',
        message: `ALP credited ${submission.rewardAmount} points for “${submission.task.title}”.`,
        channel: 'TELEGRAM',
        status: 'QUEUED',
      },
    });

    await createAuditLog({ action: AuditAction.REWARD_ADJUSTMENT, target: submission.id, metadata: { userId: submission.userId, amount: submission.rewardAmount } });
    res.json({ ok: true, submission });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to approve the task submission.' });
  }
});

app.post('/api/admin/task-submissions/:id/reject', async (req: Request, res: Response) => {
  try {
    const submission = await prisma.taskSubmission.update({
      where: { id: req.params.id },
      data: { status: SubmissionStatus.REJECTED, notes: req.body?.reason || 'Rejected by admin' },
    });
    res.json({ ok: true, submission });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to reject the task submission.' });
  }
});

app.patch('/api/admin/users/:id/suspend', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: UserStatus.SUSPENDED } });
    await createAuditLog({ action: AuditAction.USER_SUSPENSION, target: user.id, metadata: { status: 'SUSPENDED' } });
    res.json({ ok: true, user });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to suspend user.' });
  }
});

app.patch('/api/admin/users/:id/reactivate', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: UserStatus.ACTIVE } });
    await createAuditLog({ action: AuditAction.USER_REACTIVATION, target: user.id, metadata: { status: 'ACTIVE' } });
    res.json({ ok: true, user });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to reactivate user.' });
  }
});

app.get('/api/admin/withdrawals', async (req: Request, res: Response) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { requestedAt: 'desc' },
      include: { user: true },
    });
    res.json({ withdrawals });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load withdrawals.' });
  }
});

app.post('/api/admin/withdrawals/:id/:action', async (req: Request, res: Response) => {
  try {
    const action = req.params.action;
    const valid = ['approve', 'reject', 'processing', 'complete'];
    if (!valid.includes(action)) return res.status(400).json({ error: 'Invalid action.' });

    const statusMap: Record<string, WithdrawalStatus> = {
      approve: WithdrawalStatus.APPROVED,
      reject: WithdrawalStatus.REJECTED,
      processing: WithdrawalStatus.PROCESSING,
      complete: WithdrawalStatus.COMPLETED,
    };

    const withdrawal = await prisma.withdrawal.update({
      where: { id: req.params.id },
      data: { status: statusMap[action], reviewedAt: new Date(), reason: req.body?.reason || null },
    });

    await createAuditLog({ action: action === 'approve' ? AuditAction.WITHDRAWAL_APPROVAL : action === 'reject' ? AuditAction.WITHDRAWAL_REJECTION : AuditAction.WITHDRAWAL_APPROVAL, target: withdrawal.id, metadata: { status: withdrawal.status } });
    res.json({ ok: true, withdrawal });
  } catch (error: any) {
    res.status(500).json({ error: 'Withdrawal action could not be processed.' });
  }
});

app.get('/api/admin/announcements', async (req: Request, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ announcements });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load announcements.' });
  }
});

app.post('/api/admin/announcements', async (req: Request, res: Response) => {
  try {
    const announcement = await prisma.announcement.create({
      data: {
        title: String(req.body?.title || '').trim(),
        message: String(req.body?.message || '').trim(),
        status: String(req.body?.status || 'DRAFT').toUpperCase() === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
        publishAt: req.body?.publishAt ? new Date(req.body.publishAt) : new Date(),
      },
    });

    await createAuditLog({ action: AuditAction.ANNOUNCEMENT_PUBLISH, target: announcement.id, metadata: { title: announcement.title } });
    res.json({ ok: true, announcement });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to create announcement.' });
  }
});

app.get('/api/admin/audit-logs', async (req: Request, res: Response) => {
  try {
    const auditLogs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json({ auditLogs });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load audit logs.' });
  }
});

app.post('/api/admin/system-settings', async (req: Request, res: Response) => {
  try {
    const key = String(req.body?.key || '').trim();
    const value = String(req.body?.value || '').trim();
    const description = String(req.body?.description || '').trim();

    if (!key) return res.status(400).json({ error: 'Setting key is required.' });

    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description },
    });

    await createAuditLog({ action: AuditAction.SYSTEM_SETTING_CHANGE, target: setting.key, metadata: { value } });
    res.json({ ok: true, setting });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to save settings.' });
  }
});

app.get('/api/admin/system-settings', async (req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: 'Unable to load settings.' });
  }
});

async function bootstrap() {
  await ensureSystemSettings();
  await ensureAdmin();
  const tasks = await prisma.task.count();
  if (tasks === 0) {
    await prisma.task.create({
      data: {
        title: 'Complete onboarding profile',
        description: 'Finish your ALP onboarding and confirm your profile details.',
        reward: 25,
        type: 'SOCIAL',
        requirements: 'Profile must be complete.',
        status: 'AVAILABLE',
      },
    }).catch(() => undefined);
  }
}

bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error);
});

app.listen(PORT, () => {
  console.log(`ALP backend running on port ${PORT}`);
});

export default app;
