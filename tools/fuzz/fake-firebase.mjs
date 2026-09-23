// tools/fuzz/fake-firebase.mjs — an IN-MEMORY Realtime Database for the fuzzer.
//
// TEST-ONLY. Loaded in place of the Firebase CDN modules by tools/fuzz/hooks.mjs,
// never by the app. The inert stub (tools/firebase-stub.mjs) says "do not grow
// this file into a fake backend"; this is that backend, kept separate so the
// stub stays inert.
//
// What it imitates, because the bugs live there: a transaction runs its updater
// on a COPY, `undefined` aborts it, and what is stored is what RTDB stores —
// no nulls, no empty arrays, no empty objects. `cards: []` comes back missing.
export * from '../firebase-stub.mjs';

export const store = { root: {}, writes: 0, aborted: 0, listeners: [] };
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** RTDB drops null, empty arrays and empty objects. */
export function normalize(v) {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) {
        const out = v.map(normalize);
        if (out.every(x => x === undefined)) return undefined;
        // A sparse array comes back as an object with numeric keys; keep arrays
        // dense where they were dense, which is what the app writes.
        return out.map(x => (x === undefined ? null : x)).length ? out : undefined;
    }
    if (typeof v === 'object') {
        const out = {};
        for (const [k, x] of Object.entries(v)) {
            const n = normalize(x);
            if (n !== undefined) out[k] = n;
        }
        return Object.keys(out).length ? out : undefined;
    }
    return v;
}

function getPath(path) {
    return path.split('/').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), store.root);
}
/** Like RTDB: every listener on an affected path hears the new value, asynchronously. */
function notify(path) {
    for (const l of store.listeners) {
        if (l.off) continue;
        if (!(l.path === path || path.startsWith(l.path + '/') || l.path.startsWith(path + '/'))) continue;
        Promise.resolve().then(() => {
            if (l.off) return;
            const v = read(l.path);
            try { l.cb({ exists: () => v !== undefined, val: () => (v === undefined ? null : v), key: l.path.split('/').pop() }); }
            catch (e) { (store.errors || (store.errors = [])).push(e); }
        });
    }
}
function setPath(path, val) {
    const ks = path.split('/').filter(Boolean);
    let o = store.root;
    for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
    const n = normalize(val);
    if (n === undefined) delete o[ks[ks.length - 1]];
    else o[ks[ks.length - 1]] = n;
    notify(path);
}
export function read(path) { return clone(getPath(path)); }
export function write(path, val) { setPath(path, clone(val)); }

export const getDatabase = () => ({ fake: true });
export const ref = (db, path = '') => ({ path: typeof db === 'string' ? db : path });
export async function runTransaction(r, fn) {
    // The updater MUTATES what it is given (the app's transactions all do), so
    // the state before the write is kept as its own copy for onCommit. The
    // first version of this file passed the mutated object as "before", and
    // every before/after check in the fuzzer compared the write to itself.
    const prior = clone(getPath(r.path));
    const cur = clone(getPath(r.path));
    const next = fn(cur === undefined ? null : cur);
    if (next === undefined) { store.aborted++; return { committed: false, snapshot: { val: () => cur } }; }
    setPath(r.path, next);
    store.writes++;
    if (store.onCommit) store.onCommit(r.path, prior === undefined ? null : prior, read(r.path), 'transaction');
    return { committed: true, snapshot: { val: () => read(r.path) } };
}
export async function set(r, v) { setPath(r.path, v); store.writes++; }
export async function update(r, v) {
    const prior = clone(getPath(r.path));
    for (const [k, x] of Object.entries(v)) setPath(`${r.path}/${k}`, x);
    store.writes++;
    if (store.onCommit) store.onCommit(r.path, prior === undefined ? null : prior, read(r.path), 'update');
}
export async function remove(r) { setPath(r.path, null); }
export function onValue(r, cb) {
    if (r.path === '.info/connected') { Promise.resolve().then(() => cb({ val: () => true, exists: () => true })); return () => {}; }
    const l = { path: r.path, cb, off: false };
    store.listeners.push(l);
    Promise.resolve().then(() => { if (!l.off) { const v = read(l.path); cb({ exists: () => v !== undefined, val: () => (v === undefined ? null : v) }); } });
    return () => { l.off = true; };
}
export function off(r) { for (const l of store.listeners) if (!r || l.path === r.path) l.off = true; }
export const onDisconnect = () => ({ set: async () => {}, update: async () => {}, cancel: async () => {}, remove: async () => {} });
export async function get(r) { const v = read(r.path); return { exists: () => v !== undefined, val: () => (v === undefined ? null : v) }; }
