'use strict';
/* ============ 健身教練｜coach.js ============
   獨立運作的健身與飲食記錄網站，所有資料（訓練、飲食、體重、喝水、設定）
   都存在同一份 fitCoach.v1 裡，不依賴任何其他網站。 */

/* ---------- 工具 ---------- */
const KEY = 'fitCoach.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return ymd(d); };
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const round = (n, p = 0) => { const f = 10 ** p; return Math.round(n * f) / f; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const num = (v, d = null) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);
const avg = a => a.length ? sum(a) / a.length : null;
const fmt = n => Math.round(n).toLocaleString('en-US');
const fmt1 = n => String(round(n, 1));
let NOWFN = () => new Date();
const now = () => NOWFN();
const today = () => ymd(now());
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const mondayOf = s => { const d = parseD(s); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return ymd(d); };
const mmss = sec => { sec = Math.max(0, Math.round(sec)); return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60); };
const dateLabel = s => { const d = parseD(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; };

const EQ_LABEL = { db: '啞鈴', band: '彈力帶', bar: '單槓', bench: '長凳', barbell: '槓鈴與深蹲架', machine: '器械', cable: '纜繩／滑輪' };
const EQ_KEYS = Object.keys(EQ_LABEL);
const PRESETS = {
  bw: { label: '居家徒手', sub: '只靠自己的體重', equip: { db: 0, band: 0, bar: 0, bench: 0, barbell: 0, machine: 0, cable: 0 } },
  home: { label: '居家啞鈴＋彈力帶', sub: '家裡有啞鈴和彈力帶', equip: { db: 1, band: 1, bar: 0, bench: 0, barbell: 0, machine: 0, cable: 0 } },
  gym: { label: '健身房', sub: '器械、槓鈴、纜繩都有', equip: { db: 1, band: 0, bar: 1, bench: 1, barbell: 1, machine: 1, cable: 1 } }
};
const LEVELS = { 1: { label: '新手', sub: '剛開始，或中斷很久' }, 2: { label: '有基礎', sub: '規律訓練半年以上' }, 3: { label: '熟練', sub: '規律訓練兩年以上' } };
const GROUPS = [['all', '全部'], ['push', '推'], ['pull', '拉'], ['legs', '腿臀'], ['core', '核心'], ['mobility', '伸展']];
const BW_BASE = { 0: '還做不到標準伏地挺身', 1: '標準伏地挺身可連續做 6–15 下', 2: '標準伏地挺身可做 15 下以上' };

/* ---------- 資料載入 ---------- */
let DATA = null, RULES = null, EXL = [], EXM = {}, CARDIO = [], FOODS = [], FOODM = {}, FOOD_CATS = [];
async function loadData() {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  const [a, b, f] = await Promise.all([get('data/exercises.json'), get('data/rules.json'), get('data/foods_all.json')]);
  if (!a || !Array.isArray(a.exercises) || !b || !b.phases || !Array.isArray(f)) throw new Error('資料格式不正確');
  DATA = a; RULES = b; EXL = a.exercises; CARDIO = a.cardio || [];
  EXM = {}; EXL.forEach(e => EXM[e.id] = e);
  FOODS = f; FOODM = {}; FOODS.forEach(x => FOODM[x.id] = x);
  FOOD_CATS = Array.from(new Set(FOODS.map(x => x.category)));
}

/* ---------- 儲存 ---------- */
function defaultStore() {
  return { version: 2, profile: null, plan: null, workouts: [], cardio: [], water: {}, body: [], diet: {}, customFoods: [], adjust: { kcal: 0 }, active: null, lastBackup: null, applied: [] };
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultStore();
    const s = Object.assign(defaultStore(), JSON.parse(raw));
    ['workouts', 'cardio', 'body', 'applied', 'customFoods'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    if (!s.water || typeof s.water !== 'object') s.water = {};
    if (!s.diet || typeof s.diet !== 'object') s.diet = {};
    if (!s.adjust || typeof s.adjust !== 'object') s.adjust = { kcal: 0 };
    return s;
  } catch (e) { return defaultStore(); }
}
let store = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); }
  catch (e) { toast('無法儲存資料，請確認瀏覽器沒有開啟無痕模式'); }
}

/* ---------- 飲食紀錄（自己存，不依賴外部網站） ---------- */
function dietDay(date, create) {
  if (!store.diet[date]) { if (!create) return null; store.diet[date] = { entries: [] }; }
  return store.diet[date];
}
function intake(date) {
  const d = store.diet[date];
  if (!d || !d.entries.length) return null;
  const r = { kcal: 0, p: 0, f: 0, c: 0, known: 0, unk: 0, kcalKnown: 0, n: d.entries.length, meals: { b: 0, l: 0, d: 0, o: 0 }, mealsKnown: false };
  for (const e of d.entries) {
    const k = num(e.kcal, 0); r.kcal += k;
    if (e.protein != null && e.fat != null && e.carb != null && Number.isFinite(+e.protein)) {
      r.p += +e.protein; r.f += +e.fat; r.c += +e.carb; r.known++; r.kcalKnown += k;
      const h = parseInt(String(e.time || '').slice(0, 2), 10);
      const b = h >= 4 && h < 10 ? 'b' : h >= 10 && h < 15 ? 'l' : h >= 15 && h < 21 ? 'd' : 'o';
      r.meals[b] += +e.protein; r.mealsKnown = true;
    } else r.unk++;
  }
  return r;
}
function addFoodEntry(date, food, qty) {
  const d = dietDay(date, true), now2 = now(), mk = food.protein != null;
  const sc = v => mk ? round(v * qty, 1) : null;
  // base 記錄每 1 份的營養素，之後調整份數只需重新相乘，不必回頭查食物庫（食物庫更新或自訂項目沒存進庫時也不會失效）
  d.entries.push({ id: uid(), time: pad(now2.getHours()) + ':' + pad(now2.getMinutes()), foodId: food.id || null, name: food.name, brand: food.brand || '', emoji: food.emoji || '🍽️', cat: food.category || '', serving: food.serving || '1份', qty, base: { kcal: food.kcal, protein: food.protein, fat: food.fat, carb: food.carb }, kcal: Math.round(food.kcal * qty), protein: sc(food.protein), fat: sc(food.fat), carb: sc(food.carb) });
  save();
}
function delEntry(date, id) { const d = dietDay(date); if (!d) return; d.entries = d.entries.filter(e => e.id !== id); save(); }
function setQty(date, id, qty) {
  const d = dietDay(date); if (!d) return; const e = d.entries.find(x => x.id === id); if (!e || !e.base) return;
  qty = clamp(qty, 0.5, 20); const b = e.base, mk = b.protein != null, sc = v => mk ? round(v * qty, 1) : null;
  e.qty = qty; e.kcal = Math.round(b.kcal * qty); e.protein = sc(b.protein); e.fat = sc(b.fat); e.carb = sc(b.carb); save();
}

/* ---------- 裝備與動作篩選 ---------- */
function exOk(e, eq) {
  const need = e.bwOk ? e.eq.filter(q => q !== 'db' && q !== 'bench') : e.eq;
  return need.every(q => eq[q]);
}
function usesGear(e, eq) { return e.eq.some(q => eq[q]); }
const FALLBACK = { pv: ['ph'], lv: ['lh'], hg: ['gl', 'lg'], lg: ['sq'], sq: ['lg'], gl: ['hg'], ld: ['rd'], rd: ['ld', 'lh'], tr: ['bi', 'pv'], bi: ['lv', 'tr', 'lh'], ca: ['co'], ph: ['pv'], lh: ['lv'], co: ['ca'] };
function cands(pat, prof, used) {
  const eq = prof.equip, ml = prof.level, bb = prof.bwBase == null ? 1 : prof.bwBase;
  const list = EXL.filter(e => e.pat === pat && !e.warm && !e.cool && !used.has(e.id) && exOk(e, eq) &&
    e.lvl <= (usesGear(e, eq) ? ml : Math.max(ml, bb)));
  const g = list.filter(e => usesGear(e, eq)), b = list.filter(e => !usesGear(e, eq));
  if (ml >= 2) g.sort((x, y) => (y.eq.includes('barbell') ? 1 : 0) - (x.eq.includes('barbell') ? 1 : 0));
  if (['ph', 'pv', 'lh', 'tr'].includes(pat)) {
    const score = e => e.lvl >= bb ? e.lvl - bb : bb - e.lvl + 0.5;
    b.sort((x, y) => score(x) - score(y));
  }
  return g.concat(b);
}
function pickEx(pat, prof, used, rot) {
  for (const p of [pat].concat(FALLBACK[pat] || [])) {
    const c = cands(p, prof, used);
    if (c.length) { const k = rot[p] || 0; rot[p] = k + 1; return c[k % Math.min(3, c.length)]; }
  }
  return null;
}
function resolveSlots(pats, prof, rot = {}) {
  const used = new Set(), slots = [];
  for (const pat of pats) { const e = pickEx(pat, prof, used, rot); if (e) { used.add(e.id); slots.push({ pat, ex: e.id }); } }
  return slots;
}

/* ---------- 課表生成 ---------- */
const TPL = {
  'FB-A': { name: '全身 A', pats: ['sq', 'ph', 'lh', 'hg', 'co'] },
  'FB-B': { name: '全身 B', pats: ['lg', 'pv', 'lv', 'gl', 'co'] },
  'FB-C': { name: '全身 C', pats: ['sq', 'ph', 'lh', 'gl', 'bi'] },
  U1: { name: '上肢 A', pats: ['ph', 'lh', 'pv', 'lv', 'tr', 'bi'] },
  L1: { name: '下肢 A', pats: ['sq', 'hg', 'lg', 'ca', 'co'] },
  U2: { name: '上肢 B', pats: ['ph', 'lv', 'lh', 'ld', 'rd', 'bi'] },
  L2: { name: '下肢 B', pats: ['hg', 'sq', 'gl', 'lg', 'ca', 'co'] },
  PUSH: { name: '推日', pats: ['ph', 'pv', 'ph', 'ld', 'tr', 'tr'] },
  PULL: { name: '拉日', pats: ['lv', 'lh', 'rd', 'bi', 'bi'] },
  LEGS: { name: '腿日', pats: ['sq', 'hg', 'lg', 'gl', 'ca', 'co'] },
  // 部位分化：一天只練一到兩個部位，同一肌群一週只安排一次、刺激更集中
  CHEST: { name: '胸日', pats: ['ph', 'ph', 'ph', 'ph', 'tr'] },
  BACK: { name: '背日', pats: ['lv', 'lh', 'lv', 'lh', 'rd'] },
  SHOULDER: { name: '肩日', pats: ['pv', 'pv', 'ld', 'ld', 'rd'] },
  ARMS: { name: '手臂日', pats: ['bi', 'bi', 'tr', 'tr', 'co'] },
  CORECALF: { name: '核心＋小腿', pats: ['co', 'co', 'co', 'ca', 'ca'] },
  CT: { name: '胸＋三頭', pats: ['ph', 'ph', 'ph', 'tr', 'tr'] },
  BB: { name: '背＋二頭', pats: ['lv', 'lv', 'lh', 'bi', 'bi'] },
  SA: { name: '肩＋核心', pats: ['pv', 'pv', 'ld', 'rd', 'co'] }
};
// 每個訓練天數提供的分化方式：同一天數常有不只一種合理排法，讓使用者自己選
const SPLIT_STYLES = {
  2: [
    { id: 'full', label: '全身', sub: '兩天都練全身，適合剛開始或時間有限', keys: ['FB-A', 'FB-B'] },
    { id: 'ul', label: '上肢／下肢', sub: '一天上肢、一天下肢，恢復更完整', keys: ['U1', 'L1'] }
  ],
  3: [
    { id: 'full', label: '全身', sub: '三天都練全身，適合新手打基礎', keys: ['FB-A', 'FB-B', 'FB-C'] },
    { id: 'ppl', label: '推／拉／腿', sub: '依動作模式分工，一週各練一次', keys: ['PUSH', 'PULL', 'LEGS'] }
  ],
  4: [
    { id: 'ul', label: '上肢／下肢', sub: '上肢、下肢各練兩次，頻率較高', keys: ['U1', 'L1', 'U2', 'L2'] },
    { id: 'part4', label: '部位分化', sub: '胸三頭／背二頭／肩核心／腿，各練一次', keys: ['CT', 'BB', 'SA', 'LEGS'] }
  ],
  5: [
    { id: 'ppl_ul', label: '推拉腿＋上下肢', sub: '綜合安排，兼顧頻率與訓練量', keys: ['PUSH', 'PULL', 'LEGS', 'U1', 'L1'] },
    { id: 'bro5', label: '部位分化', sub: '胸／背／肩／腿／手臂各一天，經典排法', keys: ['CHEST', 'BACK', 'SHOULDER', 'LEGS', 'ARMS'] }
  ],
  6: [
    { id: 'ppl2', label: '推拉腿 ×2', sub: '一週練兩輪，訓練量最大', keys: ['PUSH', 'PULL', 'LEGS', 'PUSH', 'PULL', 'LEGS'] },
    { id: 'bro6', label: '部位分化', sub: '胸／背／肩／腿／手臂／核心小腿各一天', keys: ['CHEST', 'BACK', 'SHOULDER', 'LEGS', 'ARMS', 'CORECALF'] }
  ]
};
function stylesFor(days) { return SPLIT_STYLES[days] || SPLIT_STYLES[3]; }
function pickStyle(prof) { const s = stylesFor(prof.days); return s.find(x => x.id === prof.splitStyle) || s[0]; }
function generatePlan(prof) {
  const style = pickStyle(prof), keys = style.keys, rot = {}, seen = {};
  const sessions = keys.map((k, i) => {
    const t = TPL[k]; seen[k] = (seen[k] || 0) + 1;
    const name = t.name + (keys.filter(x => x === k).length > 1 ? ' ' + seen[k] : '');
    return { key: k + '-' + i, tpl: k, name, pats: t.pats.slice(), slots: resolveSlots(t.pats, prof, rot) };
  });
  return { generatedAt: today(), split: style.label, styleId: style.id, sessions, nextIdx: 0 };
}

/* ---------- 處方（組數、次數、休息） ---------- */
function presc(ex, prof = store.profile) {
  const L = RULES.presc[String(prof.level)], ph = prof.phase, cs = RULES.presc.coreSets;
  if (ex.type === 'duration') return { sets: cs, lo: L.dur.lo, hi: L.dur.hi, rest: 45, unit: '秒', kind: 'dur' };
  if (ex.pat === 'co') return { sets: cs, lo: L.bw.lo, hi: L.bw.hi, rest: 45, unit: '下', kind: 'bw' };
  if (ex.type === 'bodyweight_reps') return { sets: L.compound.sets[ph], lo: L.bw.lo, hi: L.bw.hi, rest: Math.min(L.compound.rest, 90), unit: '下', kind: 'bw' };
  const c = ex.iso ? L.iso : L.compound;
  return { sets: c.sets[ph], lo: c.lo, hi: c.hi, rest: c.rest, unit: '下', kind: ex.type === 'assisted_bodyweight' ? 'assist' : 'wt' };
}
const presText = p => p.sets + ' 組 × ' + p.lo + '–' + p.hi + ' ' + p.unit;
const sessionMinutes = (slots, prof) => Math.round(sum(slots, s => { const e = EXM[s.ex], p = presc(e, prof); return p.sets * (p.rest + 40) / 60; }) + 10);

/* ---------- 紀錄與進階建議 ---------- */
function allWorkouts() { return store.workouts; }
function lastSession(exId, beforeId) {
  const ws = allWorkouts();
  for (let i = ws.length - 1; i >= 0; i--) {
    if (ws[i].id === beforeId) continue;
    const e = ws[i].entries.find(x => x.ex === exId && x.sets && x.sets.length);
    if (e) return { date: ws[i].date, sets: e.sets, id: ws[i].id };
  }
  return null;
}
function setMetric(ex, s) {
  if (ex.type === 'duration') return s.t || 0;
  if (ex.type === 'assisted_bodyweight') return null;
  if (ex.type === 'weight_reps' && s.w > 0) return s.w * (1 + s.r / 30);
  return s.r || 0;
}
function bestOf(exId, excludeId) {
  const ex = EXM[exId]; let best = null;
  for (const w of allWorkouts()) {
    if (w.id === excludeId) continue;
    const e = w.entries.find(x => x.ex === exId); if (!e) continue;
    for (const s of e.sets) { const m = setMetric(ex, s); if (m != null && (best == null || m > best.m)) best = { m, s, date: w.date }; }
  }
  return best;
}
function stepFor(ex) {
  const st = RULES.progress.stepKg;
  if (ex.eq.includes('barbell')) return st.barbell;
  if (ex.eq.includes('db')) return st.db;
  if (ex.eq.includes('machine')) return st.machine;
  if (ex.eq.includes('cable')) return st.cable;
  return st.other;
}
function suggest(ex, pr, prof = store.profile, beforeId) {
  const last = lastSession(ex.id, beforeId);
  if (!last) {
    if (pr.kind === 'wt') return { kind: 'first', w: null, r: pr.lo, text: '第一次做：挑一個能做到 ' + pr.hi + ' 下、最後一組還留 2–3 下餘力的重量。' + (ex.eq.includes('db') ? '啞鈴填單手重量。' : '') };
    if (pr.kind === 'assist') return { kind: 'first', w: null, r: pr.lo, text: '第一次做：選一個能做 ' + pr.lo + '–' + pr.hi + ' 下的輔助重量（輔助越少越難）。' };
    if (pr.kind === 'dur') return { kind: 'first', w: null, r: pr.lo, text: '目標 ' + pr.lo + '–' + pr.hi + ' 秒，姿勢跑掉就停。' };
    return { kind: 'first', w: null, r: pr.lo, text: '目標 ' + pr.lo + '–' + pr.hi + ' 下，做到姿勢開始變形前一兩下就停。' };
  }
  const sets = last.sets, ls = sets[sets.length - 1] || {};
  const w = sets.reduce((m, s) => Math.max(m, s.w || 0), 0);
  const allTop = sets.length >= 1 && sets.every(s => (pr.kind === 'dur' ? (s.t || 0) : (s.r || 0)) >= pr.hi);
  const someLow = sets.some(s => (pr.kind === 'dur' ? (s.t || 0) : (s.r || 0)) < pr.lo);
  const lastDate = dateLabel(last.date);
  if (pr.kind === 'wt') {
    const step = stepFor(ex);
    if (w === 0) { // 徒手做的變化式
      if (allTop) return { kind: 'up', w: step, r: pr.lo, text: '上次（' + lastDate + '）每組都到 ' + pr.hi + ' 下，這次可以試著加 ' + step + ' kg。' };
      return { kind: 'reps', w: 0, r: Math.min(pr.hi, (ls.r || pr.lo) + 1), text: '上次每組約 ' + (ls.r || pr.lo) + ' 下，這次目標多做 1 下。' };
    }
    if (allTop) return { kind: 'up', w: round(w + step, 1), r: pr.lo, text: '上次（' + lastDate + '）' + fmt1(w) + ' kg 每組都做滿 ' + pr.hi + ' 下，這次加到 ' + fmt1(w + step) + ' kg，從 ' + pr.lo + ' 下開始。' };
    if (someLow) {
      const prev = lastSession(ex.id, last.id);
      const prevLow = prev && prev.sets.some(s => (s.r || 0) < pr.lo) && Math.max(...prev.sets.map(s => s.w || 0)) === w;
      if (prevLow) { const nw = round(w * (1 - RULES.progress.deloadPct / 100), 1); return { kind: 'down', w: nw, r: pr.hi, text: '連續兩次沒到 ' + pr.lo + ' 下，這次先降到 ' + fmt1(nw) + ' kg 把動作做穩，再慢慢加回來。' }; }
      return { kind: 'hold', w, r: pr.lo, text: '上次（' + lastDate + '）' + fmt1(w) + ' kg 有幾組不到 ' + pr.lo + ' 下，這次維持同重量，目標每組都做到 ' + pr.lo + ' 下以上。' };
    }
    return { kind: 'reps', w, r: Math.min(pr.hi, (ls.r || pr.lo) + 1), text: '上次 ' + fmt1(w) + ' kg × ' + sets.map(s => s.r).join('、') + '，這次維持重量，目標每組多 1 下，做到 ' + pr.hi + ' 下就加重。' };
  }
  if (pr.kind === 'assist') {
    const step = stepFor(ex);
    if (allTop) return { kind: 'up', w: Math.max(0, round(w - step, 1)), r: pr.lo, text: '每組都做滿 ' + pr.hi + ' 下，這次把輔助減少 ' + step + ' kg。' };
    return { kind: 'hold', w, r: (ls.r || pr.lo), text: '維持輔助 ' + fmt1(w) + ' kg，目標每組多 1 下。' };
  }
  if (pr.kind === 'dur') {
    if (allTop) return ex.next ? { kind: 'harder', w: null, r: pr.lo, text: '每組都撐到 ' + pr.hi + ' 秒，可以換成更難的「' + EXM[ex.next].zh + '」。' } : { kind: 'reps', w: null, r: pr.hi, text: '每組都撐到 ' + pr.hi + ' 秒，可以再加 5–10 秒。' };
    return { kind: 'reps', w: null, r: Math.min(pr.hi, (ls.t || pr.lo) + 5), text: '上次最後一組 ' + (ls.t || 0) + ' 秒，這次目標多撐 5 秒。' };
  }
  if (allTop) return ex.next ? { kind: 'harder', w: null, r: pr.lo, text: '每組都做滿 ' + pr.hi + ' 下，可以換成更難的「' + EXM[ex.next].zh + '」。' } : { kind: 'reps', w: null, r: pr.hi, text: '每組都做滿 ' + pr.hi + ' 下，可以放慢速度或增加組間張力。' };
  return { kind: 'reps', w: null, r: Math.min(pr.hi, (ls.r || pr.lo) + 1), text: '上次最後一組 ' + (ls.r || 0) + ' 下，這次每組目標多做 1 下。' };
}

/* ---------- 熱量與營養目標 ---------- */
const bmr = p => 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
const actMult = p => (RULES.activity.find(a => a.id === p.activity) || RULES.activity[1]).mult;
function targets(p = store.profile, adj = (store.adjust && store.adjust.kcal) || 0) {
  const B = bmr(p), tdee = B * actMult(p), ph = RULES.phases[p.phase];
  const pace = ph.paces.find(x => x.id === p.pace) || ph.paces[0];
  let raw = tdee * (1 + pace.pct / 100) + adj;
  const floorKcal = Math.max(Math.ceil(B / 50) * 50, p.sex === 'm' ? RULES.energy.floorM : RULES.energy.floorF);
  let capped = false;
  if (raw < floorKcal) { raw = floorKcal; capped = true; }
  const kcal = capped ? Math.ceil(raw / 50) * 50 : Math.round(raw / 50) * 50;
  let prot = Math.round(p.weight * RULES.protein.gPerKg[p.phase]);
  prot = Math.min(prot, Math.round(kcal * 0.4 / 4));
  const fat = Math.round(kcal * RULES.fat.default / 100 / 9);
  const carb = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  return {
    bmr: Math.round(B), tdee: Math.round(tdee), kcal, protein: prot, fat, carb, capped, floor: floorKcal, pace,
    proteinRange: [Math.round(p.weight * RULES.protein.strengthRange[0]), Math.round(p.weight * RULES.protein.strengthRange[1])],
    pPct: Math.round(prot * 4 / kcal * 100), fPct: Math.round(fat * 9 / kcal * 100), cPct: Math.round(carb * 4 / kcal * 100)
  };
}
const waterGoal = p => Math.max(RULES.water.min, Math.round(p.weight * RULES.water.perKgDefault / 100) * 100);
function hydration(p) {
  const h = RULES.hydration, w = p.weight;
  return { pre: [Math.round(w * h.preMlPerKg[0] / 10) * 10, Math.round(w * h.preMlPerKg[1] / 10) * 10], during: h.duringLPerHour, post: h.postLPerKgLost, postProtein: Math.max(RULES.protein.postExGrams[0], Math.round(p.weight * RULES.protein.postExGPerKg)) };
}

/* ---------- 體重、水、有氧 ---------- */
function weightsIn(from, to) { return store.body.filter(b => b.date >= from && b.date <= to && b.weight > 0); }
function latestWeight() { const s = store.body.filter(b => b.weight > 0).sort((a, b) => a.date < b.date ? -1 : 1); return s.length ? s[s.length - 1] : null; }
function avgWeight(from, to) { const a = weightsIn(from, to).map(b => b.weight); return a.length >= 1 ? { avg: avg(a), n: a.length } : null; }
function eqMin(list) { return sum(list, c => c.min * (c.int === 'vig' ? 2 : 1)); }
function cardioIn(from, to) { return store.cardio.filter(c => c.date >= from && c.date <= to); }
function workoutsIn(from, to) { return store.workouts.filter(w => w.date >= from && w.date <= to); }

/* ---------- 每週回顧 ---------- */
function weeklyReview(ref = today()) {
  const p = store.profile, T = targets(p), R = RULES.review;
  const to = addDays(ref, -1), from = addDays(ref, -7), pFrom = addDays(ref, -14), pTo = addDays(ref, -8);
  const items = [], m = {};
  // 飲食
  const days = []; for (let i = 0; i < 7; i++) { const d = addDays(from, i), r = intake(d); if (r && r.n > 0) days.push({ d, r }); }
  m.logged = days.length;
  m.kcalAvg = days.length ? avg(days.map(x => x.r.kcal)) : null;
  const covered = days.filter(x => x.r.kcal > 0 && x.r.kcalKnown / x.r.kcal >= 0.7);
  m.pDays = covered.filter(x => x.r.p >= T.protein * R.proteinDayRatio).length;
  m.pCovered = covered.length;
  m.pAvg = covered.length ? avg(covered.map(x => x.r.p)) : null;
  // 體重
  const wNow = avgWeight(from, to), wPrev = avgWeight(pFrom, pTo);
  m.wNow = wNow; m.wPrev = wPrev;
  m.rate = wNow && wPrev && wNow.n >= R.minWeighIns && wPrev.n >= R.minWeighIns ? wNow.avg - wPrev.avg : null;
  // 訓練
  const ws = workoutsIn(from, to); m.sessions = ws.length; m.planned = p.days;
  m.sets = sum(ws, w => sum(w.entries, e => e.sets.length));
  const cd = cardioIn(from, to); m.cardioMin = eqMin(cd);
  // 水
  const wl = []; for (let i = 0; i < 7; i++) { const v = store.water[addDays(from, i)]; if (v > 0) wl.push(v); }
  m.waterAvg = wl.length ? avg(wl) : null; m.waterDays = wl.length;
  m.prs = ws.reduce((n, w) => n + (w.prs ? w.prs.length : 0), 0);
  m.from = from; m.to = to;

  const dietOk = m.logged >= R.minLoggedDays;
  if (!dietOk) items.push({ tone: 'tip', title: '飲食紀錄還不夠', text: '這 7 天只有 ' + m.logged + ' 天有紀錄。先把紀錄補齊（至少 ' + R.minLoggedDays + ' 天），再調整熱量會準很多，所以這週先不建議改動目標。', basis: 'general' });
  // 體重與熱量
  const ph = p.phase;
  if (m.rate == null) items.push({ tone: 'tip', title: '體重資料不足', text: '每週至少量 ' + R.minWeighIns + ' 次體重（連續兩週），才看得出趨勢。建議固定在早上起床、上廁所後量。', basis: 'general' });
  else if (dietOk) {
    const r = m.rate, adherent = m.kcalAvg != null && Math.abs(m.kcalAvg - T.kcal) / T.kcal <= 0.15;
    if (ph === 'cut') {
      if (r < -R.cut.maxLossPerWeek) items.push({ tone: 'warn', title: '掉得偏快', text: '平均每週 ' + fmt1(r) + ' kg，超過 ACSM 建議的每週 0.5–1 kg 上限。掉太快容易連肌肉一起流失，建議把每日熱量加回 ' + R.cut.stepKcal + ' 大卡。', basis: 'acsm', src: RULES.weight.src, action: { type: 'kcal', delta: R.cut.stepKcal, label: '每日 +' + R.cut.stepKcal + ' 大卡' } });
      else if (r > -R.cut.minLossPerWeek) items.push(adherent
        ? { tone: 'tip', title: '體重沒有下降', text: '平均每週 ' + (r >= 0 ? '+' : '') + fmt1(r) + ' kg，而你的實際攝取跟目標差不多。可以把每日熱量再降 ' + R.cut.stepKcal + ' 大卡，或每週多加 20–30 分鐘中強度有氧。先觀察兩週再決定。', basis: 'general', action: { type: 'kcal', delta: -R.cut.stepKcal, label: '每日 −' + R.cut.stepKcal + ' 大卡' } }
        : { tone: 'tip', title: '體重沒有下降', text: '平均每週 ' + (r >= 0 ? '+' : '') + fmt1(r) + ' kg，不過實際攝取與目標有落差（平均 ' + fmt(m.kcalAvg) + ' 大卡）。先把攝取穩定在目標附近，再判斷要不要調整。', basis: 'general' });
      else items.push({ tone: 'ok', title: '減脂速度在合理範圍', text: '平均每週 ' + fmt1(r) + ' kg，落在合理範圍，維持現在的做法。', basis: 'acsm', src: RULES.weight.src });
    } else if (ph === 'bulk') {
      if (r > R.bulk.maxGainPerWeek) items.push({ tone: 'warn', title: '增得偏快', text: '平均每週 +' + fmt1(r) + ' kg，增太快多半會變成脂肪。建議把每日熱量減 ' + R.bulk.stepKcal + ' 大卡。', basis: 'general', action: { type: 'kcal', delta: -R.bulk.stepKcal, label: '每日 −' + R.bulk.stepKcal + ' 大卡' } });
      else if (r < R.bulk.minGainPerWeek) items.push(adherent
        ? { tone: 'tip', title: '體重沒有增加', text: '平均每週 ' + (r >= 0 ? '+' : '') + fmt1(r) + ' kg，攝取也接近目標。建議每日熱量加 ' + R.bulk.stepKcal + ' 大卡，觀察兩週。', basis: 'general', action: { type: 'kcal', delta: R.bulk.stepKcal, label: '每日 +' + R.bulk.stepKcal + ' 大卡' } }
        : { tone: 'tip', title: '體重沒有增加', text: '平均每週 ' + (r >= 0 ? '+' : '') + fmt1(r) + ' kg，但實際攝取低於目標（平均 ' + fmt(m.kcalAvg) + ' 大卡）。先吃到目標，再判斷是否要加。', basis: 'general' });
      else items.push({ tone: 'ok', title: '增重速度不錯', text: '平均每週 +' + fmt1(r) + ' kg，節奏很合理。', basis: 'general' });
    } else {
      if (Math.abs(r) > R.maintain.band) items.push({ tone: 'tip', title: '體重在漂移', text: '平均每週 ' + (r >= 0 ? '+' : '') + fmt1(r) + ' kg。想維持體重的話，建議每日熱量' + (r > 0 ? '減' : '加') + ' ' + R.maintain.stepKcal + ' 大卡。', basis: 'general', action: { type: 'kcal', delta: r > 0 ? -R.maintain.stepKcal : R.maintain.stepKcal, label: '每日 ' + (r > 0 ? '−' : '+') + R.maintain.stepKcal + ' 大卡' } });
      else items.push({ tone: 'ok', title: '體重很穩定', text: '這週平均變化 ' + (r >= 0 ? '+' : '') + fmt1(r) + ' kg，維持得很好。', basis: 'general' });
    }
  }
  // 蛋白質
  if (dietOk && m.pCovered >= 3) {
    if (m.pDays < Math.min(R.proteinDaysGoal, m.pCovered)) items.push({ tone: 'tip', title: '蛋白質偏少', text: '目標 ' + T.protein + ' g，這週只有 ' + m.pDays + ' / ' + m.pCovered + ' 天達到九成以上（平均 ' + Math.round(m.pAvg) + ' g）。每餐多一份蛋、豆製品、魚或瘦肉，通常就補得回來。' + (ph === 'cut' ? '減脂期蛋白質特別重要，能幫忙保住肌肉。' : ''), basis: 'acsm', src: RULES.protein.src });
    else items.push({ tone: 'ok', title: '蛋白質達標', text: m.pDays + ' / ' + m.pCovered + ' 天達到目標九成以上，很穩。', basis: 'acsm', src: RULES.protein.src });
  }
  if (dietOk && m.kcalAvg != null && m.kcalAvg < T.floor * 0.98 && ph !== 'bulk') items.push({ tone: 'warn', title: '平均熱量偏低', text: '這週平均 ' + fmt(m.kcalAvg) + ' 大卡，低於安全下限約 ' + fmt(T.floor) + ' 大卡。ACSM 提醒不要讓攝取低於靜態代謝率，吃太少會流失肌肉、影響訓練表現。', basis: 'acsm', src: RULES.energy.src });
  // 訓練
  if (m.sessions >= m.planned) items.push({ tone: 'ok', title: '訓練目標達成', text: '完成 ' + m.sessions + ' 次（目標 ' + m.planned + ' 次），共 ' + m.sets + ' 組。' + (m.prs ? '本週打破 ' + m.prs + ' 項個人紀錄。' : ''), basis: 'general' });
  else if (m.sessions < m.planned * R.trainRatio) items.push({ tone: 'tip', title: '訓練次數偏少', text: '完成 ' + m.sessions + ' 次，目標 ' + m.planned + ' 次。與其硬撐，不如把每週目標調成 ' + Math.max(2, m.planned - 1) + ' 天，先穩定做得到。ACSM 對健康導向的建議是每週 2–3 天全身訓練。', basis: 'acsm', src: RULES.resistance.src, action: { type: 'days', delta: -1, label: '改成每週 ' + Math.max(2, m.planned - 1) + ' 天' } });
  else items.push({ tone: 'tip', title: '差一點點', text: '完成 ' + m.sessions + ' 次，目標 ' + m.planned + ' 次。下週把訓練時間先排進行事曆。', basis: 'general' });
  // 有氧
  if (m.cardioMin < RULES.cardio.weeklyModerateMin) items.push({ tone: 'tip', title: '有氧時間', text: '這週約 ' + Math.round(m.cardioMin) + ' 分鐘（高強度 1 分鐘算 2 分鐘）。ACSM 建議每週累積 150 分鐘中強度，分 3–5 天；快走、騎車都算，可以拆成 10 分鐘一段。', basis: 'acsm', src: RULES.cardio.src });
  else items.push({ tone: 'ok', title: '有氧時間達標', text: '本週約 ' + Math.round(m.cardioMin) + ' 分鐘，達到每週 150 分鐘中強度的建議。', basis: 'acsm', src: RULES.cardio.src });
  // 飲水
  const wg = waterGoal(p);
  if (m.waterDays >= 3 && m.waterAvg < wg * R.waterRatio) items.push({ tone: 'tip', title: '喝水偏少', text: '有記錄的日子平均 ' + fmt(m.waterAvg) + ' mL，目標 ' + fmt(wg) + ' mL。口渴時通常已經少了 1–2 公升，建議固定時間喝，不要等到口渴。', basis: 'acsm', src: RULES.hydration.src });
  // 體重與目標重新評估
  const lw = latestWeight();
  if (lw && Math.abs(lw.weight - p.weight) / p.weight * 100 >= R.reassessPct) items.push({ tone: 'tip', title: '該更新體重了', text: '你設定的體重是 ' + fmt1(p.weight) + ' kg，最近的體重是 ' + fmt1(lw.weight) + ' kg。體重變了，熱量與蛋白質目標也要跟著重算。', basis: 'acsm', src: RULES.energy.src, action: { type: 'weight', value: lw.weight, label: '更新為 ' + fmt1(lw.weight) + ' kg' } });
  return { m, items, T, from, to };
}
function applyAction(a) {
  if (a.type === 'kcal') { store.adjust.kcal = clamp((store.adjust.kcal || 0) + a.delta, -RULES.review.adjustCap, RULES.review.adjustCap); store.applied.push({ date: today(), kcal: a.delta }); }
  else if (a.type === 'weight') { store.profile.weight = a.value; }
  else if (a.type === 'days') { store.profile.days = clamp(store.profile.days + a.delta, 2, 6); store.plan = generatePlan(store.profile); }
  save();
}

/* ---------- 訓練中紀錄 ---------- */
function envProfile(prof, envKey) {
  if (!envKey || envKey === 'mine') return prof;
  return Object.assign({}, prof, { equip: Object.assign({}, PRESETS[envKey].equip) });
}
function startWorkout(sessionIdx, envKey) {
  const s = store.plan.sessions[sessionIdx], prof = store.profile;
  let slots = s.slots.map(x => ({ pat: x.pat, ex: x.ex }));
  if (envKey && envKey !== 'mine') slots = resolveSlots(s.pats, envProfile(prof, envKey), {});
  store.active = { id: uid(), date: today(), start: Date.now(), sessionIdx, sessionKey: s.key, name: s.name, env: envKey || 'mine', restEnd: null,
    slots: slots.map(x => ({ ex: x.ex, pat: x.pat, sets: [] })), cardioNote: null };
  save();
}
function finishWorkout() {
  const a = store.active; if (!a) return null;
  const entries = a.slots.map(sl => ({ ex: sl.ex, sets: sl.sets.filter(x => x.done).map(x => ({ w: x.w || 0, r: x.r || 0, t: x.t || 0 })) })).filter(e => e.sets.length);
  const prs = [];
  for (const e of entries) {
    const ex = EXM[e.ex], best = bestOf(e.ex, a.id);
    let m = null, top = null;
    for (const s of e.sets) { const v = setMetric(ex, s); if (v != null && (m == null || v > m)) { m = v; top = s; } }
    if (m != null && m > 0 && best && m > best.m + 1e-9) prs.push({ ex: e.ex, w: top.w, r: top.r, t: top.t });
  }
  const w = { id: a.id, date: a.date, start: a.start, end: Date.now(), sessionKey: a.sessionKey, name: a.name, env: a.env === 'mine' ? store.profile.preset : a.env, entries, prs };
  if (entries.length) {
    store.workouts.push(w);
    if (store.plan && a.sessionIdx != null) store.plan.nextIdx = (a.sessionIdx + 1) % store.plan.sessions.length;
  }
  store.active = null; save();
  return entries.length ? w : null;
}
function volumeOf(w) { return Math.round(sum(w.entries, e => sum(e.sets, s => (s.w || 0) * (s.r || 0)))); }

/* ============ 介面 ============ */
const ui = { tab: 'today', seg: 'plan', screen: null, exIdx: 0, libGroup: 'all', libQ: '', libMine: true, onb: null, toastT: null, histN: 15 };
const I = {
  today: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  train: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/></svg>',
  lib: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  diet: '<svg viewBox="0 0 24 24"><path d="M4 11h16a8 8 0 0 1-16 0zM9 6.5c0-1.5 1-2 1-3.5M14 6.5c0-1.5 1-2 1-3.5"/></svg>',
  me: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M5 8h13l-3-3M19 16H6l3 3"/></svg>'
};
const PHASE_LABEL = p => { const ph = RULES.phases[p.phase], pc = ph.paces.find(x => x.id === p.pace) || ph.paces[0]; return ph.label + (ph.paces.length > 1 ? '・' + pc.label : ''); };
const presetLabel = k => k === 'mine' ? '我的設定' : PRESETS[k].label;
const meter = (v, t, cls = '') => '<div class="meter ' + cls + '"><i style="width:' + clamp(t > 0 ? v / t * 100 : 0, 0, 100) + '%"></i></div>';
const chipEl = (t, cls = '') => '<span class="chip ' + cls + '">' + esc(t) + '</span>';
const frameThumb = ex => '<span class="thumb" style="background-image:url(\'' + esc(ex.img) + '\')" role="img" aria-label="' + esc(ex.zh) + '"></span>';
const board = (ex, cls = '') => '<div class="board ' + cls + '" role="img" aria-label="' + esc(ex.zh) + ' 動作示範（循環播放三個分鏡）"><div class="frames" style="background-image:url(\'' + esc(ex.img) + '\')"></div></div>';
const basisTag = it => it.basis === 'acsm' ? '<span class="src">依據 ' + esc(it.src || 'ACSM') + '</span>' : '<span class="src gen">一般做法</span>';

function toast(msg, ms = 2600) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(ui.toastT); ui.toastT = setTimeout(() => t.classList.remove('show'), ms);
}
function openSheet(html, cls = '') {
  const r = $('#sheet-root'); r.innerHTML = '<div class="scrim" data-action="closeSheet"></div><div class="sheet ' + cls + '" role="dialog" aria-modal="true"><div class="grab"></div>' + html + '</div>';
  r.classList.add('open'); document.body.classList.add('noscroll');
  const f = $('.sheet [data-autofocus]', r); if (f) f.focus();
}
function closeSheet() { const r = $('#sheet-root'); r.classList.remove('open'); r.innerHTML = ''; document.body.classList.remove('noscroll'); }

/* ---------- 共用資料 ---------- */
function weekInfo(ref = today()) {
  const mon = mondayOf(ref), days = [];
  for (let i = 0; i < 7; i++) { const d = addDays(mon, i); days.push({ d, wd: WD[parseD(d).getDay()], n: store.workouts.filter(w => w.date === d).length, isToday: d === ref, future: d > ref }); }
  return { mon, days, done: sum(days, x => x.n) };
}
function nextSession() { const p = store.plan; if (!p || !p.sessions.length) return null; const i = ((p.nextIdx || 0) % p.sessions.length + p.sessions.length) % p.sessions.length; return { s: p.sessions[i], i }; }
function trainedToday() { return store.workouts.some(w => w.date === today()); }
function coachTips() {
  const p = store.profile, h = hydration(p), tips = [];
  const doy = Math.floor((parseD(today()) - new Date(parseD(today()).getFullYear(), 0, 0)) / 864e5);
  tips.push({ t: '訓練前 2–4 小時先喝 ' + h.pre[0] + '–' + h.pre[1] + ' mL 水；訓練中每小時喝 0.4–0.8 公升，固定間隔喝，不要等到口渴。', src: RULES.hydration.src, b: 'acsm' });
  tips.push({ t: '訓練後補約 ' + h.postProtein + ' g 蛋白質（約每公斤體重 0.3 g）。流汗很多時，體重每少 1 公斤補 1.25–1.5 公升水。', src: RULES.protein.src, b: 'acsm' });
  tips.push({ t: p.phase === 'cut' ? '減脂期優先顧蛋白質與睡眠，重量別為了「多消耗」而刻意降很多，保住力量就是保住肌肉。' : p.phase === 'bulk' ? '增肌期看每週體重的趨勢就好，小幅上升就是對的，不需要為了快而硬吃。' : '維持期的重點是把習慣穩定下來，每週固定的訓練與記錄比什麼都重要。', b: 'general' });
  tips.push({ t: p.level === 1 ? '新手前幾週先把動作做穩、重量寧可輕一點。能做到每組留 2–3 下餘力，是很好的起點。' : '每組最後一下應該有點吃力但姿勢不變形；姿勢先跑掉就停，比多做一下重要。', b: 'general' });
  tips.push({ t: '重量訓練後的伸展：每個動作停 10–30 秒、重複 2–4 次，一週至少 2–3 天。', src: RULES.flex.src, b: 'acsm' });
  const lw = latestWeight();
  if (!lw || addDays(today(), -3) > lw.date) tips.unshift({ t: '這幾天沒有量體重了。固定在早上起床、上廁所後量，週回顧才看得出趨勢。', b: 'general' });
  const a = tips[doy % tips.length], b = tips[(doy + 2) % tips.length];
  return a === b ? [a] : [a, b];
}
const tipHtml = t => '<p class="tip">' + esc(t.t) + ' ' + (t.b === 'acsm' ? '<span class="src">依據 ' + esc(t.src) + '</span>' : '<span class="src gen">一般做法</span>') + '</p>';

/* ---------- 導覽與外框 ---------- */
function viewHeader() {
  const p = store.profile;
  return '<header class="top"><div><h1>' + (p.name ? esc(p.name) + '的教練' : '健身教練') + '</h1><p class="sub">' + dateLabel(today()) + '</p></div>' + chipEl(PHASE_LABEL(p), 'phase') + '</header>';
}
function viewNav() {
  const tabs = [['today', '今日', I.today], ['train', '訓練', I.train], ['lib', '動作', I.lib], ['diet', '飲食', I.diet], ['me', '我的', I.me]];
  return '<nav class="nav" id="nav" aria-label="主要分頁">' + tabs.map(t => '<button data-action="tab" data-tab="' + t[0] + '" class="' + (ui.tab === t[0] ? 'on' : '') + '"' + (ui.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[2] + '<span>' + t[1] + '</span></button>').join('') + '</nav>';
}

/* ---------- 今日 ---------- */
function viewToday() {
  const p = store.profile, T = targets(p), wk = weekInfo(), ns = nextSession(), I0 = intake(today());
  const plates = '<section class="week card" aria-label="本週訓練"><div class="plates">' + wk.days.map(d =>
    '<div class="wd' + (d.n ? ' on' : '') + (d.isToday ? ' now' : '') + (d.future ? ' fut' : '') + '"><span class="plate" aria-hidden="true">' + (d.n ? d.n : '') + '</span><small>' + d.wd + '</small></div>').join('') +
    '</div><p class="weekline"><b>' + wk.done + '</b> / ' + p.days + ' 次<span>本週訓練' + (wk.done >= p.days ? '，目標達成' : '') + '</span></p></section>';
  let next = '';
  if (store.active) {
    next = '<section class="slate next"><h2>' + esc(store.active.name) + '</h2><p>有一個進行中的訓練（' + dateLabel(store.active.date) + '）</p><div class="row"><button class="btn primary" data-action="resume">繼續訓練</button><button class="btn ghost-l" data-action="abandonAsk">放棄</button></div></section>';
  } else if (ns) {
    const names = ns.s.slots.map(x => EXM[x.ex].zh);
    const done = wk.done >= p.days;
    next = '<section class="slate next"><h2>' + (done ? '本週目標完成，還想練的話：' : '') + esc(ns.s.name) + '</h2><p>' + ns.s.slots.length + ' 個動作・約 ' + sessionMinutes(ns.s.slots, p) + ' 分鐘・' + esc(presetLabel(p.preset)) + '</p><ul class="mini">' + names.map(n => '<li>' + esc(n) + '</li>').join('') + '</ul><div class="row"><button class="btn primary" data-action="startPick" data-i="' + ns.i + '">開始訓練</button><button class="btn ghost-l" data-action="seg" data-seg="plan" data-tab="train">看整週課表</button></div></section>';
  }
  const diet = '<section class="card tap" data-action="tab" data-tab="diet" role="button" tabindex="0"><div class="cardhead"><h2>今天的飲食</h2><span class="more">看細節</span></div>' + (I0 && I0.n
    ? '<div class="kv"><div><b>' + fmt(I0.kcal) + '</b><small>/ ' + fmt(T.kcal) + ' 大卡</small></div><div><b>' + Math.round(I0.p) + '</b><small>/ ' + T.protein + ' g 蛋白質</small></div></div>' + meter(I0.kcal, T.kcal) + meter(I0.p, T.protein, 'prot')
    : '<p class="muted">還沒有今天的飲食紀錄。目標：' + fmt(T.kcal) + ' 大卡、蛋白質 ' + T.protein + ' g。</p>') + '</section>';
  const wg = waterGoal(p), wv = store.water[today()] || 0;
  const water = '<section class="card"><div class="cardhead"><h2>喝水</h2><span class="muted"><b class="big">' + fmt(wv) + '</b> / ' + fmt(wg) + ' mL</span></div>' + meter(wv, wg, 'water') + '<div class="row"><button class="btn small" data-action="water" data-ml="250">+250</button><button class="btn small" data-action="water" data-ml="500">+500</button><button class="btn small ghost" data-action="water" data-ml="-250">−250</button></div></section>';
  const tips = '<section class="card"><h2>今日教練提醒</h2>' + coachTips().map(tipHtml).join('') + '</section>';
  const rev = '<button class="card linkcard" data-action="review"><span><b>上週回顧</b><small>飲食、體重、訓練，教練幫你看趨勢</small></span><span class="more">查看</span></button>';
  return plates + next + diet + water + tips + rev;
}

/* ---------- 訓練 ---------- */
function slotList(s, prof) {
  return '<ol class="exlist">' + s.slots.map(x => { const e = EXM[x.ex], pr = presc(e, prof); return '<li>' + frameThumb(e) + '<span><b>' + esc(e.zh) + '</b><small>' + esc(presText(pr)) + '・休息 ' + pr.rest + ' 秒</small></span></li>'; }).join('') + '</ol>';
}
function viewTrain() {
  const p = store.profile, seg = ui.seg;
  const tabs = [['plan', '課表'], ['log', '紀錄'], ['cardio', '有氧']];
  let body = '';
  if (seg === 'plan') {
    const wk = weekInfo(), ns = nextSession();
    body = '<p class="muted pad">' + esc(store.plan.split) + '・每週 ' + p.days + ' 天・' + esc(presetLabel(p.preset)) + '・依序輪流練，下一個是「' + esc(ns.s.name) + '」</p>' +
      store.plan.sessions.map((s, i) => '<section class="card' + (ns.i === i ? ' hl' : '') + '"><div class="cardhead"><h2>' + esc(s.name) + '</h2><span class="muted">' + s.slots.length + ' 個動作・約 ' + sessionMinutes(s.slots, p) + ' 分鐘</span></div>' + slotList(s, p) + '<div class="row"><button class="btn small primary" data-action="startPick" data-i="' + i + '">' + (store.active ? '改練這個' : '開始') + '</button></div></section>').join('') +
      '<p class="note">動作順序依 ACSM 第 14 章原則排列：大肌群在前、多關節在前，推拉與上下肢交替。組數與次數落在建議範圍內，實際重量以「最後一下有點吃力、姿勢不變形」為準。</p>';
  } else if (seg === 'log') {
    const ws = store.workouts.slice().reverse();
    body = ws.length ? ws.slice(0, ui.histN).map(w => '<button class="card linkcard" data-action="wdetail" data-id="' + esc(w.id) + '"><span><b>' + esc(w.name) + '</b><small>' + dateLabel(w.date) + '・' + sum(w.entries, e => e.sets.length) + ' 組・' + fmt(volumeOf(w)) + ' kg' + (w.prs && w.prs.length ? '・破 ' + w.prs.length + ' 項紀錄' : '') + '</small></span><span class="more">查看</span></button>').join('') + (ws.length > ui.histN ? '<button class="btn wide ghost" data-action="moreHist">顯示更多</button>' : '')
      : '<div class="empty"><p>還沒有訓練紀錄。</p><button class="btn primary" data-action="seg" data-seg="plan">去開始第一次訓練</button></div>';
  } else {
    const wk = weekInfo(), cm = eqMin(cardioIn(wk.mon, addDays(wk.mon, 6))), goal = RULES.cardio.weeklyModerateMin;
    const list = store.cardio.slice().reverse().slice(0, 20);
    body = '<section class="card"><div class="cardhead"><h2>本週有氧</h2><span class="muted"><b class="big">' + Math.round(cm) + '</b> / ' + goal + ' 分鐘</span></div>' + meter(cm, goal, 'water') + '<p class="muted small">高強度 1 分鐘算 2 分鐘。ACSM 建議每週累積 150 分鐘中強度（或 75 分鐘高強度），分 3–5 天；可以拆成 10 分鐘一段。</p><div class="row"><button class="btn primary" data-action="cardioAdd">記錄有氧</button></div></section>' +
      (list.length ? '<section class="card"><h2>最近紀錄</h2>' + list.map(c => '<div class="line"><span>' + dateLabel(c.date) + '　' + esc((CARDIO.find(x => x.id === c.type) || { zh: c.type }).zh) + '</span><span>' + c.min + ' 分・' + (c.int === 'vig' ? '高強度' : '中強度') + ' <button class="x" data-action="cardioDel" data-id="' + esc(c.id) + '" aria-label="刪除這筆">×</button></span></div>').join('') + '</section>' : '');
  }
  return '<div class="seg" role="tablist">' + tabs.map(t => '<button role="tab" aria-selected="' + (seg === t[0]) + '" class="' + (seg === t[0] ? 'on' : '') + '" data-action="seg" data-seg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' + body;
}

/* ---------- 動作庫 ---------- */
function libList() {
  const q = ui.libQ.trim().toLowerCase(), p = store.profile;
  return EXL.filter(e => {
    if (ui.libGroup !== 'all' && DATA.patterns[e.pat].group !== ui.libGroup) return false;
    if (ui.libMine && !exOk(e, p.equip)) return false;
    if (q && !(e.zh.toLowerCase().includes(q) || e.en.toLowerCase().includes(q) || e.main.includes(q))) return false;
    return true;
  });
}
function viewLib() {
  const list = libList();
  return '<div class="search"><input id="libq" type="search" placeholder="搜尋動作或肌群，例如「深蹲」「胸」" value="' + esc(ui.libQ) + '" aria-label="搜尋動作"></div>' +
    '<div class="chips scrollx" role="group" aria-label="動作分類">' + GROUPS.map(g => '<button class="chip btnchip' + (ui.libGroup === g[0] ? ' on' : '') + '" data-action="libGroup" data-g="' + g[0] + '" aria-pressed="' + (ui.libGroup === g[0]) + '">' + g[1] + '</button>').join('') + '</div>' +
    '<label class="switch"><input type="checkbox" data-action="libMine"' + (ui.libMine ? ' checked' : '') + '><span>只顯示我有器材的動作</span></label>' +
    '<p class="muted small pad" id="libcount">共 ' + list.length + ' 個動作</p>' +
    '<div class="grid" id="libgrid">' + libGrid(list) + '</div>';
}
function libGrid(list) {
  return list.length ? list.slice(0, 80).map(e => '<button class="gcard" data-action="exDetail" data-id="' + esc(e.id) + '"><span class="gthumb" style="background-image:url(\'' + esc(e.img) + '\')" role="img" aria-label="' + esc(e.zh) + '"></span><b>' + esc(e.zh) + '</b><small>' + esc(e.main) + '・' + (e.eq.length ? e.eq.map(q => EQ_LABEL[q]).join('＋') : '徒手') + '</small></button>').join('') + (list.length > 80 ? '<p class="muted small pad full">還有 ' + (list.length - 80) + ' 個，請用搜尋縮小範圍。</p>' : '') : '<p class="muted pad full">找不到符合的動作。試試取消「只顯示我有器材的動作」。</p>';
}
function sheetExercise(id) {
  const e = EXM[id], b = bestOf(id), pr = presc(e), ls = lastSession(id);
  const bestTxt = b ? (e.type === 'duration' ? b.s.t + ' 秒' : (b.s.w > 0 ? fmt1(b.s.w) + ' kg × ' + b.s.r : b.s.r + ' 下')) + '（' + dateLabel(b.date) + '）' : '尚無紀錄';
  openSheet(board(e) + '<div class="sbody"><h2>' + esc(e.zh) + '</h2><p class="muted small">' + esc(e.en) + '</p><div class="chips">' + chipEl(e.main, 'on') + e.sec.map(s => chipEl(s)).join('') + chipEl(e.eq.length ? e.eq.map(q => EQ_LABEL[q]).join('＋') : '徒手') + chipEl(DATA.patterns[e.pat].zh) + '</div>' +
    '<h3>做法要點</h3><ul class="cues">' + e.cues.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul><details><summary>這類動作的通用提醒</summary><p>' + esc(DATA.patterns[e.pat].cue) + '</p></details>' +
    (e.warm || e.cool ? '<p class="muted small">' + (e.warm ? '適合放在暖身：動態伸展每個動作 ' + RULES.flex.dynReps[0] + '–' + RULES.flex.dynReps[1] + ' 次。' : '適合放在收操：每個伸展停 ' + RULES.flex.holdSec[0] + '–' + RULES.flex.holdSec[1] + ' 秒、重複 ' + RULES.flex.reps[0] + '–' + RULES.flex.reps[1] + ' 次。') + '</p>'
      : '<div class="kv2"><div><small>建議處方</small><b>' + esc(presText(pr)) + '</b></div><div><small>個人最佳</small><b>' + esc(bestTxt) + '</b></div></div>') +
    (e.next ? '<p class="muted small">進階路線：' + esc(EXM[e.next].zh) + '</p>' : '') + '<button class="btn wide" data-action="closeSheet">關閉</button></div>', 'tall');
}

/* ---------- 飲食 ---------- */
function sparkline(pts) {
  if (pts.length < 2) return '';
  const W = 300, H = 70, xs = pts.map(p => p.x), ys = pts.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), dy = (y1 - y0) || 1, dx = (x1 - x0) || 1;
  const P = pts.map(p => [6 + (p.x - x0) / dx * (W - 12), H - 8 - (p.y - y0) / dy * (H - 18)]);
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近 4 週體重走勢，從 ' + fmt1(ys[0]) + ' 到 ' + fmt1(ys[ys.length - 1]) + ' 公斤"><polyline points="' + P.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' + P.map(p => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" fill="currentColor"/>').join('') + '</svg>';
}
function mealTag(t) { const h = parseInt(String(t || '').slice(0, 2), 10); return h >= 4 && h < 10 ? '早餐' : h >= 10 && h < 15 ? '午餐' : h >= 15 && h < 21 ? '晚餐' : '其他'; }
function dietEntryList(date) {
  const d = dietDay(date); if (!d || !d.entries.length) return '';
  const rows = d.entries.slice().sort((a, b) => a.time < b.time ? -1 : 1).map(e => {
    const qtyCtl = e.base ? '<span class="qty"><button data-action="dQty" data-id="' + esc(e.id) + '" data-d="-0.5">−</button><b>' + fmt1(e.qty) + '</b><button data-action="dQty" data-id="' + esc(e.id) + '" data-d="0.5">+</button></span>' : '';
    return '<div class="fentry"><span class="femoji">' + esc(e.emoji || '🍽️') + '</span><span class="finfo"><b>' + esc(e.name) + '</b><small>' + esc(e.time) + '・' + esc(mealTag(e.time)) + (e.brand ? '・' + esc(e.brand) : '') + '</small></span>' + qtyCtl + '<span class="fkcal">' + fmt(e.kcal) + '<small>大卡</small></span><button class="x" data-action="dDel" data-id="' + esc(e.id) + '" aria-label="刪除「' + esc(e.name) + '」">×</button></div>';
  }).join('');
  return '<section class="card"><h2>今天的紀錄</h2><div class="flist">' + rows + '</div></section>';
}
function foodResults(q, cat) {
  q = q.trim().toLowerCase();
  let list = store.customFoods.concat(FOODS);
  if (cat && cat !== 'all') list = list.filter(x => x.category === cat);
  if (q) list = list.filter(x => x.name.toLowerCase().includes(q) || (x.brand && x.brand.toLowerCase().includes(q)));
  return list.slice(0, 40);
}
function foodRow(f) { return '<button class="frow" data-action="foodPick" data-id="' + esc(f.id) + '"><span class="femoji">' + esc(f.emoji || '🍽️') + '</span><span class="finfo"><b>' + esc(f.name) + '</b><small>' + esc(f.brand ? f.brand + '・' : '') + esc(f.serving) + '</small></span><span class="fkcal">' + fmt(f.kcal) + '<small>大卡</small></span></button>'; }
function sheetFoodAdd() {
  ui.food = { q: '', cat: 'all' };
  const list = foodResults('', 'all');
  openSheet('<div class="sbody"><h2>記錄食物</h2><div class="search"><input id="foodq" type="search" placeholder="搜尋食物或品牌，例如「茶葉蛋」「全家」" data-autofocus></div>' +
    '<div class="chips scrollx" id="foodcats" role="group" aria-label="食物分類"><button class="chip btnchip on" data-action="foodCat" data-c="all">全部</button>' + FOOD_CATS.map(c => '<button class="chip btnchip" data-action="foodCat" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
    '<div class="flist" id="foodlist">' + list.map(foodRow).join('') + '</div>' +
    '<button class="btn wide ghost" data-action="customToggle">找不到？手動輸入</button><div id="customForm" hidden></div><button class="btn wide" data-action="closeSheet">關閉</button></div>', 'tall');
}
function customFormHtml() {
  return '<section class="card"><h3>手動輸入</h3><label class="fld"><span>名稱</span><input class="in" id="cfName" placeholder="例如：路邊攤炒麵"></label><div class="grid3"><label class="fld"><span>熱量 大卡</span><input class="in" id="cfKcal" inputmode="numeric"></label><label class="fld"><span>蛋白質 g</span><input class="in" id="cfP" inputmode="decimal" placeholder="不確定可留空"></label><label class="fld"><span>脂肪 g</span><input class="in" id="cfF" inputmode="decimal" placeholder="不確定可留空"></label></div><label class="fld"><span>碳水 g（不確定可留空）</span><input class="in" id="cfC" inputmode="decimal"></label><label class="switch"><input type="checkbox" id="cfSave" checked><span>記住這個項目，下次可以直接搜尋</span></label><p class="err" id="cfErr"></p><button class="btn primary wide" data-action="customSave">加入今天</button></section>';
}
function viewDiet() {
  const p = store.profile, T = targets(p), d = today(), R = intake(d), adj = store.adjust.kcal || 0, hy = hydration(p);
  const tgt = '<section class="card"><div class="cardhead"><h2>今日目標</h2>' + chipEl(PHASE_LABEL(p), 'phase') + '</div><div class="bigkcal"><b>' + fmt(T.kcal) + '</b><span>大卡' + (adj ? '（含教練調整 ' + (adj > 0 ? '+' : '') + adj + '）' : '') + '</span></div>' +
    '<div class="macros"><div><b>' + T.protein + '<small>g</small></b><span>蛋白質</span><i>' + T.pPct + '%</i></div><div><b>' + T.carb + '<small>g</small></b><span>碳水</span><i>' + T.cPct + '%</i></div><div><b>' + T.fat + '<small>g</small></b><span>脂肪</span><i>' + T.fPct + '%</i></div></div>' +
    (T.capped ? '<p class="warn">目標已套用安全下限（' + fmt(T.floor) + ' 大卡）。ACSM 提醒不要讓攝取低於靜態代謝率，建議放慢速度而不是再降熱量。</p>' : '') +
    '<details><summary>這些數字怎麼算的</summary><ul class="how"><li>基礎代謝 ' + fmt(T.bmr) + '、每日消耗約 ' + fmt(T.tdee) + ' 大卡（Mifflin-St Jeor 公式 × 活動係數，一般做法）。</li><li>' + esc(RULES.phases[p.phase].label) + '・' + esc(T.pace.label) + '：熱量 ' + (T.pace.pct > 0 ? '+' : '') + T.pace.pct + '%（一般做法）。</li><li>蛋白質 ' + RULES.protein.gPerKg[p.phase] + ' g/公斤（範圍 ' + T.proteinRange[0] + '–' + T.proteinRange[1] + ' g）。<span class="src">依據 ' + RULES.protein.src + '</span></li><li>脂肪約占 ' + RULES.fat.default + '%（建議範圍 ' + RULES.fat.pctKcal[0] + '–' + RULES.fat.pctKcal[1] + '%），碳水用剩下的熱量補足（一般建議 ' + RULES.carb.pctKcal[0] + '–' + RULES.carb.pctKcal[1] + '%）。<span class="src">依據 ' + RULES.fat.src + '</span></li><li>熱量下限：不低於估算的靜態代謝率，也不低於 ' + fmt(p.sex === 'm' ? RULES.energy.floorM : RULES.energy.floorF) + ' 大卡。<span class="src">依據 ' + RULES.energy.src + '</span></li></ul></details></section>';
  let today_ = '<section class="card"><div class="cardhead"><h2>今天吃了多少</h2><button class="btn small primary" data-action="dietAdd">＋ 記錄食物</button></div>';
  if (!R || !R.n) today_ += '<p class="muted">今天還沒有飲食紀錄。</p></section>';
  else {
    const cov = R.kcal > 0 ? R.kcalKnown / R.kcal : 0;
    const row = (l, v, t, u, cls) => '<div class="mrow"><span>' + l + '</span><span><b>' + fmt(v) + '</b> / ' + fmt(t) + ' ' + u + '</span></div>' + meter(v, t, cls);
    today_ += row('熱量', R.kcal, T.kcal, '大卡', '') + row('蛋白質', R.p, T.protein, 'g', 'prot') + row('碳水', R.c, T.carb, 'g', 'carb') + row('脂肪', R.f, T.fat, 'g', 'fat') +
      (R.unk ? '<p class="muted small">有 ' + R.unk + ' 筆食物沒有營養素資料，沒有算進三大營養素（占今天熱量 ' + Math.round((1 - cov) * 100) + '%）。</p>' : '') + '</section>' + dietEntryList(d);
    if (R.mealsKnown) {
      const ref = Math.max(15, Math.round(p.weight * 0.3)), lab = { b: '早餐', l: '午餐', d: '晚餐', o: '其他時段' }, mx = Math.max(ref * 1.6, ...Object.values(R.meals));
      today_ += '<section class="card"><h2>蛋白質分布</h2>' + ['b', 'l', 'd', 'o'].map(k => '<div class="mrow"><span>' + lab[k] + '</span><span><b>' + Math.round(R.meals[k]) + '</b> g</span></div><div class="meter prot"><i style="width:' + clamp(R.meals[k] / mx * 100, 0, 100) + '%"></i><u style="left:' + clamp(ref / mx * 100, 0, 100) + '%"></u></div>').join('') + '<p class="muted small">直線是每餐約 ' + ref + ' g（體重 × 0.3）。把蛋白質分散在每一餐，比一餐吃很多更容易被用到。<span class="src gen">一般做法</span></p></section>';
    }
  }
  const trained = trainedToday(), wk = weekInfo();
  const around = '<section class="card"><h2>' + (trained ? '練完了：補充與恢復' : '訓練前後怎麼吃喝') + '</h2><ul class="how"><li>訓練前 2–4 小時：喝 ' + hy.pre[0] + '–' + hy.pre[1] + ' mL 水，並吃一餐或點心。</li><li>訓練中：每小時 ' + hy.during[0] + '–' + hy.during[1] + ' 公升，固定間隔小口喝。</li><li>訓練後：補約 ' + hy.postProtein + ' g 蛋白質（15–25 g）；流汗多的話，體重每少 1 公斤補 ' + hy.post[0] + '–' + hy.post[1] + ' 公升水。</li></ul><p class="muted small"><span class="src">依據 ' + RULES.hydration.src + '</span>　' + (wk.done >= p.days ? '本週訓練目標已完成，' : '') + '休息日的熱量與蛋白質目標維持不變。</p></section>';
  const wg = waterGoal(p), wv = store.water[d] || 0;
  const water = '<section class="card"><div class="cardhead"><h2>喝水</h2><span class="muted"><b class="big">' + fmt(wv) + '</b> / ' + fmt(wg) + ' mL</span></div>' + meter(wv, wg, 'water') + '<div class="row"><button class="btn small" data-action="water" data-ml="250">+250</button><button class="btn small" data-action="water" data-ml="500">+500</button><button class="btn small ghost" data-action="water" data-ml="-250">−250</button></div><p class="muted small">每日目標 ' + fmt(wg) + ' mL 是一般估算（體重 × ' + RULES.water.perKgDefault + ' mL），可依天氣與流汗量調整；尿液維持淡黃色是不錯的指標。</p></section>';
  const t28 = store.body.filter(b => b.date >= addDays(d, -27) && b.weight > 0).sort((a, b) => a.date < b.date ? -1 : 1);
  const a7 = avgWeight(addDays(d, -6), d), lw = latestWeight(), tw = weightsIn(d, d)[0];
  const body = '<section class="card"><div class="cardhead"><h2>體重</h2><span class="muted">' + (a7 ? '7 天平均 <b class="big">' + fmt1(a7.avg) + '</b> kg' : '尚無紀錄') + '</span></div>' + sparkline(t28.map(b => ({ x: parseD(b.date).getTime(), y: b.weight }))) +
    '<div class="row"><input id="wIn" class="in" inputmode="decimal" placeholder="' + (tw ? fmt1(tw.weight) : lw ? fmt1(lw.weight) : '今天體重') + ' kg" aria-label="今天的體重（公斤）"><button class="btn primary" data-action="saveWeight">' + (tw ? '更新今天' : '記錄') + '</button></div><p class="muted small">建議固定在早上起床、上廁所後量。看 7 天平均，不看單日數字。</p></section>';
  return tgt + today_ + around + water + body + '<button class="card linkcard" data-action="review"><span><b>上週回顧</b><small>看體重趨勢、蛋白質與訓練，教練給調整建議</small></span><span class="more">查看</span></button>';
}

/* ---------- 我的 ---------- */
function viewMe() {
  const p = store.profile, T = targets(p), lb = store.lastBackup;
  const eqs = EQ_KEYS.filter(k => p.equip[k]).map(k => EQ_LABEL[k]);
  return '<section class="card"><div class="cardhead"><h2>目前設定</h2><button class="btn small" data-action="editProfile">修改</button></div><dl class="dl"><dt>階段</dt><dd>' + esc(PHASE_LABEL(p)) + '</dd><dt>身體</dt><dd>' + p.height + ' cm・' + fmt1(p.weight) + ' kg・' + p.age + ' 歲</dd><dt>場景</dt><dd>' + esc(presetLabel(p.preset)) + '（' + (eqs.length ? eqs.join('、') : '徒手') + '）</dd><dt>訓練</dt><dd>' + esc(LEVELS[p.level].label) + '・每週 ' + p.days + ' 天・' + esc(store.plan.split) + '</dd><dt>目標</dt><dd>' + fmt(T.kcal) + ' 大卡・蛋白質 ' + T.protein + ' g</dd></dl></section>' +
    '<section class="card"><h2>課表</h2><p class="muted small">動作不喜歡或器材被占用？在訓練中可以「換動作」。想整份重排就按下面的按鈕。</p><div class="row"><button class="btn" data-action="regenAsk">重新產生課表</button></div></section>' +
    '<section class="card"><h2>備份與還原</h2><p class="muted small">資料只存在這支手機的瀏覽器裡。換手機、清除瀏覽資料前請先備份。' + (lb ? '上次備份：' + dateLabel(lb) + '。' : '你還沒有備份過。') + '</p><div class="row"><button class="btn primary" data-action="backup">下載備份檔</button><label class="btn" tabindex="0">匯入備份<input type="file" id="importFile" accept="application/json,.json" hidden></label></div></section>' +
    '<section class="card"><h2>關於與授權</h2><p class="muted small">動作示範圖：Original exercise artwork by <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">Everkinetic</a>, expanded by <a href="https://bryllim.com" target="_blank" rel="noopener">Bryl Lim</a> (<a href="https://github.com/bryllim/workout-guide" target="_blank" rel="noopener">workout-guide</a>), licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>。本站已將圖片裁切、縮放，並把三個分鏡合併為一張 WebP 圖片，動作名稱、肌群、器材分類等資料也一併沿用同一授權標示。</p><p class="muted small">食物資料庫（' + fmt(FOODS.length) + ' 筆）沿用你原本熱量記錄器的資料，內容以超商與連鎖餐飲品項為主，營養素為估算值，實際請以包裝標示為準。</p><p class="muted small">訓練與營養的建議數字，主要依據 ACSM’s Resources for the Personal Trainer（第 6 版, 2022）的章節重點整理，並在畫面上標示章節；標示「一般做法」的是本站自訂的預設值。內容為一般健康成人的參考，不能取代醫師或營養師的建議。有心血管、代謝疾病、懷孕或運動時胸痛、頭暈、呼吸困難等狀況，請先諮詢醫師。</p></section>' +
    '<section class="card"><h2>危險區</h2><div class="row"><button class="btn danger" data-action="resetAsk">清除教練資料</button></div><p class="muted small">訓練、飲食、體重等所有紀錄都會一起清除。</p></section>';
}

function viewTab() {
  return ui.tab === 'today' ? viewToday() : ui.tab === 'train' ? viewTrain() : ui.tab === 'lib' ? viewLib() : ui.tab === 'diet' ? viewDiet() : viewMe();
}

/* ---------- 訓練中畫面 ---------- */
const WARM_IDS = ['worlds-greatest-stretch', 'cat-cow-stretch', 'leg-swings-stretch', 'arm-circles'];
const COOL_MAP = { sq: ['standing-quad-stretch', 'kneeling-hip-flexor-stretch'], lg: ['kneeling-hip-flexor-stretch', 'standing-quad-stretch'], hg: ['hamstring-stretch', 'seated-forward-fold-stretch'], gl: ['butterfly-stretch', 'kneeling-hip-flexor-stretch'], ph: ['doorway-chest-stretch'], pv: ['cross-body-shoulder-stretch'], ld: ['cross-body-shoulder-stretch'], lv: ['childs-pose'], lh: ['childs-pose'], rd: ['cross-body-shoulder-stretch'], ca: ['wall-calf-stretch'] };
function coolIds(slots) {
  const out = []; slots.forEach(s => (COOL_MAP[s.pat] || []).forEach(id => { if (!out.includes(id) && EXM[id]) out.push(id); }));
  return out.slice(0, 5);
}
function stretchRows(ids) { return '<ul class="strl">' + ids.map(id => '<li><button data-action="exDetail" data-id="' + esc(id) + '">' + frameThumb(EXM[id]) + '<span>' + esc(EXM[id].zh) + '</span></button></li>').join('') + '</ul>'; }
const setDots = (sl, pr) => { const n = Math.max(pr.sets, sl.sets.length); let h = ''; for (let i = 0; i < n; i++) h += '<i class="' + (sl.sets[i] && sl.sets[i].done ? 'on' : '') + '"></i>'; return '<span class="sdots" aria-label="已完成 ' + sl.sets.filter(s => s.done).length + ' / ' + n + ' 組">' + h + '</span>'; };
function restBar() {
  const a = store.active; if (!a || !a.restEnd || a.restEnd <= Date.now()) return '';
  return '<div class="rest" id="rest" role="timer"><span class="rl">休息</span><span class="rt" id="rest-t">' + mmss((a.restEnd - Date.now()) / 1000) + '</span><button class="btn small ghost-l" data-action="restAdj" data-s="-15">−15</button><button class="btn small ghost-l" data-action="restAdj" data-s="15">+15</button><button class="btn small primary" data-action="restSkip">略過</button></div>';
}
function viewSession() {
  const a = store.active, p = store.profile, F = RULES.flex;
  const doneSets = sum(a.slots, s => s.sets.filter(x => x.done).length);
  return '<div class="screen"><header class="bar"><button class="icon" data-action="sessionBack" aria-label="離開訓練畫面（進度會保留）">' + I.back + '</button><div class="grow"><h1>' + esc(a.name) + '</h1><p class="sub"><span id="elapsed">' + mmss((Date.now() - a.start) / 1000) + '</span>・' + esc(presetLabel(a.env === 'mine' ? p.preset : a.env)) + '・已完成 ' + doneSets + ' 組</p></div></header><main class="main">' +
    '<details class="card fold"><summary>暖身 ' + F.warmupMin[0] + '–' + F.warmupMin[1] + ' 分鐘</summary><p class="muted small">先用快走、腳踏車或划船機做 ' + F.warmupMin[0] + '–' + F.warmupMin[1] + ' 分鐘輕度到中度的活動，再做下面的動態動作，每個 ' + F.dynReps[0] + '–' + F.dynReps[1] + ' 次。<span class="src">依據 ' + F.src + '</span></p>' + stretchRows(WARM_IDS.filter(id => EXM[id])) + '</details>' +
    a.slots.map((sl, i) => { const e = EXM[sl.ex], pr = presc(e, p), all = sl.sets.length && sl.sets.every(x => x.done);
      return '<div class="slot' + (all ? ' done' : '') + '" data-action="openEx" data-i="' + i + '" role="button" tabindex="0">' + frameThumb(e) + '<span class="sinfo"><b>' + esc(e.zh) + '</b><small>' + esc(presText(pr)) + '・休息 ' + pr.rest + ' 秒</small>' + setDots(sl, pr) + '</span><button class="icon sm" data-action="swapEx" data-i="' + i + '" aria-label="換掉「' + esc(e.zh) + '」">' + I.swap + '</button></div>'; }).join('') +
    '<details class="card fold"><summary>收操與伸展</summary><p class="muted small">每個伸展停 ' + F.holdSec[0] + '–' + F.holdSec[1] + ' 秒、重複 ' + F.reps[0] + '–' + F.reps[1] + ' 次，累積約 ' + F.totalSec + ' 秒；伸到微緊就好，不要痛。<span class="src">依據 ' + F.src + '</span></p>' + stretchRows(coolIds(a.slots)) + '</details>' +
    '<button class="btn primary wide big" data-action="finishAsk">完成訓練</button><button class="btn link wide" data-action="abandonAsk">放棄這次訓練</button></main>' + restBar() + '</div>';
}
const inputStep = (ex, f) => f === 'w' ? (ex.eq.includes('db') ? 1 : 2.5) : f === 't' ? 5 : 1;
function stepper(ex, f, val, i, unit, label) {
  return '<div class="step"><button data-action="dec" data-f="' + f + '" data-i="' + i + '" aria-label="' + label + ' 減少">−</button><input inputmode="decimal" data-f="' + f + '" data-i="' + i + '" value="' + (val == null ? '' : val) + '" placeholder="' + (f === 'w' ? '重量' : f === 't' ? '秒' : '次數') + '" aria-label="' + label + '（' + unit + '）"><button data-action="inc" data-f="' + f + '" data-i="' + i + '" aria-label="' + label + ' 增加">+</button><span class="u">' + unit + '</span></div>';
}
function viewExercise() {
  const a = store.active, p = store.profile, sl = a.slots[ui.exIdx], ex = EXM[sl.ex], pr = presc(ex, p), sg = suggest(ex, pr, p, a.id), ls = lastSession(ex.id, a.id), n = a.slots.length;
  const showW = ex.type === 'weight_reps' || ex.type === 'assisted_bodyweight';
  const lastTxt = ls ? dateLabel(ls.date) + '：' + ls.sets.map(s => ex.type === 'duration' ? s.t + ' 秒' : (s.w > 0 ? fmt1(s.w) + '×' + s.r : s.r + ' 下')).join('、') : '這個動作還沒有紀錄';
  const rows = sl.sets.map((s, i) => '<div class="setrow' + (s.done ? ' done' : '') + '"><span class="idx">' + (i + 1) + '</span>' + (showW ? stepper(ex, 'w', s.w, i, ex.type === 'assisted_bodyweight' ? '輔助kg' : 'kg', '第 ' + (i + 1) + ' 組重量') : '') + (ex.type === 'duration' ? stepper(ex, 't', s.t, i, '秒', '第 ' + (i + 1) + ' 組秒數') : stepper(ex, 'r', s.r, i, '下', '第 ' + (i + 1) + ' 組次數')) + '<button class="tick" data-action="toggleSet" data-i="' + i + '" aria-pressed="' + !!s.done + '" aria-label="' + (s.done ? '取消' : '完成') + '第 ' + (i + 1) + ' 組">' + I.check + '</button></div>').join('');
  const cuesCard = '<section class="card"><h2>做法要點</h2><ul class="cues">' + ex.cues.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul><details><summary>這類動作的通用提醒</summary><p>' + esc(DATA.patterns[ex.pat].cue) + '</p></details></section>';
  const sugCard = '<section class="card sug ' + sg.kind + '"><h2>這次建議</h2><p>' + esc(sg.text) + '</p><p class="muted small">上次：' + esc(lastTxt) + '</p>' + (sg.kind === 'first' ? '' : '<p class="src gen">一般做法（雙重漸進）</p>') + '</section>';
  const recCard = '<section class="card"><h2>記錄</h2>' + (showW && ex.eq.includes('db') ? '<p class="muted small">啞鈴請填單手重量。</p>' : '') + '<div class="sets' + (showW ? '' : ' one') + '"><div class="setrow shead"><span></span>' + (showW ? '<span>' + (ex.type === 'assisted_bodyweight' ? '輔助 kg' : '重量 kg') + '</span>' : '') + '<span>' + (ex.type === 'duration' ? '秒數' : '次數') + '</span><span></span></div>' + rows + '</div><div class="row"><button class="btn small" data-action="addSet">+ 加一組</button>' + (sl.sets.length > 1 ? '<button class="btn small ghost" data-action="delSet">刪除最後一組</button>' : '') + '</div></section>';
  return '<div class="screen"><header class="bar"><button class="icon" data-action="exBack" aria-label="回到動作清單">' + I.back + '</button><div class="grow"><h1>' + esc(ex.zh) + '</h1><p class="sub">第 ' + (ui.exIdx + 1) + ' / ' + n + ' 個・' + esc(presText(pr)) + '・休息 ' + pr.rest + ' 秒</p></div></header><main class="main"><div class="board compact">' + board(ex).replace('<div class="board"', '<div class="boardin"').replace(/^<div class="boardin"/, '<div class="boardin"') + '</div>' + sugCard + recCard + '<div class="chips">' + chipEl(ex.main, 'on') + ex.sec.slice(0, 2).map(x => chipEl(x)).join('') + chipEl(ex.eq.length ? ex.eq.map(q => EQ_LABEL[q]).join('＋') : '徒手') + '</div>' + cuesCard +
    '<div class="row navrow">' + (ui.exIdx > 0 ? '<button class="btn" data-action="exNav" data-d="-1">‹ 上一個</button>' : '') + (ui.exIdx < n - 1 ? '<button class="btn primary" data-action="exNav" data-d="1">下一個 ›</button>' : '<button class="btn primary" data-action="exBack">回動作清單</button>') + '</div></main>' + restBar() + '</div>';
}
function ensureSets(sl) {
  if (sl.sets.length) return;
  const ex = EXM[sl.ex], pr = presc(ex), sg = suggest(ex, pr, store.profile, store.active && store.active.id);
  const ls = lastSession(ex.id, store.active && store.active.id), lw = ls ? Math.max(...ls.sets.map(s => s.w || 0)) : null;
  for (let i = 0; i < pr.sets; i++) {
    const s = { w: null, r: null, t: null, done: false };
    if (ex.type === 'duration') s.t = sg.r; else s.r = sg.r;
    if (ex.type === 'weight_reps' || ex.type === 'assisted_bodyweight') s.w = sg.w != null ? sg.w : (ls ? lw : null);
    sl.sets.push(s);
  }
}

/* ---------- 面板（sheet） ---------- */
function sheetStartPick(i) {
  const p = store.profile, s = store.plan.sessions[i], keys = ['mine'].concat(Object.keys(PRESETS).filter(k => k !== p.preset));
  const opt = k => { const pf = envProfile(p, k), slots = k === 'mine' ? s.slots : resolveSlots(s.pats, pf, {}); return '<button class="opt" data-action="startWith" data-i="' + i + '" data-env="' + k + '"><b>' + (k === 'mine' ? '照我的設定' : esc(PRESETS[k].label)) + '</b><small>' + (k === 'mine' ? esc(presetLabel(p.preset)) + '・' : '') + slots.map(x => EXM[x.ex].zh).slice(0, 4).join('、') + (slots.length > 4 ? '…' : '') + '</small></button>'; };
  openSheet('<div class="sbody"><h2>' + esc(s.name) + '：今天在哪裡練？</h2><p class="muted small">臨時換場景不會改動你的課表，只是把這次的動作換成該場景做得到的版本。</p>' + keys.map(opt).join('') + '<button class="btn wide ghost" data-action="closeSheet">取消</button></div>');
}
function sheetCardio() {
  const p = store.profile, list = CARDIO.filter(c => c.eq.every(q => p.equip[q]));
  ui.cardio = { type: list[0] ? list[0].id : 'walking', int: 'mod' };
  openSheet('<div class="sbody"><h2>記錄有氧</h2><div class="chips" id="cTypes">' + list.map(c => '<button class="chip btnchip' + (c.id === ui.cardio.type ? ' on' : '') + '" data-action="cType" data-t="' + c.id + '">' + esc(c.zh) + '</button>').join('') + '</div><label class="fld"><span>時間（分鐘）</span><input class="in" id="cMin" inputmode="numeric" value="30" data-autofocus></label><div class="fld"><span>強度</span><div class="opts"><button class="opt on" data-action="cInt" data-v="mod"><b>中強度</b><small>能說話，但唱不了歌</small></button><button class="opt" data-action="cInt" data-v="vig"><b>高強度</b><small>只能說幾個字，1 分鐘算 2 分鐘</small></button></div></div><p class="err" id="cErr"></p><div class="row"><button class="btn primary" data-action="cSave">儲存</button><button class="btn ghost" data-action="closeSheet">取消</button></div></div>');
}
function sheetFinish() {
  const a = store.active, n = sum(a.slots, s => s.sets.filter(x => x.done).length), left = sum(a.slots, s => s.sets.filter(x => !x.done).length);
  openSheet('<div class="sbody"><h2>' + (n ? '結束這次訓練？' : '還沒有完成任何一組') + '</h2><p class="muted">' + (n ? '已完成 ' + n + ' 組' + (left ? '，還有 ' + left + ' 組沒勾選，這些不會被記錄' : '') + '。' : '沒有完成的組數就不會留下紀錄。') + '</p><div class="row">' + (n ? '<button class="btn primary" data-action="finishDo">結束並儲存</button>' : '') + '<button class="btn ghost" data-action="closeSheet">繼續練</button>' + (n ? '' : '<button class="btn danger" data-action="abandonDo">直接離開</button>') + '</div></div>');
}
function sheetSummary(w) {
  const min = Math.max(1, Math.round((w.end - w.start) / 60000)), sets = sum(w.entries, e => e.sets.length);
  openSheet('<div class="sbody"><h2>練完了！</h2><p class="muted">' + esc(w.name) + '</p><div class="kv2"><div><small>時間</small><b>' + min + ' 分</b></div><div><small>組數</small><b>' + sets + '</b></div><div><small>總量</small><b>' + fmt(volumeOf(w)) + ' kg</b></div></div>' +
    (w.prs.length ? '<h3>個人紀錄</h3><ul class="prs">' + w.prs.map(r => { const e = EXM[r.ex]; return '<li><b>' + esc(e.zh) + '</b>' + (e.type === 'duration' ? r.t + ' 秒' : r.w > 0 ? fmt1(r.w) + ' kg × ' + r.r : r.r + ' 下') + '</li>'; }).join('') + '</ul>' : '') +
    '<p class="tip">' + esc('現在補充：約 ' + hydration(store.profile).postProtein + ' g 蛋白質，並補水。') + ' <span class="src">依據 ' + RULES.protein.src + '</span></p><button class="btn primary wide" data-action="summaryDone">完成</button></div>');
}
function sheetWorkout(id) {
  const w = store.workouts.find(x => x.id === id); if (!w) return;
  openSheet('<div class="sbody"><h2>' + esc(w.name) + '</h2><p class="muted">' + dateLabel(w.date) + '・' + Math.max(1, Math.round((w.end - w.start) / 60000)) + ' 分・' + esc(presetLabel(w.env)) + '</p>' + w.entries.map(e => { const x = EXM[e.ex] || { zh: e.ex, type: 'weight_reps' }; return '<div class="line"><span><b>' + esc(x.zh) + '</b></span><span>' + e.sets.map(s => x.type === 'duration' ? s.t + '秒' : (s.w > 0 ? fmt1(s.w) + '×' + s.r : s.r + '下')).join('　') + '</span></div>'; }).join('') +
    (w.prs && w.prs.length ? '<p class="tip">破紀錄：' + w.prs.map(r => esc((EXM[r.ex] || { zh: r.ex }).zh)).join('、') + '</p>' : '') + '<div class="row"><button class="btn danger" data-action="wdelAsk" data-id="' + esc(w.id) + '">刪除這次紀錄</button><button class="btn" data-action="closeSheet">關閉</button></div></div>');
}
function sheetSwap(i) {
  const a = store.active, sl = a.slots[i];
  if (sl.sets.some(s => s.done)) { toast('這個動作已經有完成的組數，不能換'); return; }
  const prof = envProfile(store.profile, a.env), used = new Set(a.slots.map(s => s.ex)), out = [];
  for (const pat of [sl.pat].concat(FALLBACK[sl.pat] || [])) cands(pat, prof, used).forEach(e => { if (!out.includes(e)) out.push(e); });
  const always = a.env === 'mine' && store.plan.sessions[a.sessionIdx] && store.plan.sessions[a.sessionIdx].slots[i];
  openSheet('<div class="sbody"><h2>換掉「' + esc(EXM[sl.ex].zh) + '」</h2><p class="muted small">以下是同類、你的器材做得到的動作。</p>' + (out.length ? out.slice(0, 12).map(e => '<div class="alt">' + frameThumb(e) + '<span><b>' + esc(e.zh) + '</b><small>' + esc(presText(presc(e))) + '</small></span><span class="altb"><button class="btn small" data-action="swapDo" data-i="' + i + '" data-id="' + esc(e.id) + '" data-scope="today">只換今天</button>' + (always ? '<button class="btn small" data-action="swapDo" data-i="' + i + '" data-id="' + esc(e.id) + '" data-scope="always">以後都換</button>' : '') + '</span></div>').join('') : '<p class="muted">沒有其他可換的動作。</p>') + '<button class="btn wide ghost" data-action="closeSheet">取消</button></div>', 'tall');
}
function sheetReview() {
  const R = weeklyReview(), m = R.m, p = store.profile;
  ui.reviewItems = R.items;
  const cell = (l, v, s) => '<div><small>' + l + '</small><b>' + v + '</b>' + (s ? '<i>' + s + '</i>' : '') + '</div>';
  openSheet('<div class="sbody"><h2>上週回顧</h2><p class="muted small">' + dateLabel(R.from) + ' – ' + dateLabel(R.to) + '</p><div class="rgrid">' +
    cell('飲食紀錄', m.logged + '<small> / 7 天</small>', m.kcalAvg != null ? '平均 ' + fmt(m.kcalAvg) + ' 大卡' : '') +
    cell('蛋白質達標', m.pCovered ? m.pDays + '<small> / ' + m.pCovered + ' 天</small>' : '—', '目標 ' + R.T.protein + ' g') +
    cell('體重變化', m.rate != null ? (m.rate >= 0 ? '+' : '') + fmt1(m.rate) + '<small> kg/週</small>' : '—', m.wNow ? '平均 ' + fmt1(m.wNow.avg) + ' kg' : '') +
    cell('重量訓練', m.sessions + '<small> / ' + m.planned + ' 次</small>', m.sets + ' 組' + (m.prs ? '・破 ' + m.prs + ' 項紀錄' : '')) +
    cell('有氧', Math.round(m.cardioMin) + '<small> / 150 分</small>', '') +
    cell('喝水', m.waterAvg != null ? fmt(m.waterAvg) + '<small> mL</small>' : '—', '目標 ' + fmt(waterGoal(p))) + '</div>' +
    R.items.map((it, k) => { const applied = it.action && it.action.type === 'kcal' && store.applied.some(x => x.date === today() && x.kcal === it.action.delta);
      return '<div class="ritem ' + it.tone + '"><h3>' + esc(it.title) + '</h3><p>' + esc(it.text) + '</p>' + basisTag(it) + (it.action ? (applied ? '<p class="muted small">今天已套用這項調整。</p>' : '<div class="row"><button class="btn small primary" data-action="applyReview" data-k="' + k + '">' + esc(it.action.label) + '</button></div>') : '') + '</div>'; }).join('') +
    '<p class="note">這些是依你的紀錄自動整理的建議，不是醫療診斷。單週資料有雜訊，建議至少觀察兩週再調整；想調整幅度都在每天 100 大卡的小步上。</p><button class="btn wide" data-action="closeSheet">關閉</button></div>', 'tall');
}
function sheetConfirm(title, text, action, label, danger) {
  openSheet('<div class="sbody"><h2>' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p><div class="row"><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-action="' + action + '">' + esc(label) + '</button><button class="btn ghost" data-action="closeSheet">取消</button></div></div>');
}

/* ---------- 首次設定 ---------- */
function initOnb() {
  const p = store.profile;
  const d = p ? Object.assign({}, p, { equip: Object.assign({}, p.equip) })
    : { name: '', sex: null, age: '', height: '', weight: '', phase: null, pace: null, activity: 'mid', preset: null, equip: {}, level: null, days: 3, splitStyle: stylesFor(3)[0].id, bwBase: 1 };
  return { step: 1, d, edit: !!p };
}
function profFromOnb(d) {
  return { name: String(d.name || '').trim().slice(0, 12), sex: d.sex, age: +d.age, height: +d.height, weight: +d.weight, phase: d.phase, pace: d.pace, activity: d.activity, preset: d.preset, equip: EQ_KEYS.reduce((o, k) => (o[k] = d.equip[k] ? 1 : 0, o), {}), level: +d.level, days: +d.days, splitStyle: (stylesFor(+d.days).find(s => s.id === d.splitStyle) || stylesFor(+d.days)[0]).id, bwBase: d.bwBase == null ? 1 : +d.bwBase, createdAt: (store.profile && store.profile.createdAt) || today() };
}
function viewOnb() {
  const o = ui.onb, d = o.d, s = o.step;
  const dots = '<div class="dots5" role="img" aria-label="步驟 ' + s + ' / 5">' + [1, 2, 3, 4, 5].map(i => '<i class="' + (i <= s ? 'on' : '') + '"></i>').join('') + '</div>';
  const ch = (k, v, t, on) => '<button class="chip btnchip' + (on ? ' on' : '') + '" data-action="ob" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + !!on + '">' + t + '</button>';
  let body = '';
  if (s === 1) body = '<h2>先認識你</h2><p class="muted">用來估算每天需要的熱量與蛋白質。</p><label class="fld"><span>稱呼（選填）</span><input class="in" data-ob="name" maxlength="12" value="' + esc(d.name) + '"></label><div class="fld"><span>性別（用於估算代謝）</span><div class="chips">' + ch('sex', 'f', '女', d.sex === 'f') + ch('sex', 'm', '男', d.sex === 'm') + '</div></div><div class="grid3"><label class="fld"><span>年齡</span><input class="in" inputmode="numeric" data-ob="age" value="' + esc(d.age) + '"></label><label class="fld"><span>身高 cm</span><input class="in" inputmode="decimal" data-ob="height" value="' + esc(d.height) + '"></label><label class="fld"><span>體重 kg</span><input class="in" inputmode="decimal" data-ob="weight" value="' + esc(d.weight) + '"></label></div>';
  if (s === 2) {
    body = '<h2>你現在的階段</h2><div class="opts">' + Object.keys(RULES.phases).map(k => '<button class="opt' + (d.phase === k ? ' on' : '') + '" data-action="ob" data-k="phase" data-v="' + k + '" aria-pressed="' + (d.phase === k) + '"><b>' + esc(RULES.phases[k].label) + '</b><small>' + esc(RULES.phases[k].desc) + '</small></button>').join('') + '</div>';
    if (d.phase && RULES.phases[d.phase].paces.length > 1) body += '<div class="fld"><span>' + (d.phase === 'cut' ? '減脂速度' : '增肌速度') + '</span><div class="chips">' + RULES.phases[d.phase].paces.map(x => ch('pace', x.id, x.label + '（' + (x.pct > 0 ? '+' : '') + x.pct + '%）', d.pace === x.id)).join('') + '</div><p class="muted small">' + (d.phase === 'cut' ? '越積極越容易流失肌肉、也越難堅持。不確定就選「標準」。' : '不確定就選「精實」，看體重趨勢再調整。') + '</p></div>';
    body += '<div class="fld"><span>整體活動量（含日常與運動）</span><div class="opts">' + RULES.activity.map(a => '<button class="opt slim' + (d.activity === a.id ? ' on' : '') + '" data-action="ob" data-k="activity" data-v="' + a.id + '" aria-pressed="' + (d.activity === a.id) + '"><b>' + a.label + '</b><small>' + esc(a.hint) + '</small></button>').join('') + '</div></div>';
  }
  if (s === 3) body = '<h2>你在哪裡練</h2><p class="muted">選最常用的場景。之後可以在每次訓練時臨時換場景，例如出差在家練。</p><div class="opts">' + Object.keys(PRESETS).map(k => '<button class="opt' + (d.preset === k ? ' on' : '') + '" data-action="ob" data-k="preset" data-v="' + k + '" aria-pressed="' + (d.preset === k) + '"><b>' + PRESETS[k].label + '</b><small>' + PRESETS[k].sub + '</small></button>').join('') + '</div>' + (d.preset ? '<div class="fld"><span>你有的器材（可微調）</span><div class="chips">' + EQ_KEYS.map(k => '<button class="chip btnchip' + (d.equip[k] ? ' on' : '') + '" data-action="obEq" data-k="' + k + '" aria-pressed="' + !!d.equip[k] + '">' + EQ_LABEL[k] + '</button>').join('') + '</div><p class="muted small">長凳與單槓會解鎖更多動作，例如啞鈴臥推與引體向上。</p></div>' : '');
  if (s === 4) {
    const showBw = !(d.equip.db || d.equip.machine || d.equip.barbell || d.equip.cable);
    const styles = stylesFor(+d.days);
    body = '<h2>訓練經驗與頻率</h2><div class="opts">' + [1, 2, 3].map(k => '<button class="opt slim' + (+d.level === k ? ' on' : '') + '" data-action="ob" data-k="level" data-v="' + k + '" aria-pressed="' + (+d.level === k) + '"><b>' + LEVELS[k].label + '</b><small>' + LEVELS[k].sub + '</small></button>').join('') + '</div><div class="fld"><span>每週訓練天數</span><div class="chips">' + [2, 3, 4, 5, 6].map(k => ch('days', k, k + ' 天', +d.days === k)).join('') + '</div><p class="muted small">' + (+d.level === 1 && +d.days > 3 ? 'ACSM 對新手與健康導向的建議是每週 2–3 天全身訓練。可以先從 3 天開始，穩定後再增加。' : '選你「一定做得到」的天數，比理想天數更重要。') + '</p></div>' +
      (styles.length > 1 ? '<div class="fld"><span>訓練怎麼分配（' + d.days + ' 天可以這樣排）</span><div class="opts">' + styles.map(st => '<button class="opt' + (d.splitStyle === st.id ? ' on' : '') + '" data-action="ob" data-k="splitStyle" data-v="' + st.id + '" aria-pressed="' + (d.splitStyle === st.id) + '"><b>' + esc(st.label) + '</b><small>' + esc(st.sub) + '</small></button>').join('') + '</div></div>' : '') +
      (showBw ? '<div class="fld"><span>徒手的推力基礎</span><div class="opts">' + [0, 1, 2].map(k => '<button class="opt slim' + (+d.bwBase === k ? ' on' : '') + '" data-action="ob" data-k="bwBase" data-v="' + k + '" aria-pressed="' + (+d.bwBase === k) + '"><b>' + BW_BASE[k] + '</b></button>').join('') + '</div></div>' : '');
  }
  if (s === 5) {
    const prof = profFromOnb(d), T = targets(prof, o.edit ? store.adjust.kcal || 0 : 0), plan = generatePlan(prof);
    body = '<h2>確認你的計畫</h2><section class="card"><div class="cardhead"><h2>每日目標</h2>' + chipEl(PHASE_LABEL(prof), 'phase') + '</div><div class="bigkcal"><b>' + fmt(T.kcal) + '</b><span>大卡</span></div><div class="macros"><div><b>' + T.protein + '<small>g</small></b><span>蛋白質</span></div><div><b>' + T.carb + '<small>g</small></b><span>碳水</span></div><div><b>' + T.fat + '<small>g</small></b><span>脂肪</span></div></div>' + (T.capped ? '<p class="warn">已套用安全下限 ' + fmt(T.floor) + ' 大卡，建議放慢速度。</p>' : '') + '</section><section class="card"><h2>' + esc(plan.split) + '</h2>' + plan.sessions.map(x => '<p class="pv"><b>' + esc(x.name) + '</b>　' + x.slots.map(y => esc(EXM[y.ex].zh)).join('、') + '</p>').join('') + '</section><p class="note">這是給一般健康成人的參考。若你有心血管或代謝疾病、懷孕，或運動時出現胸痛、頭暈、喘不過氣，請先諮詢醫師。訓練中不舒服就停下來。</p>';
  }
  return '<div class="onb"><div class="onbtop"><h1>' + (o.edit ? '修改設定' : '歡迎來到健身教練') + '</h1>' + dots + '</div>' + body + '<p class="err" id="obErr" role="alert"></p><div class="row onbnav">' + (s > 1 ? '<button class="btn" data-action="obBack">上一步</button>' : (o.edit ? '<button class="btn ghost" data-action="obCancel">取消</button>' : '')) + '<button class="btn primary" data-action="obNext">' + (s === 5 ? (o.edit ? '儲存設定' : '開始使用') : '下一步') + '</button></div></div>';
}
function obValidate(o) {
  const d = o.d, s = o.step;
  if (s === 1) {
    if (!d.sex) return '請選擇性別';
    const a = +d.age, h = +d.height, w = +d.weight;
    if (!(a >= 14 && a <= 80)) return '年齡請填 14–80 歲';
    if (!(h >= 120 && h <= 220)) return '身高請填 120–220 cm';
    if (!(w >= 30 && w <= 250)) return '體重請填 30–250 kg';
  }
  if (s === 2) { if (!d.phase) return '請選擇一個階段'; if (!d.pace) return '請選擇速度'; if (!d.activity) return '請選擇活動量'; }
  if (s === 3) { if (!d.preset) return '請選擇你在哪裡練'; }
  if (s === 4) { if (!d.level) return '請選擇訓練經驗'; if (!(+d.days >= 2 && +d.days <= 6)) return '請選擇每週天數'; if (!stylesFor(+d.days).find(x => x.id === d.splitStyle)) return '請選擇訓練怎麼分配'; }
  return '';
}

/* ---------- 渲染 ---------- */
function render(keepScroll = true) {
  const app = $('#app'), y = window.scrollY;
  if (!store.profile || ui.onb) { app.innerHTML = viewOnb(); }
  else if (ui.screen === 'exercise' && store.active) app.innerHTML = viewExercise();
  else if (ui.screen === 'session' && store.active) app.innerHTML = viewSession();
  else { ui.screen = null; app.innerHTML = viewHeader() + '<main class="main" id="main">' + viewTab() + '</main>' + viewNav(); }
  document.body.classList.toggle('inscreen', !!ui.screen);
  if (keepScroll) window.scrollTo(0, y);
}
function go(fn) { fn(); render(false); window.scrollTo(0, 0); }

/* ---------- 事件 ---------- */
const H = {
  tab: t => go(() => { ui.tab = t.dataset.tab; if (t.dataset.seg) ui.seg = t.dataset.seg; }),
  seg: t => go(() => { ui.seg = t.dataset.seg; if (t.dataset.tab) ui.tab = t.dataset.tab; else ui.tab = 'train'; }),
  moreHist: () => { ui.histN += 15; render(); },
  water: t => { const d = today(); store.water[d] = Math.max(0, (store.water[d] || 0) + (+t.dataset.ml)); save(); render(); },
  saveWeight: () => { const v = num($('#wIn').value); if (!(v >= 30 && v <= 250)) { toast('請輸入 30–250 之間的體重'); return; } const d = today(), b = store.body.find(x => x.date === d); if (b) b.weight = v; else store.body.push({ date: d, weight: v }); save(); toast('已記錄體重 ' + fmt1(v) + ' kg'); render(); },
  libGroup: t => { ui.libGroup = t.dataset.g; render(); },
  exDetail: t => sheetExercise(t.dataset.id),
  closeSheet: closeSheet,
  review: () => sheetReview(),
  applyReview: t => { const it = ui.reviewItems[+t.dataset.k]; if (!it || !it.action) return; applyAction(it.action); toast('已套用：' + it.action.label); closeSheet(); render(); setTimeout(sheetReview, 0); },
  startPick: t => { if (store.active) { sheetConfirm('已有進行中的訓練', '「' + store.active.name + '」還沒完成。要放棄它並開始新的訓練嗎？', 'startForce', '放棄並開始新的', true); ui.pendingStart = +t.dataset.i; return; } sheetStartPick(+t.dataset.i); },
  startForce: () => { store.active = null; save(); closeSheet(); sheetStartPick(ui.pendingStart); },
  startWith: t => { startWorkout(+t.dataset.i, t.dataset.env); closeSheet(); go(() => { ui.screen = 'session'; }); },
  resume: () => go(() => { ui.screen = 'session'; }),
  sessionBack: () => go(() => { ui.screen = null; ui.tab = 'today'; }),
  openEx: t => { const sl = store.active.slots[+t.dataset.i]; ensureSets(sl); save(); go(() => { ui.exIdx = +t.dataset.i; ui.screen = 'exercise'; }); },
  exBack: () => go(() => { ui.screen = 'session'; }),
  exNav: t => { const i = clamp(ui.exIdx + (+t.dataset.d), 0, store.active.slots.length - 1); ensureSets(store.active.slots[i]); save(); go(() => { ui.exIdx = i; }); },
  inc: t => stepVal(t, 1), dec: t => stepVal(t, -1),
  toggleSet: t => {
    const a = store.active, sl = a.slots[ui.exIdx], ex = EXM[sl.ex], s = sl.sets[+t.dataset.i], pr = presc(ex);
    if (!s.done) {
      const isW = ex.type === 'weight_reps' || ex.type === 'assisted_bodyweight';
      if (ex.type === 'duration' ? !(s.t > 0) : !(s.r > 0)) { toast(ex.type === 'duration' ? '先填秒數' : '先填次數'); return; }
      if (isW && s.w == null) { toast('先填重量（徒手就填 0）'); return; }
      s.done = true; s.ts = Date.now();
      const isLast = sl.sets.every(x => x.done);
      a.restEnd = Date.now() + pr.rest * 1000;
      if (navigator.vibrate) try { navigator.vibrate(25); } catch (e) { }
      if (isLast && ui.exIdx < a.slots.length - 1) toast('這個動作做完了，休息後換下一個');
    } else { s.done = false; s.ts = null; a.restEnd = null; }
    save(); render();
  },
  addSet: () => { const sl = store.active.slots[ui.exIdx], last = sl.sets[sl.sets.length - 1] || { w: null, r: null, t: null }; sl.sets.push({ w: last.w, r: last.r, t: last.t, done: false }); save(); render(); },
  delSet: () => { const sl = store.active.slots[ui.exIdx]; if (sl.sets.length > 1) { sl.sets.pop(); save(); render(); } },
  restAdj: t => { const a = store.active; if (a && a.restEnd) { a.restEnd = Math.max(Date.now() + 1000, a.restEnd + (+t.dataset.s) * 1000); save(); updateRest(); } },
  restSkip: () => { store.active.restEnd = null; save(); render(); },
  swapEx: (t, e) => { e.stopPropagation(); sheetSwap(+t.dataset.i); },
  swapDo: t => {
    const a = store.active, i = +t.dataset.i, sl = a.slots[i], id = t.dataset.id; if (!EXM[id]) return;
    a.slots[i] = { ex: id, pat: sl.pat, sets: [] };
    if (t.dataset.scope === 'always' && a.env === 'mine' && store.plan.sessions[a.sessionIdx]) store.plan.sessions[a.sessionIdx].slots[i].ex = id;
    save(); closeSheet(); toast('已換成「' + EXM[id].zh + '」'); render();
  },
  finishAsk: () => sheetFinish(),
  finishDo: () => { const w = finishWorkout(); closeSheet(); ui.screen = null; ui.tab = 'today'; render(false); if (w) sheetSummary(w); },
  summaryDone: () => { closeSheet(); render(false); window.scrollTo(0, 0); },
  abandonAsk: () => sheetConfirm('放棄這次訓練？', '這次的進度不會被記錄。', 'abandonDo', '放棄', true),
  abandonDo: () => { store.active = null; save(); closeSheet(); ui.screen = null; ui.tab = 'today'; render(false); },
  wdetail: t => sheetWorkout(t.dataset.id),
  wdelAsk: t => { ui.delId = t.dataset.id; sheetConfirm('刪除這次訓練紀錄？', '刪除後無法復原，個人紀錄也會重新計算。', 'wdelDo', '刪除', true); },
  wdelDo: () => { store.workouts = store.workouts.filter(w => w.id !== ui.delId); save(); closeSheet(); render(); toast('已刪除'); },
  cardioAdd: () => sheetCardio(),
  dietAdd: () => sheetFoodAdd(),
  foodCat: t => { ui.food.cat = t.dataset.c; $$('#foodcats .chip').forEach(c => c.classList.toggle('on', c === t)); $('#foodlist').innerHTML = foodResults(ui.food.q, ui.food.cat).map(foodRow).join(''); },
  foodPick: t => { const f = FOODM[t.dataset.id] || store.customFoods.find(x => x.id === t.dataset.id); if (!f) return; addFoodEntry(today(), f, 1); toast('已加入「' + f.name + '」'); render(); },
  dQty: t => { const d = dietDay(today()), e = d && d.entries.find(x => x.id === t.dataset.id); if (e) setQty(today(), e.id, e.qty + (+t.dataset.d)); render(); },
  dDel: t => { delEntry(today(), t.dataset.id); render(); },
  customToggle: () => { const f = $('#customForm'); if (!f) return; f.hidden = !f.hidden; if (!f.hidden) f.innerHTML = customFormHtml(); },
  customSave: () => {
    const name = $('#cfName').value.trim(), kcal = num($('#cfKcal').value);
    if (!name) { $('#cfErr').textContent = '請輸入名稱'; return; }
    if (!(kcal >= 0 && kcal <= 5000)) { $('#cfErr').textContent = '請輸入合理的熱量（0–5000 大卡）'; return; }
    const pv = num($('#cfP').value), fv = num($('#cfF').value), cv = num($('#cfC').value);
    const f = { id: 'c' + uid(), name, emoji: '🍽️', category: '自訂', brand: '', serving: '1份', kcal, protein: pv, fat: fv, carb: cv };
    if ($('#cfSave').checked) store.customFoods.unshift(f);
    addFoodEntry(today(), f, 1); save(); toast('已加入「' + name + '」'); closeSheet(); render();
  },
  cType: t => { ui.cardio.type = t.dataset.t; $$('#cTypes .chip').forEach(c => c.classList.toggle('on', c.dataset.t === ui.cardio.type)); },
  cInt: t => { ui.cardio.int = t.dataset.v; $$('.sheet .opt[data-action=cInt]').forEach(c => c.classList.toggle('on', c.dataset.v === ui.cardio.int)); },
  cSave: () => { const m = num($('#cMin').value); if (!(m >= 1 && m <= 600)) { $('#cErr').textContent = '時間請填 1–600 分鐘'; return; } store.cardio.push({ id: uid(), date: today(), type: ui.cardio.type, min: Math.round(m), int: ui.cardio.int }); save(); closeSheet(); toast('已記錄有氧 ' + Math.round(m) + ' 分鐘'); render(); },
  cardioDel: t => { store.cardio = store.cardio.filter(c => c.id !== t.dataset.id); save(); render(); },
  editProfile: () => go(() => { ui.onb = initOnb(); }),
  regenAsk: () => sheetConfirm('重新產生課表？', '會依你現在的設定重新排課表，並把「換動作」的修改重設。訓練紀錄不受影響。', 'regenDo', '重新產生', false),
  regenDo: () => { store.plan = generatePlan(store.profile); if (store.active && !store.active.slots.some(s => s.sets.some(x => x.done))) { /* 進行中的訓練保留 */ } save(); closeSheet(); render(); toast('課表已更新'); },
  backup: () => {
    const data = JSON.stringify(Object.assign({}, store, { active: null, exportedAt: new Date().toISOString() }));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = 'fit-coach-' + today() + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    store.lastBackup = today(); save(); toast('已下載備份檔'); render();
  },
  importDo: () => { store = ui.pendingImport; ui.pendingImport = null; store.active = null; if (!store.plan && store.profile) store.plan = generatePlan(store.profile); save(); closeSheet(); render(false); toast('已還原備份'); },
  resetAsk: () => sheetConfirm('清除教練資料？', '訓練紀錄、體重、喝水、課表與設定都會刪除，無法復原。建議先下載備份。', 'resetDo', '全部清除', true),
  resetDo: () => { localStorage.removeItem(KEY); store = defaultStore(); ui.onb = initOnb(); ui.tab = 'today'; ui.screen = null; closeSheet(); render(false); },
  ob: t => { const o = ui.onb, k = t.dataset.k, raw = t.dataset.v, v = /^\d+$/.test(raw) ? +raw : raw; o.d[k] = v; if (k === 'phase') o.d.pace = RULES.phases[v].defaultPace; if (k === 'preset') o.d.equip = Object.assign({}, PRESETS[v].equip); if (k === 'days') { const styles = stylesFor(v); if (!styles.find(s => s.id === o.d.splitStyle)) o.d.splitStyle = styles[0].id; } render(); },
  obEq: t => { const o = ui.onb; o.d.equip[t.dataset.k] = o.d.equip[t.dataset.k] ? 0 : 1; render(); },
  obBack: () => go(() => { ui.onb.step--; }),
  obCancel: () => go(() => { ui.onb = null; }),
  obNext: () => {
    const o = ui.onb, err = obValidate(o);
    if (err) { $('#obErr').textContent = err; return; }
    if (o.step < 5) { go(() => { o.step++; }); return; }
    const prof = profFromOnb(o.d), old = store.profile;
    const regen = !old || !store.plan || ['preset', 'level', 'days', 'splitStyle', 'bwBase'].some(k => old[k] !== prof[k]) || EQ_KEYS.some(k => old.equip[k] !== prof.equip[k]);
    store.profile = prof; if (regen) store.plan = generatePlan(prof);
    if (!old) store.adjust = { kcal: 0 };
    save(); const edit = o.edit; ui.onb = null; ui.tab = edit ? 'me' : 'today'; render(false); window.scrollTo(0, 0); toast(edit ? '設定已儲存' + (regen ? '，課表已重新產生' : '') : '設定完成，開始第一次訓練吧');
  }
};
function stepVal(t, dir) {
  const a = store.active, sl = a.slots[ui.exIdx], ex = EXM[sl.ex], i = +t.dataset.i, f = t.dataset.f, s = sl.sets[i];
  const cur = s[f] == null ? (f === 'w' ? (sl.sets[i - 1] && sl.sets[i - 1].w != null ? sl.sets[i - 1].w : 0) : presc(ex)[f === 't' ? 'lo' : 'lo']) : s[f];
  const nv = Math.max(0, round(cur + dir * inputStep(ex, f), 1));
  setField(sl, i, f, nv); save();
  const row = $$('.setrow:not(.shead)')[i]; if (row) $('input[data-f=' + f + ']', row).value = nv;
  if (f === 'w') $$('.setrow:not(.shead)').forEach((r, j) => { if (j > i && !sl.sets[j].done) $('input[data-f=w]', r).value = sl.sets[j].w; });
}
function setField(sl, i, f, v) {
  const old = sl.sets[i][f]; sl.sets[i][f] = v;
  if (f === 'w') for (let j = i + 1; j < sl.sets.length; j++) if (!sl.sets[j].done && (sl.sets[j].w == null || sl.sets[j].w === old)) sl.sets[j].w = v;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action]'); if (!t || t.tagName === 'INPUT') return;
  const h = H[t.dataset.action]; if (h) h(t, e);
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][tabindex]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Escape' && $('#sheet-root.open')) closeSheet();
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'libq') { ui.libQ = t.value; const l = libList(); $('#libgrid').innerHTML = libGrid(l); $('#libcount').textContent = '共 ' + l.length + ' 個動作'; return; }
  if (t.id === 'foodq') { ui.food.q = t.value; $('#foodlist').innerHTML = foodResults(ui.food.q, ui.food.cat).map(foodRow).join(''); return; }
  if (t.dataset && t.dataset.ob !== undefined) { ui.onb.d[t.dataset.ob] = t.value; return; }
  if (t.dataset && t.dataset.f && store.active && ui.screen === 'exercise') {
    const sl = store.active.slots[ui.exIdx], i = +t.dataset.i, f = t.dataset.f, v = t.value.trim() === '' ? null : num(t.value.replace(',', '.'));
    if (t.value.trim() !== '' && (v == null || v < 0)) return;
    setField(sl, i, f, v); save();
    if (f === 'w') $$('.setrow:not(.shead)').forEach((r, j) => { if (j > i && !sl.sets[j].done) $('input[data-f=w]', r).value = sl.sets[j].w == null ? '' : sl.sets[j].w; });
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && t.dataset.action === 'libMine') { ui.libMine = t.checked; render(); return; }
  if (t.id === 'importFile' && t.files && t.files[0]) {
    const f = t.files[0]; const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || typeof d !== 'object' || !d.profile || !d.profile.phase || !Array.isArray(d.workouts)) throw 0;
        const s = Object.assign(defaultStore(), d); delete s.exportedAt; ui.pendingImport = s;
        sheetConfirm('還原這份備份？', '備份內有 ' + s.workouts.length + ' 次訓練紀錄。還原會取代目前的所有資料，包含訓練與飲食紀錄。', 'importDo', '還原', true);
      } catch (err) { toast('這不是有效的教練備份檔'); }
    };
    r.readAsText(f); t.value = '';
  }
});

/* ---------- 計時 ---------- */
function updateRest() {
  const a = store.active, el = $('#rest-t'), bar = $('#rest');
  if (a && a.restEnd && bar) {
    const left = (a.restEnd - Date.now()) / 1000;
    if (left <= 0) { a.restEnd = null; save(); bar.remove(); if (navigator.vibrate) try { navigator.vibrate([120, 80, 120]); } catch (e) { } toast('休息結束，下一組'); }
    else if (el) el.textContent = mmss(left);
  }
}
function tick() {
  const a = store.active;
  const el = $('#elapsed'); if (a && el) el.textContent = mmss((Date.now() - a.start) / 1000);
  updateRest();
}
setInterval(tick, 500);

/* ---------- 啟動 ---------- */
async function boot() {
  try { await loadData(); }
  catch (e) {
    $('#app').innerHTML = '<div class="onb"><h1>資料載入失敗</h1><p class="muted">找不到 data/exercises.json 或 data/rules.json。請確認這兩個檔案已上傳到 repo 的 <code>data</code> 資料夾，且與 coach.html 在同一層。若是直接雙擊開啟檔案，瀏覽器也會擋住讀取，請用 GitHub Pages 的網址開啟。</p></div>';
    return;
  }
  if (store.profile) {
    const bad = store.plan && store.plan.sessions.some(s => s.slots.some(x => !EXM[x.ex]));
    if (!store.plan || bad) store.plan = generatePlan(store.profile);
    if (store.active && store.active.slots.some(s => !EXM[s.ex])) store.active = null;
    save();
  } else ui.onb = initOnb();
  render(false);
}
window.__coach = { get store() { return store; }, set store(v) { store = v; }, ui, H, render, targets, generatePlan, weeklyReview, presc, suggest, intake, setNow: f => { NOWFN = f; }, EXM: () => EXM, initOnb, save, sheetReview, PRESETS, startWorkout, finishWorkout, boot };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
