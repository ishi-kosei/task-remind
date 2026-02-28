const { Pool } = require('pg');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id        SERIAL PRIMARY KEY,
      title     TEXT NOT NULL,
      due_date  DATE NOT NULL,
      due_time  TIME,
      completed       BOOLEAN DEFAULT FALSE,
      notified_before BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  console.log('[DB] テーブル準備完了');
}

function todayJST() {
  return dayjs().tz('Asia/Tokyo').format('YYYY-MM-DD');
}

async function getTasks() {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE completed = FALSE
     ORDER BY due_date ASC, due_time ASC NULLS LAST, id ASC`
  );
  return rows;
}

async function getTodayTasks() {
  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE due_date = $1 AND completed = FALSE
     ORDER BY due_time ASC NULLS LAST`,
    [todayJST()]
  );
  return rows;
}

async function createTask(title, dueDate, dueTime) {
  const { rows } = await pool.query(
    `INSERT INTO tasks (title, due_date, due_time) VALUES ($1, $2, $3) RETURNING *`,
    [title, dueDate, dueTime || null]
  );
  return rows[0];
}

async function completeTask(id) {
  await pool.query(`UPDATE tasks SET completed = TRUE WHERE id = $1`, [id]);
}

async function deleteTask(id) {
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
}

// 1時間後に期限が来るタスクを取得（±30秒の幅で毎分チェック）
async function getTasksToNotify() {
  const nowJST = dayjs().tz('Asia/Tokyo');
  const low  = nowJST.add(59, 'minute').add(30, 'second').format('HH:mm:ss');
  const high = nowJST.add(60, 'minute').add(30, 'second').format('HH:mm:ss');

  const { rows } = await pool.query(
    `SELECT * FROM tasks
     WHERE due_date = $1
       AND due_time IS NOT NULL
       AND due_time >= $2::time
       AND due_time <  $3::time
       AND completed = FALSE
       AND notified_before = FALSE`,
    [todayJST(), low, high]
  );
  return rows;
}

async function markNotified(id) {
  await pool.query(`UPDATE tasks SET notified_before = TRUE WHERE id = $1`, [id]);
}

async function getSetting(key) {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

module.exports = {
  init, getTasks, getTodayTasks, createTask, completeTask, deleteTask,
  getTasksToNotify, markNotified, getSetting, setSetting
};
