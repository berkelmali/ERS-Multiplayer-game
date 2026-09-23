// tools/firebase-stub.mjs — offline test double for the Firebase CDN modules.
//
// The smoke test runs with no network, and every module in the app transitively
// imports the Firebase SDK from https://www.gstatic.com. Playwright serves this
// file for those URLs so the module graph LINKS. It simulates no Firebase
// behaviour whatsoever and every function is inert — deliberately, because the
// path under test is Offline Bot Mode, which never touches Firebase.
//
// If a future test needs real Firebase behaviour, use the emulator suite; do
// not grow this file into a fake backend.
const noop = () => {};
const unsub = () => noop;
export const initializeApp = () => ({ name: 'stub' });
export const getAuth = () => ({ currentUser: null });
// Fires ASYNCHRONOUSLY, exactly like the real SDK — which is the whole of
// council finding F1: nothing may read the auth state synchronously at boot.
// __ERS_SMOKE_USER__ lets a smoke step simulate a restored session, so the
// signed-in invite path can be driven at all.
export const onAuthStateChanged = (a, cb) => {
    setTimeout(() => cb((typeof globalThis !== 'undefined' && globalThis.__ERS_SMOKE_USER__) || null), 0);
    return noop;
};
export const signInWithEmailAndPassword = async () => { throw new Error('offline stub'); };
export const createUserWithEmailAndPassword = async () => { throw new Error('offline stub'); };
export const signOut = async () => {};
export const updateProfile = async () => {};
export const sendPasswordResetEmail = async () => {};
export const getFirestore = () => ({});
export const doc = () => ({});
export const collection = () => ({});
export const query = () => ({});
export const where = () => ({});
export const orderBy = () => ({});
export const limit = () => ({});
export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
export const getDocs = async () => ({ empty: true, forEach: noop });
export const setDoc = async () => {};
export const updateDoc = async () => {};
export const deleteDoc = async () => {};
export const increment = (n) => n;
export const deleteField = () => ({ __delete: true });
export const onSnapshot = unsub;
export const serverTimestamp = () => Date.now();
export const getDatabase = () => ({});
export const ref = () => ({});
export const onValue = unsub;
export const off = noop;
export const update = async () => {};
export const remove = async () => {};
export const set = async () => {};
export const get = async () => ({ exists: () => false, val: () => null });
export const onDisconnect = () => ({ set: async () => {}, update: async () => {}, cancel: async () => {}, remove: async () => {} });
export const runTransaction = async () => ({ committed: false });
export const getFunctions = () => ({});
export const httpsCallable = () => async () => ({ data: {} });
