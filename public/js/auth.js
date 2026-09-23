import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import EventBus from "./eventbus.js";
import { cleanName } from "./safeText.js";
import { createRecord } from "./playerRecord.js";

// Initialize Firebase Auth
export const auth = getAuth(app);
const db = getFirestore(app);

export const AuthSystem = {
    currentUser: null,

    init() {
        onAuthStateChanged(auth, (user) => {
            this.currentUser = user;
            if (user) {
                console.log("User logged in:", user.email);
            } else {
                console.log("User logged out");
            }
            EventBus.emit('authStateChanged', user);
        });
    },

    async signIn(email, password) {
        try {
            await signInWithEmailAndPassword(auth, email, password);
            return { success: true };
        } catch (error) {
            console.error("Sign-in error:", error.code);
            return { success: false, messageKey: authErrorKey(error.code) };
        }
    },

    async register(username, email, password) {
        try {
            // Because Firestore rules prevent unauthenticated reads, we cannot check
            // username uniqueness via a query before creating the account!
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);

            // The name is cleaned BEFORE it is stored anywhere: it is shown to
            // other players (leaderboard, tables), so only letters, digits,
            // spaces and _ . - survive (safeText.js, enforced by firestore.rules).
            const safeName = cleanName(username);
            await updateProfile(userCredential.user, { displayName: safeName });

            // Seed the private record with the chosen name. The email is NOT
            // copied into Firestore: Authentication already holds it, and the
            // record used to be world-readable (security review, v3.18.0).
            await createRecord(userCredential.user, safeName);

            return { success: true };
        } catch (error) {
            console.error("Register error:", error.code);
            return { success: false, messageKey: authErrorKey(error.code) };
        }
    },

    async logout() {
        try {
            await signOut(auth);
            return { success: true };
        } catch (error) {
            return { success: false, message: error.message };
        }
    },

    /**
     * v3.12.0 — the password reset the rules screen never had.
     *
     * The result is deliberately the SAME whether or not the address has an
     * account: `auth/user-not-found` is reported as success. Telling a
     * stranger which emails are registered here is an account-enumeration
     * oracle, and it buys the honest user nothing they cannot learn by
     * checking their inbox.
     */
    async resetPassword(email) {
        try {
            await sendPasswordResetEmail(auth, email);
            return { success: true, messageKey: 'resetSent' };
        } catch (error) {
            console.error("Password reset error:", error.code);
            if (error.code === 'auth/user-not-found') {
                return { success: true, messageKey: 'resetSent' };
            }
            return { success: false, messageKey: authErrorKey(error.code) };
        }
    }
};

/**
 * v3.12.0 — a Firebase error code becomes a localization KEY, never a
 * sentence.
 *
 * What this replaces: six hardcoded English strings, and a `default` branch
 * that printed `Error [auth/network-request-failed]: ...` straight into the
 * card. A Turkish player was shown an English sentence on the six known
 * paths and a raw SDK identifier on every other one — the identifier being
 * the case that fires when the network is down, which is exactly when a
 * player is least able to guess what it means.
 *
 * Exported and pure, so the mapping is testable without a browser: the test
 * suite asserts that every key this returns exists in all four languages.
 */
export function authErrorKey(code) {
    switch (code) {
        case 'auth/invalid-email':           return 'authErrInvalidEmail';
        case 'auth/user-not-found':          return 'authErrUserNotFound';
        case 'auth/wrong-password':          return 'authErrWrongPassword';
        case 'auth/email-already-in-use':    return 'authErrEmailInUse';
        case 'auth/weak-password':           return 'authErrWeakPassword';
        case 'auth/invalid-credential':      return 'authErrInvalidCredential';
        case 'auth/too-many-requests':       return 'authErrTooManyRequests';
        case 'auth/network-request-failed':  return 'authErrNetwork';
        default:                             return 'authErrGeneric';
    }
}
