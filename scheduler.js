const cron = require('node-cron');
const db = require('./db');
const { sendToUser, formatDailyMessage } = require('./line');

function start() {
  // 毎朝6時（JST）：今日のタスク一覧を送信
  cron.schedule('0 6 * * *', async () => {
    console.log('[Scheduler] 朝6時リマインド');
    const tasks = await db.getTodayTasks();
    await sendToUser(formatDailyMessage(tasks, '☀️ おはようございます！'));
  }, { timezone: 'Asia/Tokyo' });

  // 毎夕18時（JST）：今日のタスク一覧を送信
  cron.schedule('0 18 * * *', async () => {
    console.log('[Scheduler] 夕18時リマインド');
    const tasks = await db.getTodayTasks();
    await sendToUser(formatDailyMessage(tasks, '🌆 夕方のリマインドです！'));
  }, { timezone: 'Asia/Tokyo' });

  // 毎分：時間指定タスクの1時間前通知チェック
  cron.schedule('* * * * *', async () => {
    const tasks = await db.getTasksToNotify();
    for (const task of tasks) {
      const time = String(task.due_time).slice(0, 5);
      await sendToUser(`⏰ 1時間前リマインド\n\n「${task.title}」\n予定時刻: ${time}`);
      await db.markNotified(task.id);
    }
  }, { timezone: 'Asia/Tokyo' });

  console.log('[Scheduler] Cronジョブ開始');
}

module.exports = { start };
