// ===== 家計簿アプリ本体 =====
// データはすべてこの端末の localStorage に保存されます（サーバーには送りません）

const STORE_KEY = 'kakeibo.entries.v1';
const SETTINGS_KEY = 'kakeibo.settings.v1';
const SUBS_KEY = 'kakeibo.subs.v1';

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
// サブスク・固定費 {id, name, category, day, start:'YYYY-MM', end:'YYYY-MM'|null, amounts:[{from, amount}], overrides:{'YYYY-MM': amount}}
let subs = load(SUBS_KEY, []);

const persistEntries = () => save(STORE_KEY, entries);
const persistSettings = () => save(SETTINGS_KEY, settings);
const persistSubs = () => save(SUBS_KEY, subs);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- 日付ユーティリティ ----------
const pad = (n) => String(n).padStart(2, '0');
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toYM = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
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
function formatAmountInput(e) {
  const digits = e.target.value.replace(/[^0-9０-９]/g, '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  e.target.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
}
$('amount').addEventListener('input', formatAmountInput);

$('entry-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Number($('amount').value.replace(/,/g, ''));
  if (!amount || amount <= 0) {
    $('amount').focus();
    showToast('金額を入れてください');
    return;
  }
  entries.push({
    id: newId(),
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
  const subIn = subEntries(start, end);

  let income = 0, expense = 0;
  const byCat = {};
  for (const en of [...inRange, ...subIn]) {
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

  const cats = Object.entries(byCat).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
  const max = cats.length ? cats[0][1] : 1;
  $('breakdown').innerHTML = cats
    .map(([c, v]) => `<li class="bd-row">
      <div class="bd-head"><span>${escapeHtml(c)}</span><b>${yen(v)}<small style="color:var(--muted);font-weight:400"> ・ ${Math.round((v / expense) * 100)}%</small></b></div>
      <div class="bd-bar"><i style="width:${(v / max) * 100}%"></i></div>
    </li>`)
    .join('');

  $('period-list').innerHTML = sortedEntries(inRange).map(entryHtml).join('');

  $('sub-sum').textContent = subIn.length ? yen(subIn.reduce((t, x) => t + x.amount, 0)) : '';
  $('sub-list').innerHTML = subIn
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((x) => `<li class="entry sub-item" data-sub="${x.sub.id}" data-ym="${x.ym}">
      <div class="meta">
        <div class="cat">${escapeHtml(x.sub.name)}</div>
        <div class="info">${dayLabel(x.sub.day)} ・ ${escapeHtml(x.category)}${x.ym in x.sub.overrides ? ' ・ この月だけ変更' : ''}</div>
      </div>
      <div class="amt expense">-${yen(x.amount)}</div>
      <span class="chev">›</span>
    </li>`)
    .join('');
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

// ---------- サブスク・固定費 ----------
// 登録した月以降、毎月自動で支出として集計する（解約した月の前月まで）
const dayLabel = (day) => (day >= 31 ? '毎月末日' : `毎月${day}日`);
const prevYM = (ym) => { const [y, m] = ym.split('-').map(Number); return toYM(new Date(y, m - 2, 1)); };
const ymLabel = (ym) => `${Number(ym.split('-')[1])}月`;

function baseAmount(sub, ym) {
  let amt = 0;
  for (const a of sub.amounts) if (a.from <= ym) amt = a.amount;
  return amt;
}
const subAmount = (sub, ym) => (ym in sub.overrides ? sub.overrides[ym] : baseAmount(sub, ym));

// 期間内に引き落とされるサブスクを、記録と同じ形で返す
function subEntries(start, end) {
  const s = toYMD(start), e = toYMD(end);
  const list = [];
  for (let m = new Date(start.getFullYear(), start.getMonth(), 1); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const ym = toYM(m);
    const lastDay = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (const sub of subs) {
      if (ym < sub.start || (sub.end && ym > sub.end)) continue;
      const date = `${ym}-${pad(Math.min(sub.day, lastDay))}`;
      if (date < s || date > e) continue;
      list.push({ id: `sub-${sub.id}-${ym}`, sub, ym, type: 'expense', amount: subAmount(sub, ym), category: sub.category, date, memo: sub.name });
    }
  }
  return list;
}

let editingSub = null; // {sub, ym}。追加のときは sub が null

function openSubDialog(sub, ym) {
  editingSub = { sub, ym };
  const cats = [...settings.categories.expense];
  if (!cats.includes('サブスク')) cats.unshift('サブスク');
  if (sub && !cats.includes(sub.category)) cats.unshift(sub.category);
  $('sub-cat').innerHTML = cats.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  $('sub-day').innerHTML = Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1 === 31 ? '末日' : `${i + 1}日`}</option>`).join('');

  $('sub-title').textContent = sub ? 'サブスク・固定費を編集' : 'サブスク・固定費を追加';
  $('sub-name').value = sub ? sub.name : '';
  $('sub-amount').value = sub ? subAmount(sub, ym).toLocaleString('ja-JP') : '';
  $('sub-amount-label').textContent = sub ? `${ymLabel(ym)}の金額` : `金額（${ymLabel(ym)}から毎月）`;
  $('sub-day').value = String(sub ? sub.day : 1);
  $('sub-cat').value = sub ? sub.category : 'サブスク';
  $('sub-scope').hidden = !sub;
  document.querySelector('input[name="sub-scope"][value="month"]').checked = true;
  $('sub-delete').hidden = !sub;
  if (sub) $('sub-delete').textContent = `${ymLabel(ym)}から解約する`;
  openSheet();
}

// 古いiPhone（iOS 15.3以前）など <dialog> 非対応のブラウザでも開けるようにする
function openSheet() {
  const d = $('sub-dialog');
  if (typeof d.showModal === 'function') d.showModal();
  else d.setAttribute('open', '');
}
function closeSheet() {
  const d = $('sub-dialog');
  if (typeof d.close === 'function') d.close();
  else d.removeAttribute('open');
}

$('add-sub').addEventListener('click', () => {
  // 週表示のときは表示中の週の月から登録
  openSubDialog(null, toYM(periodRange().start));
});

$('sub-list').addEventListener('click', (e) => {
  const li = e.target.closest('.sub-item');
  if (!li) return;
  const sub = subs.find((x) => x.id === li.dataset.sub);
  if (sub) openSubDialog(sub, li.dataset.ym);
});

$('sub-amount').addEventListener('input', formatAmountInput);
$('sub-cancel').addEventListener('click', closeSheet);

$('sub-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('sub-name').value.trim();
  const amountText = $('sub-amount').value.replace(/,/g, '');
  if (!name) { $('sub-name').focus(); return; }
  if (!amountText) { $('sub-amount').focus(); return; }
  const amount = Number(amountText);
  const day = Number($('sub-day').value);
  const category = $('sub-cat').value;
  const { sub, ym } = editingSub;

  if (!sub) {
    subs.push({ id: newId(), name, category, day, start: ym, end: null, amounts: [{ from: ym, amount }], overrides: {} });
  } else {
    Object.assign(sub, { name, category, day });
    if (document.querySelector('input[name="sub-scope"]:checked').value === 'month') {
      // この月だけ：前後の月の金額はそのまま
      if (amount === baseAmount(sub, ym)) delete sub.overrides[ym];
      else sub.overrides[ym] = amount;
    } else {
      // この月以降ずっと：過去の月の金額はそのまま
      sub.amounts = sub.amounts.filter((a) => a.from < ym).concat({ from: ym, amount });
      for (const k of Object.keys(sub.overrides)) if (k >= ym) delete sub.overrides[k];
    }
  }
  persistSubs();
  closeSheet();
  renderSummary();
});

$('sub-delete').addEventListener('click', () => {
  const { sub, ym } = editingSub;
  const prev = prevYM(ym);
  const whole = prev < sub.start;
  const msg = whole
    ? `${sub.name} を削除しますか？`
    : `${sub.name} を${ymLabel(ym)}から解約しますか？（${ymLabel(prev)}までの支出は残ります）`;
  if (!confirm(msg)) return;
  if (whole) subs = subs.filter((x) => x !== sub);
  else sub.end = prev;
  persistSubs();
  closeSheet();
  renderSummary();
});

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
  download(`kakeibo-${toYMD(new Date())}.json`, JSON.stringify({ entries, settings, subs }, null, 2), 'application/json');
});

$('csv-btn').addEventListener('click', () => {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  // サブスクは最初の登録月から今月までの分を書き出す
  const now = new Date();
  const firstYM = subs.reduce((min, x) => (x.start < min ? x.start : min), toYM(now));
  const [fy, fm] = firstYM.split('-').map(Number);
  const subRows = subEntries(new Date(fy, fm - 1, 1), new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const rows = [['日付', '種類', 'カテゴリ', '金額', 'メモ']].concat(
    sortedEntries([...entries, ...subRows]).reverse().map((en) => [en.date, en.type === 'expense' ? '支出' : '収入', en.category, en.amount, en.memo])
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
    subs = Array.isArray(data.subs) ? data.subs : [];
    if (data.settings) settings = { ...DEFAULT_SETTINGS, ...data.settings };
    persistEntries();
    persistSettings();
    persistSubs();
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
