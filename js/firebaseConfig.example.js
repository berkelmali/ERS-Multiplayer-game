import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "project_name.firebaseapp.com",
    projectId: "project_name",
    storageBucket: "project_name.firebasestorage.app",
    messagingSenderId: "SENDER_ID",
    appId: "APP_ID",
    databaseURL: "https://project_name-default-rtdb.firebaseio.com"
};

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);