// 訓練の科目と、カリキュラムの自動提案。
// 科目は二等・一等の実地試験、学科試験、限定変更、操縦・撮影のスキルアップを想定した参考例。

export const TRAIN_TYPES = ['実機', 'シミュレーター', '座学'];
export const GOALS = [
  { id: 'exam', name: '試験対策', icon: '🎓' },
  { id: 'pilot', name: '操縦スキルアップ', icon: '🕹' },
  { id: 'photo', name: '撮影スキルアップ', icon: '📷' },
];
export const goalsOf = m => m.goals || ['exam'];
export const TYPE_ICON = { 実機: '✈', シミュレーター: '🎮', 座学: '📖', 休憩: '☕' };

// lv：難易度（1＝基礎、2＝標準、3＝応用）。cls：'一等' のみ対象。limit：その限定変更を目指すときだけ対象。
// pos：'start' は最初、'end' は最後に必ず入れる（目的に関係なく入る）。
// goals：どの目的の訓練で使うか（省略時は試験対策のみ）。
export const MODULES = [
  // ---- 座学 ----
  { id: 'g-basic', goals: ['exam', 'pilot'], lv: 1, type: '座学', title: '機体各部の名称・送信機の扱い・基本操作の理論', min: 15 },
  { id: 'g-law', lv: 1, type: '座学', title: '航空法・関係法令（飛行禁止空域・飛行の方法）', min: 20 },
  { id: 'g-wx', goals: ['exam', 'pilot'], lv: 1, type: '座学', title: '気象の基礎（風・天気図・局地的な気象）', min: 20 },
  { id: 'g-ac', goals: ['exam', 'pilot'], lv: 1, type: '座学', title: '機体の構造・電波・バッテリーの知識', min: 20 },
  { id: 'g-ops', lv: 2, type: '座学', title: '運航管理・リスク評価・安全確保措置', min: 20 },
  { id: 'g-plan', lv: 2, type: '座学', title: '飛行計画の作成練習（机上試験対策）', min: 20 },
  { id: 'g-mock', lv: 2, type: '座学', title: '学科試験の模擬問題', min: 20 },
  { id: 'g-case', goals: ['exam', 'pilot'], lv: 2, type: '座学', title: '事故・インシデント事例の研究', min: 15 },
  { id: 'g-cat3', lv: 3, type: '座学', title: 'カテゴリーⅢ飛行のリスク評価と運航体制', min: 20, cls: '一等' },
  { id: 'g-bvlos', lv: 2, type: '座学', title: '目視外飛行の運航体制と補助者の役割', min: 15, limit: '目視内限定の解除' },
  { id: 'g-night', lv: 2, type: '座学', title: '夜間飛行の注意点（灯火・目の錯覚）', min: 15, limit: '昼間限定の解除' },
  { id: 'g-heavy', lv: 2, type: '座学', title: '大型機の特性と取り扱い', min: 15, limit: '25kg未満限定の解除' },

  // ---- シミュレーター ----
  { id: 's-warm', type: 'シミュレーター', title: 'ウォームアップ（GPS モードで基本操作）', min: 5, pos: 'start' },
  { id: 's-basic', goals: ['exam', 'pilot'], lv: 1, type: 'シミュレーター', title: 'GPS モードで前後左右・上昇下降・旋回', min: 15 },
  { id: 's-hover', goals: ['exam', 'pilot'], lv: 1, type: 'シミュレーター', title: 'ATTI モードでのホバリング（機首4方向）', min: 15 },
  { id: 's-square', lv: 2, type: 'シミュレーター', title: '高度変化を伴うスクエア飛行', min: 15 },
  { id: 's-eight', goals: ['exam', 'pilot'], lv: 2, type: 'シミュレーター', title: '8の字飛行', min: 15 },
  { id: 's-nose', goals: ['exam', 'pilot'], lv: 3, type: 'シミュレーター', title: 'ノーズインサークル・対面ホバリング', min: 15 },
  { id: 's-emerg', lv: 2, type: 'シミュレーター', title: '異常事態における飛行（緊急着陸）', min: 10 },
  { id: 's-wind', goals: ['exam', 'pilot'], lv: 3, type: 'シミュレーター', title: '風のある条件でのホバリング・移動', min: 15 },
  { id: 's-pirou', goals: ['exam', 'pilot'], lv: 3, type: 'シミュレーター', title: 'ピルエットホバリング・精密な位置保持（一等想定）', min: 10, cls: '一等' },
  { id: 's-bvlos', lv: 2, type: 'シミュレーター', title: 'カメラ映像だけでの経路飛行', min: 15, limit: '目視内限定の解除' },
  { id: 's-night', lv: 2, type: 'シミュレーター', title: '夜間設定での飛行', min: 15, limit: '昼間限定の解除' },

  // ---- 実機 ----
  { id: 'r-pre', type: '実機', title: '飛行前点検（チェックリスト）', min: 10, pos: 'start' },
  { id: 'r-basic', goals: ['exam', 'pilot'], lv: 1, type: '実機', title: '離着陸と前後左右移動の反復（GPS モード）', min: 15 },
  { id: 'r-hover', goals: ['exam', 'pilot'], lv: 1, type: '実機', title: 'ホバリング（機首方向を変えて）', min: 10 },
  { id: 'r-square', lv: 2, type: '実機', title: '高度変化を伴うスクエア飛行', min: 15 },
  { id: 'r-eight', goals: ['exam', 'pilot'], lv: 2, type: '実機', title: '8の字飛行', min: 15 },
  { id: 'r-emerg', goals: ['exam', 'pilot'], lv: 2, type: '実機', title: '異常事態における飛行（ATTI モード・緊急着陸）', min: 15 },
  { id: 'r-nose', goals: ['exam', 'pilot'], lv: 3, type: '実機', title: '対面ホバリング・ノーズインサークル', min: 15 },
  { id: 'r-exam2', lv: 3, type: '実機', title: '試験形式の通し練習（二等）', min: 20 },
  { id: 'r-exam1', lv: 3, type: '実機', title: '試験形式の通し練習（一等想定）', min: 20, cls: '一等' },
  { id: 'r-bvlos', lv: 2, type: '実機', title: '目視外での経路飛行（モニター使用・補助者配置）', min: 15, limit: '目視内限定の解除' },
  { id: 'r-night', lv: 2, type: '実機', title: '夜間を想定した灯火確認と飛行', min: 15, limit: '昼間限定の解除' },
  { id: 'r-heavy', lv: 2, type: '実機', title: '大型機での離着陸・ホバリング', min: 15, limit: '25kg未満限定の解除' },
  // ---- 操縦スキルアップ ----
  { id: 'g-aero', goals: ['pilot'], lv: 2, type: '座学', title: '飛行の原理（揚力・トルク・慣性・機体の傾き）', min: 15 },
  { id: 'g-selfreview', goals: ['pilot', 'photo'], lv: 1, type: '座学', title: '飛行ログ・撮った動画を見返して自己分析', min: 15 },
  { id: 's-straight', goals: ['pilot'], lv: 1, type: 'シミュレーター', title: '速度と高度を一定に保つ直線飛行', min: 10 },
  { id: 's-orbit', goals: ['pilot', 'photo'], lv: 2, type: 'シミュレーター', title: '目標を中心にした円周飛行（オービット）', min: 15 },
  { id: 's-slalom', goals: ['pilot'], lv: 2, type: 'シミュレーター', title: 'スラローム（機首方向を変えながらの連続旋回）', min: 15 },
  { id: 's-sport', goals: ['pilot'], lv: 3, type: 'シミュレーター', title: '高速域（スポーツモード等）での機動と停止', min: 15 },
  { id: 's-gates', goals: ['pilot'], lv: 3, type: 'シミュレーター', title: 'ゲート・障害物の間を通過するコース飛行', min: 15 },
  { id: 'r-land', goals: ['pilot'], lv: 1, type: '実機', title: '精密着陸（狙った位置にそっと降ろす）', min: 10 },
  { id: 'r-orbit', goals: ['pilot', 'photo'], lv: 2, type: '実機', title: '目標を中心にした円周飛行（オービット）', min: 15 },
  { id: 'r-slalom', goals: ['pilot'], lv: 2, type: '実機', title: 'コーンを使ったスラローム', min: 15 },
  { id: 'r-windreal', goals: ['pilot'], lv: 3, type: '実機', title: '風のある日の当て舵（ホバリング・直線移動）', min: 15 },
  { id: 'r-gates', goals: ['pilot'], lv: 3, type: '実機', title: 'ゲート・コーンの間を通過するコース飛行', min: 15 },

  // ---- 撮影スキルアップ ----
  { id: 'g-exposure', goals: ['photo'], lv: 1, type: '座学', title: '露出の基本（シャッタースピード・ISO・ND フィルター）', min: 15 },
  { id: 'g-compo', goals: ['photo'], lv: 1, type: '座学', title: '構図・光の向き・撮影する時間帯', min: 15 },
  { id: 'g-shots', goals: ['photo'], lv: 2, type: '座学', title: '定番のカメラワークとショットリストの作り方', min: 15 },
  { id: 'g-shootplan', goals: ['photo'], lv: 2, type: '座学', title: '撮影計画（ロケハン・許可・天候・権利への配慮）', min: 20 },
  { id: 'g-edit', goals: ['photo'], lv: 2, type: '座学', title: '編集の基礎（カット割り・色補正・テンポ）', min: 20 },
  { id: 's-smooth', goals: ['photo'], lv: 1, type: 'シミュレーター', title: 'なめらかな加速・減速（映像向けの操作）', min: 15 },
  { id: 's-reveal', goals: ['photo'], lv: 2, type: 'シミュレーター', title: 'リビール・プルバック（前進・後退＋カメラの上下）', min: 15 },
  { id: 's-combo', goals: ['photo'], lv: 3, type: 'シミュレーター', title: '複合カメラワーク（移動＋旋回＋カメラ操作）', min: 15 },
  { id: 'r-still', goals: ['photo'], lv: 1, type: '実機', title: '静止画：高度と角度を変えた構図の比較', min: 15 },
  { id: 'r-smooth', goals: ['photo'], lv: 1, type: '実機', title: 'なめらかな加速・減速と一定速度の移動撮影', min: 15 },
  { id: 'r-reveal', goals: ['photo'], lv: 2, type: '実機', title: 'リビール・プルバックの撮影', min: 15 },
  { id: 'r-topdown', goals: ['photo'], lv: 2, type: '実機', title: '真上からの撮影（トップダウン）と横移動の撮影', min: 15 },
  { id: 'r-lapse', goals: ['photo'], lv: 2, type: '実機', title: 'パノラマ・タイムラプス・ハイパーラプス', min: 15 },
  { id: 'r-track', goals: ['photo'], lv: 3, type: '実機', title: '動く被写体の追尾撮影（手動・自動追尾）', min: 15 },
  { id: 'r-combo', goals: ['photo'], lv: 3, type: '実機', title: '複合カメラワーク（移動＋旋回＋カメラ操作）', min: 15 },

  { id: 'r-post', type: '実機', title: '飛行後点検・記録', min: 10, pos: 'end' },
];

// 総飛行時間からの経験レベル
export const LEVELS = [
  { lv: 1, name: '初級', range: '10時間未満', desc: '基本操作の反復を中心に組みます' },
  { lv: 2, name: '中級', range: '10〜50時間', desc: '試験科目の標準的な練習を中心に組みます' },
  { lv: 3, name: '上級', range: '50時間以上', desc: '応用科目と試験形式の通し練習を中心に組みます' },
];
export function levelFromHours(h) { return h < 10 ? 1 : h < 50 ? 2 : 3; }

// レベルごとの優先度の加点（科目の難易度別）。null はそのレベルでは提案しない
const LEVEL_BONUS = {
  1: { 1: 25, 2: 0, 3: null },
  2: { 1: -5, 2: 20, 3: 5 },
  3: { 1: -20, 2: 5, 3: 25 },
};

const FREE = {
  座学: '復習（苦手な分野の見直し）',
  シミュレーター: '自由練習（苦手な科目の反復）',
  実機: '自由練習（苦手な科目の反復）',
};
const ORDER = ['座学', 'シミュレーター', '実機'];

/**
 * カリキュラムを提案する。
 * @param {object} o
 * @param {number} o.minutes  予定の訓練時間（分）
 * @param {string[]} o.types   希望する種目
 * @param {string} o.cls       '二等' | '一等'
 * @param {string[]} o.limits  目指す限定変更
 * @param {object} o.lastDone  { moduleId: 'YYYY-MM-DD' } 最後に行った日
 * @param {boolean} o.shuffle  作り直すとき true（順位に揺らぎを入れる）
 * @param {number} o.level     経験レベル（1〜3）
 * @param {string[]} o.goals   訓練の目的（'exam' | 'pilot' | 'photo'）
 * @returns {{ items: object[], notes: string[] }}
 */
export function proposePlan({ minutes, types, cls, limits = [], lastDone = {}, shuffle = false, level = 2, goals = ['exam'] }) {
  const notes = [];
  types = ORDER.filter(t => types.includes(t));
  if (!types.length || minutes < 10) return { items: [], notes: ['時間（10分以上）と種目を選んでください'] };

  // 90 分ごとに 10 分の休憩
  const breaks = Math.floor(minutes / 90);
  const usable = minutes - breaks * 10;

  // 種目ごとの時間配分（実機は準備・片付けがあるので少し多めに）
  const weight = { 座学: 1, シミュレーター: 1, 実機: 1.3 };
  const totalW = types.reduce((s, t) => s + weight[t], 0);
  const share = {};
  let assigned = 0;
  types.forEach((t, i) => {
    share[t] = i === types.length - 1 ? usable - assigned : Math.round(usable * weight[t] / totalW / 5) * 5;
    assigned += share[t];
  });

  const today = new Date();
  const bonus = LEVEL_BONUS[level] || LEVEL_BONUS[2];
  if (!goals.length) goals = ['exam'];
  const forExam = goals.includes('exam');
  const eligible = m => (m.pos || goalsOf(m).some(g => goals.includes(g)))
    && (!m.cls || (forExam && m.cls === cls)) && (!m.limit || (forExam && limits.includes(m.limit)))
    && (!m.lv || bonus[m.lv] !== null);
  const score = m => {
    const last = lastDone[m.id];
    let s = last ? (today - new Date(last)) / 86400000 : 60; // 未実施は 60 日分の重み
    if (m.cls || m.limit) s += 10; // 目標に直結する科目を優先
    if (goals.length > 1 && goalsOf(m).length === 1 && goals.includes(goalsOf(m)[0])) s += 5; // 目的ごとの専用科目も混ぜる
    if (m.lv) s += bonus[m.lv]; // 経験レベルに合った難易度を優先
    if (shuffle) s += Math.random() * 20;
    return s;
  };

  const blocks = [];
  for (const t of types) {
    let left = share[t];
    const mods = MODULES.filter(m => m.type === t && eligible(m));
    const start = mods.filter(m => m.pos === 'start');
    const end = mods.filter(m => m.pos === 'end');
    const fixed = [...start, ...end].reduce((s, m) => s + m.min, 0);
    if (t === '実機' && left < fixed + 10) {
      notes.push(`実機は点検・片付けを含めて ${fixed + 10} 分以上必要です。時間を増やすか種目を減らしてください。`);
    }
    const body = [];
    left -= fixed;
    const pool = mods.filter(m => !m.pos).sort((a, b) => score(b) - score(a));
    for (const m of pool) {
      if (m.min <= left) { body.push(m); left -= m.min; }
    }
    // 残りが 10 分以上あれば、まだ選んでいない科目のうち優先度の高いものを短くして入れる
    const rest = pool.find(m => !body.includes(m));
    if (left >= 10 && rest) { body.push({ ...rest, min: left }); left = 0; }
    if (left >= 5) body.push({ id: `free-${t}`, type: t, title: FREE[t], min: left });
    else if (left > 0 && body.length) body[body.length - 1] = { ...body[body.length - 1], min: body[body.length - 1].min + left };
    blocks.push([...start, ...body, ...end].map(m => ({ moduleId: m.id, type: t, title: m.title, minutes: m.min, done: false })));
    if (t === '実機' && share[t] >= 40) notes.push('実機はバッテリー 1 本で 15〜20 分が目安です。予備バッテリーを用意してください。');
  }

  // 休憩を種目の切れ目（なければ途中）に入れる
  const items = blocks.flat();
  const bounds = [];
  blocks.slice(0, -1).reduce((n, bl) => { bounds.push(n + bl.length); return n + bl.length; }, 0);
  const positions = [];
  for (let b = 0; b < breaks; b++) {
    const target = Math.round(items.length * (b + 1) / (breaks + 1));
    const free = bounds.filter(x => !positions.includes(x));
    positions.push(free.length ? free.reduce((a, x) => (Math.abs(x - target) < Math.abs(a - target) ? x : a)) : target);
  }
  positions.sort((a, b) => b - a).forEach(pos => {
    items.splice(pos, 0, { moduleId: 'break', type: '休憩', title: '休憩・水分補給', minutes: 10, done: false });
  });
  if (types.includes('実機') && goals.includes('photo')) {
    notes.push('撮影の練習では、人の顔や車のナンバー、住宅などが写り込まないように注意し、人・物件から 30m 以上の距離を保ってください（30m 未満は許可・承認が必要です）。');
  }
  if (types.includes('実機') && forExam && limits.includes('昼間限定の解除')) {
    notes.push('夜間の実機訓練は、飛行の許可・承認の範囲で、明るいうちに障害物を確認してから行ってください。');
  }
  return { items, notes };
}

// 訓練記録から「科目ごとに最後に行った日」を作る
export function lastDoneMap(trainings) {
  const map = {};
  for (const t of trainings) {
    for (const it of t.items || []) {
      if (it.done && it.moduleId && (!map[it.moduleId] || map[it.moduleId] < t.date)) map[it.moduleId] = t.date;
    }
  }
  return map;
}

// 訓練 1 件の時間を種目ごとに分ける（計画があれば計画の配分で按分）
export function splitByType(t) {
  const out = {};
  const items = (t.items || []).filter(i => i.type !== '休憩');
  const planned = items.reduce((s, i) => s + (i.minutes || 0), 0);
  if (!planned) {
    const types = t.types?.length ? t.types : ['その他'];
    types.forEach(ty => { out[ty] = (out[ty] || 0) + (t.durationSec || 0) / types.length; });
    return out;
  }
  for (const i of items) out[i.type] = (out[i.type] || 0) + (t.durationSec || 0) * i.minutes / planned;
  return out;
}
