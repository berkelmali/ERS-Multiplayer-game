import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Replace these values with your actual Firebase project configuration
export const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "ers-cardgame.firebaseapp.com",
    projectId: "ers-cardgame",
    storageBucket: "ers-cardgame.firebasestorage.app",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    databaseURL: "https://ers-cardgame-default-rtdb.firebaseio.com"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export const functions = getFunctions(app);
