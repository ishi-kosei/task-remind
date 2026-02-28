const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * LINEメッセージから日付・時間を抜き取り、残りをそのままタイトルにする。
 *
 * ルール:
 *   - メッセージの中に日付パターンが見つかればそれを due_date にする
 *   - 時間パターンが見つかれば due_time にする
 *   - 日付・時間を除いた残りテキストをそのまま title にする（加工しない）
 *
 * 例:
 *   「3/5 〇〇さんにお繋ぎ文送信」    → title: "〇〇さんにお繋ぎ文送信"  date: 3/5
 *   「明日 〇〇さんお店探す」          → title: "〇〇さんお店探す"         date: 翌日
 *   「今日 14:00 打ち合わせ」          → title: "打ち合わせ"               date: 今日  time: 14:00
 *   「3月5日〜受取」                   → title: "〜受取"                   date: 3/5
 */
async function parseTask(text) {
  let s = text.trim();
  const today = dayjs().tz('Asia/Tokyo');

  let dueDate = null;
  let dueTime = null;

  // ── 1. 日付を抜き取る ────────────────────────────────────────
  // 相対表現（明後日を先にチェック）
  const relMap = [
    { re: /明後日|あさって/, offset: 2 },
    { re: /明日/,           offset: 1 },
    { re: /今日|本日/,      offset: 0 },
  ];
  for (const { re, offset } of relMap) {
    if (re.test(s)) {
      dueDate = today.add(offset, 'day').format('YYYY-MM-DD');
      s = s.replace(re, '').trim();
      break;
    }
  }

  // M月D日
  if (!dueDate) {
    const m = s.match(/(\d{1,2})月(\d{1,2})日?/);
    if (m) {
      dueDate = toDate(parseInt(m[1]), parseInt(m[2]), today);
      s = s.replace(m[0], '').trim();
    }
  }

  // M/D
  if (!dueDate) {
    const m = s.match(/(\d{1,2})\/(\d{1,2})/);
    if (m) {
      dueDate = toDate(parseInt(m[1]), parseInt(m[2]), today);
      s = s.replace(m[0], '').trim();
    }
  }

  // ── 2. 時間を抜き取る ────────────────────────────────────────
  const timePatterns = [
    { re: /午後(\d{1,2})時(\d{2})分/, h: 1, m: 2, pm: true  },
    { re: /午後(\d{1,2})時/,          h: 1, m: null, pm: true },
    { re: /午前(\d{1,2})時(\d{2})分/, h: 1, m: 2, pm: false  },
    { re: /午前(\d{1,2})時/,          h: 1, m: null, pm: false },
    { re: /(\d{1,2}):(\d{2})/,        h: 1, m: 2, pm: false   },
    { re: /(\d{1,2})時(\d{2})分/,     h: 1, m: 2, pm: false   },
    { re: /(\d{1,2})時半/,            h: 1, m: null, half: true },
    { re: /(\d{1,2})時/,              h: 1, m: null, pm: false },
  ];
  for (const { re, h, m, pm, half } of timePatterns) {
    const match = s.match(re);
    if (match) {
      let hh = parseInt(match[h]);
      if (pm && hh < 12) hh += 12;
      const mm = half ? '30' : (m ? String(match[m]).padStart(2, '0') : '00');
      dueTime = `${String(hh).padStart(2, '0')}:${mm}`;
      s = s.replace(match[0], '').trim();
      break;
    }
  }

  // ── 3. 残りをそのままタイトルに ─────────────────────────────
  // 前後の空白・区切り文字だけ除去して、それ以外は加工しない
  const title = s.replace(/^[\s　]+|[\s　]+$/g, '').trim() || null;

  return { title, dueDate, dueTime };
}

/** 月・日 → YYYY-MM-DD（過去日なら翌年） */
function toDate(month, day, today) {
  let d = today.month(month - 1).date(day);
  if (d.isBefore(today.startOf('day'))) d = d.add(1, 'year');
  return d.format('YYYY-MM-DD');
}

module.exports = { parseTask };
