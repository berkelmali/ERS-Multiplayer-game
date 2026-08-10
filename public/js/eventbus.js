// Event Bus Pattern for decoupled communication
const EventBus = {
    listeners: {},
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    },
    off(event, callback) {
        if (!this.listeners[event]) return;
        if (callback) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        } else {
            this.listeners[event] = []; // Fallback if no callback provided
        }
    },
    emit(event, ...args) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(...args));
        }
    }
};

export default EventBus;
