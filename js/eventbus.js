// Event Bus Pattern for decoupled communication
const EventBus = {
    listeners: {},
    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    },
    emit(event, ...args) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(...args));
        }
    }
};

export default EventBus;
