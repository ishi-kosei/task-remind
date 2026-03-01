require('dotenv').config();
const express = require('express');
const { validateSignature, messagingApi } = require('@line/bot-sdk');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);
const db = require('./db');
const scheduler = require('./scheduler');
const { getTargetUserId } = require('./line');
const { parseTask } = require('./parser');

const app = express();

// ── LINE ヘルパー ──────────────────────────────────────────
const HELP_TEXT =
`📝 タスク追加の例:
・明日 〇〇さんに連絡
・3/5 打ち合わせ 14:00
・今日 資料作成 15時30分
・3月10日 企画書提出

📋 コマンド:
「リスト」→ 今日のタスク一覧
「ヘルプ」→ この説明`;

async function reply(client, replyToken, text) {
  if (!client || !replyToken) return;
  await client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text }]
  }).catch(console.error);
}

// LINE Webhook：署名検証のため生のリクエストボディが必要
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['x-line-signature'];

  if (!validateSignature(req.body, process.env.LINE_CHANNEL_SECRET || '', sig)) {
    console.log('[Webhook] 署名検証失敗');
    return res.status(401).send('Unauthorized');
  }

  res.sendStatus(200);

  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch {
    console.log('[Webhook] JSONパース失敗');
    return;
  }

  console.log('[Webhook] イベント数:', body.events?.length ?? 0);

  const lineClient = process.env.LINE_CHANNEL_ACCESS_TOKEN
    ? new messagingApi.MessagingApiClient({
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
      })
    : null;

  if (!lineClient) console.log('[Webhook] LINE_CHANNEL_ACCESS_TOKEN が未設定');

  for (const event of body.events || []) {
    if (event.type !== 'message' || event.message?.type !== 'text' || !event.source?.userId) continue;

    const userId = event.source.userId;
    const text   = event.message.text.trim();
    console.log('[Webhook] メッセージ受信:', text);

    // ── 初回メッセージ：ユーザーID登録 ──────────────────
    const saved = await db.getSetting('line_user_id').catch(() => null);
    if (!saved) {
      await db.setSetting('line_user_id', userId);
      await reply(lineClient, event.replyToken,
        `✅ LINE通知を設定しました！\n\nタスクを追加するにはこんな感じで送ってね👇\n\n${HELP_TEXT}`
      );
      continue;
    }

    // ── コマンド分岐 ─────────────────────────────────────
    if (/^(リスト|一覧|タスク|list)$/i.test(text)) {
      // 今日のタスク一覧を返信
      const tasks = await db.getTodayTasks();
      const now   = dayjs().tz('Asia/Tokyo');
      const dateStr = now.format('M/D');
      const days    = ['日','月','火','水','木','金','土'];
      if (tasks.length === 0) {
        await reply(lineClient, event.replyToken, `📋 今日（${dateStr}）のタスクはありません ✨`);
      } else {
        const lines = tasks.map(t => {
          const time = t.due_time ? ` ⏰ ${String(t.due_time).slice(0,5)}` : '';
          return `・${t.title}${time}`;
        }).join('\n');
        await reply(lineClient, event.replyToken,
          `📋 今日のタスク - ${dateStr}(${days[now.day()]})\n\n${lines}\n\n未完了: ${tasks.length}件`
        );
      }
      continue;
    }

    if (/^(ヘルプ|help|\?)$/i.test(text)) {
      await reply(lineClient, event.replyToken, HELP_TEXT);
      continue;
    }

    // ── タスク追加パース ──────────────────────────────────
    const { title, dueDate, dueTime } = await parseTask(text);

    if (!title) {
      await reply(lineClient, event.replyToken,
        `⚠️ タスク内容が読み取れませんでした。\n\n${HELP_TEXT}`
      );
      continue;
    }
    if (!dueDate) {
      await reply(lineClient, event.replyToken,
        `⚠️ 期限日が読み取れませんでした。\n日付を入れて送ってね！\n\n例: 「明日 ${title}」`
      );
      continue;
    }

    const task = await db.createTask(title, dueDate, dueTime || null);
    const d    = dayjs(task.due_date).tz('Asia/Tokyo');
    const dateLabel = d.format('M/D');
    const timeLabel = task.due_time ? ` ${String(task.due_time).slice(0,5)}` : '';
    await reply(lineClient, event.replyToken,
      `✅ タスクを追加しました！\n\n📌 ${task.title}\n📅 ${dateLabel}${timeLabel}`
    );
  }
});

app.use(express.json());
app.use(express.static('public'));

// タスク一覧取得
app.get('/api/tasks', async (req, res) => {
  try {
    res.json(await db.getTasks());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// タスク作成
app.post('/api/tasks', async (req, res) => {
  try {
    const { title, due_date, due_time } = req.body;
    if (!title?.trim() || !due_date) {
      return res.status(400).json({ error: 'title と due_date は必須です' });
    }
    res.json(await db.createTask(title.trim(), due_date, due_time || null));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// タスク完了
app.patch('/api/tasks/:id/complete', async (req, res) => {
  try {
    await db.completeTask(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// タスク削除
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await db.deleteTask(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// LINE連携状態確認
app.get('/api/status', async (req, res) => {
  try {
    const userId = await getTargetUserId();
    res.json({ lineConnected: !!userId });
  } catch {
    res.json({ lineConnected: false });
  }
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => {
    scheduler.start();
    app.listen(PORT, () => console.log(`サーバー起動: port ${PORT}`));
  })
  .catch(err => {
    console.error('起動失敗:', err);
    process.exit(1);
  });
