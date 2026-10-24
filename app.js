// ===== 家計簿アプリ本体 =====
// データはすべてこの端末の localStorage に保存されます（サーバーには送りません）

const STORE_KEY = 'kakeibo.entries.v1';
const SETTINGS_KEY = 'kakeibo.settings.v1';

const DEFAULT_SETTINGS = {
  categories: {
    expense: ['食費', '日用品', '交通', '外食', '趣味', '交際', '住居', '光熱', '通信', '医療', 'その他'],
    income: ['給料', '副業', '臨時', 'その他'],
  },
  weekStart: 1, // 1=月曜始まり, 0=日曜始まり
};

// ---------- 保存まわり ----------
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { alert('保存に失敗しました'); }
}

let entries = load(STORE_KEY, []); // {id, type, amount, category, date, memo}
let settings = { ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) };

const persistEntries = () => save(STORE_KEY, entries);
const persistSettings = () => save(SETTINGS_KEY, settings);

// ---------- 日付ユーティリティ ----------
const pad = (n) => String(n).padStart(2, '0');
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const fmtDay = (s) => { const d = fromYMD(s); return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`; };
const yen = (n) => (n < 0 ? '-¥' : '¥') + Math.abs(n).toLocaleString('ja-JP');

// ---------- 入力画面 ----------
const $ = (id) => document.getElementById(id);
let currentType = 'expense';
let currentCategory = null;

function renderChips() {
  const list = settings.categories[currentType];
  if (!list.includes(currentCategory)) currentCategory = list[0];
  $('category-chips').innerHTML = list
    .map((c) => `<button type="button" class="chip${c === currentCategory ? ' active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join('');
}

$('category-chips').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  currentCategory = btn.dataset.cat;
  renderChips();
});

document.querySelectorAll('.type-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentType = btn.dataset.type;
    document.querySelectorAll('.type-btn').forEach((b) => b.classList.toggle('active', b === btn));
    currentCategory = null;
    renderChips();
  });
});

// 金額欄：数字以外を自動で除去し、3桁区切りで表示
$('amount').addEventListener('input', (e) => {
  const digits = e.target.value.replace(/[^0-9０-９]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  e.target.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
});

$('entry-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Number($('amount').value.replace(/,/g, ''));
  if (!amount || amount <= 0) {
    $('amount').focus();
    showToast('金額を入れてください');
    return;
  }
  entries.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: currentType,
    amount,
    category: currentCategory,
    date: $('date').value || toYMD(new Date()),
    memo: $('memo').value.trim(),
  });
  persistEntries();
  $('amount').value = '';
  $('memo').value = '';
  showToast(`${currentCategory} ${yen(amount)} を記録しました`);
  renderRecent();
});

let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function sortedEntries(list) {
  return [...list].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
}

function entryHtml(en) {
  const sign = en.type === 'expense' ? '-' : '+';
  return `<li class="entry">
    <div class="meta">
      <div class="cat">${escapeHtml(en.category)}</div>
      <div class="info">${fmtDay(en.date)}${en.memo ? ' ・ ' + escapeHtml(en.memo) : ''}</div>
    </div>
    <div class="amt ${en.type}">${sign}${yen(en.amount)}</div>
    <button type="button" class="del-btn" data-id="${en.id}" aria-label="削除">×</button>
  </li>`;
}

function renderRecent() {
  $('recent-list').innerHTML = sortedEntries(entries).slice(0, 10).map(entryHtml).join('');
}

// 削除（どのリストからでも）
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.del-btn');
  if (!btn) return;
  const en = entries.find((x) => x.id === btn.dataset.id);
  if (!en) return;
  if (!confirm(`${fmtDay(en.date)} ${en.category} ${yen(en.amount)} を削除しますか？`)) return;
  entries = entries.filter((x) => x.id !== en.id);
  persistEntries();
  renderRecent();
  renderSummary();
});

// ---------- 集計画面 ----------
let period = 'month';
let anchor = new Date(); // 表示中の期間に含まれる日

function periodRange() {
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if (period === 'month') {
    const start = new Date(a.getFullYear(), a.getMonth(), 1);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start, end, label: `${start.getFullYear()}年${start.getMonth() + 1}月` };
  }
  const diff = (a.getDay() - settings.weekStart + 7) % 7;
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate() - diff);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end, label: `${start.getMonth() + 1}/${start.getDate()} 〜 ${end.getMonth() + 1}/${end.getDate()}` };
}

function renderSummary() {
  const { start, end, label } = periodRange();
  const s = toYMD(start), e = toYMD(end);
  const inRange = entries.filter((en) => en.date >= s && en.date <= e);

  let income = 0, expense = 0;
  const byCat = {};
  for (const en of inRange) {
    if (en.type === 'income') income += en.amount;
    else {
      expense += en.amount;
      byCat[en.category] = (byCat[en.category] || 0) + en.amount;
    }
  }
  const diff = income - expense;

  $('period-label').textContent = label;
  $('sum-income').textContent = yen(income);
  $('sum-expense').textContent = yen(expense);
  const diffEl = $('sum-diff');
  diffEl.textContent = (diff > 0 ? '+' : '') + yen(diff);
  diffEl.className = diff < 0 ? 'neg' : diff > 0 ? 'pos' : '';

  const cats = Object.entries(byCat).sort((x, y) => y[1] - x[1]);
  const max = cats.length ? cats[0][1] : 1;
  $('breakdown').innerHTML = cats
    .map(([c, v]) => `<li class="bd-row">
      <div class="bd-head"><span>${escapeHtml(c)}</span><b>${yen(v)}<small style="color:var(--muted);font-weight:400"> ・ ${Math.round((v / expense) * 100)}%</small></b></div>
      <div class="bd-bar"><i style="width:${(v / max) * 100}%"></i></div>
    </li>`)
    .join('');

  $('period-list').innerHTML = sortedEntries(inRange).map(entryHtml).join('');
}

document.querySelectorAll('.period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    period = btn.dataset.period;
    document.querySelectorAll('.period-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderSummary();
  });
});

function shiftPeriod(dir) {
  if (period === 'month') anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  else anchor = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 7 * dir);
  renderSummary();
}
$('prev-period').addEventListener('click', () => shiftPeriod(-1));
$('next-period').addEventListener('click', () => shiftPeriod(1));

// ---------- 設定画面 ----------
function renderSettings() {
  $('cat-expense').value = settings.categories.expense.join(', ');
  $('cat-income').value = settings.categories.income.join(', ');
  $('week-start').value = String(settings.weekStart);
}

$('save-cats').addEventListener('click', () => {
  const parse = (v) => v.split(/[,、，]/).map((x) => x.trim()).filter(Boolean);
  const ex = parse($('cat-expense').value);
  const inc = parse($('cat-income').value);
  if (!ex.length || !inc.length) { alert('カテゴリを1つ以上入れてください'); return; }
  settings.categories = { expense: ex, income: inc };
  persistSettings();
  renderChips();
  alert('カテゴリを保存しました');
});

$('week-start').addEventListener('change', (e) => {
  settings.weekStart = Number(e.target.value);
  persistSettings();
  renderSummary();
});

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('export-btn').addEventListener('click', () => {
  download(`kakeibo-${toYMD(new Date())}.json`, JSON.stringify({ entries, settings }, null, 2), 'application/json');
});

$('csv-btn').addEventListener('click', () => {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['日付', '種類', 'カテゴリ', '金額', 'メモ']].concat(
    sortedEntries(entries).reverse().map((en) => [en.date, en.type === 'expense' ? '支出' : '収入', en.category, en.amount, en.memo])
  );
  // 先頭のBOMでExcelでも文字化けしない
  download(`kakeibo-${toYMD(new Date())}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.entries)) throw new Error();
    if (!confirm(`${data.entries.length}件の記録を読み込みます。今のデータは置き換わります。よろしいですか？`)) return;
    entries = data.entries;
    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    persistEntries();
    persistSettings();
    renderAll();
    alert('読み込みました');
  } catch {
    alert('ファイルを読み込めませんでした');
  } finally {
    e.target.value = '';
  }
});

// ---------- タブ切り替え ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const v = tab.dataset.view;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === `view-${v}`));
    if (v === 'summary') { anchor = new Date(); renderSummary(); }
    window.scrollTo(0, 0);
  });
});

// ---------- 共通 ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAll() {
  $('date').value = toYMD(new Date());
  renderChips();
  renderRecent();
  renderSummary();
  renderSettings();
}

// アプリを開き直したとき日付を今日に戻す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') $('date').value = toYMD(new Date());
});

renderAll();

// オフラインでも動くようにする（サービスワーカー）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
