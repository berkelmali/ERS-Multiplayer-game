export const RulesPanel = {
    init() {
        this.screenRules = document.getElementById('rules-panel');
        this.screenMenu = document.getElementById('main-menu');

        document.getElementById('btn-rules').addEventListener('click', () => {
            this.screenMenu.classList.remove('active');
            this.screenRules.classList.add('active');
        });

        document.getElementById('btn-rules-back').addEventListener('click', () => {
            this.screenRules.classList.remove('active');
            this.screenMenu.classList.add('active');
        });
    }
};
