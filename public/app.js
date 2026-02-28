// ── ユーティリティ ──────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(t) {
  return t ? String(t).slice(0, 5) : null;
}

function dateLabel(dateStr) {
  const local = new Date();
  local.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d - local) / 86400000);
  const [, m, day] = dateStr.split('-');

  if (diff === 0)  return { text: `今日 ${parseInt(m)}/${parseInt(day)}`, isToday: true };
  if (diff === 1)  return { text: `明日 ${parseInt(m)}/${parseInt(day)}`, isToday: false };
  if (diff < 0)   return { text: `${parseInt(m)}/${parseInt(day)}（期限切れ）`, isToday: false };
  return { text: `${parseInt(m)}/${parseInt(day)}`, isToday: false };
}

// ── タスク描画 ──────────────────────────────────────────
function render(tasks) {
  const list = document.getElementById('task-list');

  if (!tasks.length) {
    list.innerHTML = '<div class="empty">🎉 タスクはありません</div>';
    return;
  }

  // 日付でグループ化
  const groups = {};
  for (const t of tasks) {
    const key = String(t.due_date).slice(0, 10);
    (groups[key] = groups[key] || []).push(t);
  }

  let html = '';
  for (const [date, items] of Object.entries(groups)) {
    const { text, isToday } = dateLabel(date);
    html += `
      <div class="group">
        <div class="group-header">
          <span class="group-label ${isToday ? 'today' : ''}">${esc(text)}</span>
          <span class="group-count">${items.length}件</span>
        </div>
        ${items.map(t => `
          <div class="task ${isToday ? 'today-task' : ''}" data-id="${t.id}">
            <div class="task-check" onclick="done(${t.id})" title="完了にする">✓</div>
            <div class="task-body">
              <div class="task-title">${esc(t.title)}</div>
              ${fmtTime(t.due_time) ? `<div class="task-time">⏰ ${fmtTime(t.due_time)}</div>` : ''}
            </div>
            <button class="task-del" onclick="del(${t.id})" title="削除">🗑</button>
          </div>
        `).join('')}
      </div>`;
  }

  list.innerHTML = html;
}

// ── API ─────────────────────────────────────────────────
async function load() {
  try {
    const res = await fetch('/api/tasks');
    render(await res.json());
  } catch {
    document.getElementById('task-list').innerHTML =
      '<div class="empty">⚠️ 読み込みに失敗しました</div>';
  }
}

async function done(id) {
  await fetch(`/api/tasks/${id}/complete`, { method: 'PATCH' });
  load();
}

async function del(id) {
  if (!confirm('このタスクを削除しますか？')) return;
  await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
  load();
}

// ── フォーム送信 ────────────────────────────────────────
document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const title    = document.getElementById('f-title').value.trim();
  const due_date = document.getElementById('f-date').value;
  const due_time = document.getElementById('f-time').value || null;
  if (!title || !due_date) return;

  const btn = document.getElementById('add-btn');
  btn.textContent = '追加中...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, due_date, due_time })
    });
    if (res.ok) {
      document.getElementById('f-title').value = '';
      document.getElementById('f-time').value  = '';
      load();
    }
  } finally {
    btn.textContent = '追加する';
    btn.disabled = false;
  }
});

// ── LINE状態表示 ────────────────────────────────────────
async function lineStatus() {
  try {
    const { lineConnected } = await (await fetch('/api/status')).json();
    const b = document.getElementById('line-badge');
    b.textContent = lineConnected ? 'LINE 連携済み ✓' : 'LINE 未連携';
    b.className   = `badge ${lineConnected ? 'ok' : 'ng'}`;
  } catch { /* ignore */ }
}

// ── 初期化 ──────────────────────────────────────────────
// デフォルトで今日の日付をセット
document.getElementById('f-date').valueAsDate = new Date();

load();
lineStatus();
