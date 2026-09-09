import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import EventBus from "./eventbus.js";

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

            // Set the display name on the Auth profile
            await updateProfile(userCredential.user, { displayName: username });

            // Since onAuthStateChanged might fire immediately, proactively seed the Firestore profile 
            // with the EXACT chosen username instead of letting userProfile.js guess it from the email!
            const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
            const userRef = doc(db, "users", userCredential.user.uid);
            await setDoc(userRef, {
                username: username,
                email: email,
                totalScore: 0,
                gamesPlayed: 0,
                gamesWon: 0
            }, { merge: true }); // Merge ensures we don't clobber if userProfile.js raced us.

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
