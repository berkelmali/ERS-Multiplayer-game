import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
            console.error("Sign-in error:", error);
            return { success: false, message: this.getFriendlyErrorMessage(error.code) };
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
            console.error("Register error:", error.code, error.message);
            return { success: false, message: this.getFriendlyErrorMessage(error.code, error.message) };
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

    getFriendlyErrorMessage(code, defaultMessage = "An error occurred. Please try again.") {
        switch (code) {
            case 'auth/invalid-email': return 'Invalid email format.';
            case 'auth/user-not-found': return 'No account found with this email.';
            case 'auth/wrong-password': return 'Incorrect password.';
            case 'auth/email-already-in-use': return 'Email is already taken.';
            case 'auth/weak-password': return 'Password should be at least 6 characters.';
            case 'auth/invalid-credential': return 'Invalid credentials. Please try again.';
            default: return `Error [${code}]: ${defaultMessage}`;
        }
    }
};
