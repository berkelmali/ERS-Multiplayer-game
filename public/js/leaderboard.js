import { getFirestore, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { app } from "./firebaseConfig.js";
import { Localization } from './localization.js?v=3';

const db = getFirestore(app);

export const Leaderboard = {
    init() {
        this.panel = document.getElementById('leaderboard-panel');
        this.mainMenu = document.getElementById('main-menu');
        this.content = document.getElementById('leaderboard-content');

        document.getElementById('btn-leaderboard').addEventListener('click', () => {
            this.mainMenu.classList.remove('active');
            this.panel.classList.add('active');
            this.loadLeaderboard();
        });

        document.getElementById('btn-leaderboard-back').addEventListener('click', () => {
            this.panel.classList.remove('active');
            this.mainMenu.classList.add('active');
        });
    },

    async loadLeaderboard() {
        this.content.innerHTML = `<p style="text-align:center;">${Localization.get('loading')}</p>`;
        try {
            const usersRef = collection(db, "users");
            const q = query(usersRef, orderBy("totalScore", "desc"), limit(10));

            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                this.content.innerHTML = `<p style="text-align:center;">${Localization.get('noPlayers')}</p>`;
                return;
            }

            let html = '<ul style="list-style:none; padding:0; margin:0;">';
            let rank = 1;
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                const username = data.username || 'Unknown';
                const score = data.totalScore || 0;

                let rankStyle = "color: white; font-size: 1.1rem;";
                if (rank === 1) rankStyle = "color: gold; text-shadow: 0 0 10px rgba(255,215,0,0.5); font-size: 1.4rem; font-weight: bold;";
                else if (rank === 2) rankStyle = "color: silver; font-size: 1.2rem; font-weight: bold;";
                else if (rank === 3) rankStyle = "color: #cd7f32; font-size: 1.2rem; font-weight: bold;";

                html += `
                    <li style="display:flex; justify-content:space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,0.1); ${rankStyle}">
                        <span style="flex:1;">${rank}. ${username}</span>
                        <span style="font-weight:900;">${score}</span>
                    </li>
                `;
                rank++;
            });
            html += '</ul>';
            this.content.innerHTML = html;

        } catch (error) {
            console.error("Error fetching leaderboard:", error);
            this.content.innerHTML = `<p style="text-align:center; color:var(--error);">${Localization.get('failedLoad')}</p>`;
        }
    }
};
