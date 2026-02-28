const { messagingApi } = require('@line/bot-sdk');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const db = require('./db');

let _client = null;

function getClient() {
  if (!_client && process.env.LINE_CHANNEL_ACCESS_TOKEN) {
    _client = new messagingApi.MessagingApiClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
    });
  }
  return _client;
}

async function getTargetUserId() {
  if (process.env.LINE_USER_ID) return process.env.LINE_USER_ID;
  return await db.getSetting('line_user_id');
}

async function sendToUser(text) {
  const client = getClient();
  if (!client) {
    console.warn('[LINE] LINE_CHANNEL_ACCESS_TOKEN が未設定です');
    return;
  }
  const userId = await getTargetUserId();
  if (!userId) {
    console.warn('[LINE] 送信先ユーザーID が未設定です');
    return;
  }
  try {
    await client.pushMessage({ to: userId, messages: [{ type: 'text', text }] });
    console.log('[LINE] メッセージ送信完了');
  } catch (err) {
    console.error('[LINE] 送信エラー:', err.message);
  }
}

function formatDailyMessage(tasks, header) {
  const now = dayjs().tz('Asia/Tokyo');
  const dateStr = now.format('M/D');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  const dayStr = days[now.day()];

  if (tasks.length === 0) {
    return `📋 今日のタスク - ${dateStr}(${dayStr})\n${header}\n\nタスクはありません ✨`;
  }

  const lines = tasks.map(t => {
    const time = t.due_time ? ` ⏰ ${String(t.due_time).slice(0, 5)}` : '';
    return `・${t.title}${time}`;
  }).join('\n');

  return `📋 今日のタスク - ${dateStr}(${dayStr})\n${header}\n\n${lines}\n\n未完了: ${tasks.length}件`;
}

module.exports = { getClient, getTargetUserId, sendToUser, formatDailyMessage };
