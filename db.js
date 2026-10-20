// iPhone 本体（ブラウザの IndexedDB）にデータを保存する小さなラッパー。
// データは外部に送信されない。

const DB_NAME = 'drone-log';
const DB_VERSION = 2;
export const STORES = ['aircraft', 'flights', 'inspections', 'maintenance', 'documents', 'trainings', 'settings'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  }));
}

function req2promise(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export const db = {
  all(store) {
    return open().then(d => req2promise(d.transaction(store).objectStore(store).getAll()));
  },
  get(store, id) {
    return open().then(d => req2promise(d.transaction(store).objectStore(store).get(id)));
  },
  put(store, obj) {
    if (!obj.id) obj.id = newId();
    obj.updatedAt = new Date().toISOString();
    return tx(store, 'readwrite', s => { s.put(obj); return obj; });
  },
  // 削除した記録は「削除済み」として覚えておき、他の端末と統合するときに相手側でも削除する
  async remove(store, id) {
    await tx(store, 'readwrite', s => { s.delete(id); });
    if (store === 'settings') return;
    const cur = (await this.get('settings', DELETED_KEY))?.value || [];
    cur.push({ store, id, at: new Date().toISOString() });
    await tx('settings', 'readwrite', s => { s.put({ id: DELETED_KEY, value: cur.slice(-2000), updatedAt: new Date().toISOString() }); });
  },
  clear(store) {
    return tx(store, 'readwrite', s => { s.clear(); });
  },
  async exportAll() {
    const out = { app: 'drone-log', version: DB_VERSION, exportedAt: new Date().toISOString() };
    for (const s of STORES) out[s] = await this.all(s);
    return out;
  },
  async importAll(data) {
    if (data.app !== 'drone-log') throw new Error('このアプリのバックアップファイルではありません');
    for (const s of STORES) {
      if (!Array.isArray(data[s])) continue;
      await this.clear(s);
      await tx(s, 'readwrite', st => { for (const o of data[s]) st.put(o); });
    }
  },
  // 他の端末のデータと統合する（同じ記録は更新日時が新しいほうを残す。今のデータは消さない）
  async mergeAll(data) {
    if (data.app !== 'drone-log') throw new Error('このアプリのファイルではありません');
    const result = { added: 0, updated: 0, deleted: 0 };
    const incomingSettings = Object.fromEntries((data.settings || []).map(o => [o.id, o]));
    const myDeleted = (await this.get('settings', DELETED_KEY))?.value || [];
    const theirDeleted = incomingSettings[DELETED_KEY]?.value || [];
    const deletedAt = {};
    for (const d of [...myDeleted, ...theirDeleted]) {
      const k = `${d.store}/${d.id}`;
      if (!deletedAt[k] || deletedAt[k] < d.at) deletedAt[k] = d.at;
    }
    for (const s of STORES) {
      if (s === 'settings' || !Array.isArray(data[s])) continue;
      const mine = Object.fromEntries((await this.all(s)).map(o => [o.id, o]));
      const puts = [], dels = [];
      for (const o of data[s]) {
        const del = deletedAt[`${s}/${o.id}`];
        if (del && del >= (o.updatedAt || '')) continue; // こちらで削除済み
        const m = mine[o.id];
        if (!m) { puts.push(o); result.added++; }
        else if ((o.updatedAt || '') > (m.updatedAt || '')) { puts.push(o); result.updated++; }
      }
      for (const m of Object.values(mine)) {
        const del = deletedAt[`${s}/${m.id}`];
        if (del && del >= (m.updatedAt || '')) { dels.push(m.id); result.deleted++; }
      }
      await tx(s, 'readwrite', st => { puts.forEach(o => st.put(o)); dels.forEach(id => st.delete(id)); });
    }
    // 設定：端末ごとの一時的な状態以外を、新しいほうで上書き
    const mineSettings = Object.fromEntries((await this.all('settings')).map(o => [o.id, o]));
    await tx('settings', 'readwrite', st => {
      for (const o of Object.values(incomingSettings)) {
        if (LOCAL_SETTINGS.includes(o.id) || o.id === DELETED_KEY) continue;
        const m = mineSettings[o.id];
        if (!m || (o.updatedAt || '') > (m.updatedAt || '')) st.put(o);
      }
      const merged = Object.entries(deletedAt).map(([k, at]) => { const [store, ...rest] = k.split('/'); return { store, id: rest.join('/'), at }; });
      st.put({ id: DELETED_KEY, value: merged.slice(-2000), updatedAt: new Date().toISOString() });
    });
    return result;
  },
};

const DELETED_KEY = '_deleted';
// 端末ごとの一時的な状態（飛行中・点検中・訓練中、地図の表示位置など）は統合しない
const LOCAL_SETTINGS = ['activeFlight', 'activeCheck', 'activeTraining', 'pendingPlace', 'checkPreset', 'mapState', 'lastBackup', 'lastSync'];

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
