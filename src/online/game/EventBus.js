// Shared event emitter for React <-> Phaser communication.
// React components emit events here; Phaser scenes listen here, and vice-versa.
//
// Deliberately dependency-free: this module is imported by GameContext (the
// entry chunk), so basing it on Phaser.Events.EventEmitter would drag the
// entire 1.5 MB Phaser bundle onto the lobby's critical path and defeat the
// React.lazy code-splitting of the game screen.
class Emitter {
  constructor() {
    this._listeners = new Map() // event -> Set<fn>
  }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set())
    this._listeners.get(event).add(fn)
    return this
  }

  off(event, fn) {
    const set = this._listeners.get(event)
    if (!set) return this
    if (fn) set.delete(fn)
    else set.clear()
    if (set.size === 0) this._listeners.delete(event)
    return this
  }

  emit(event, ...args) {
    const set = this._listeners.get(event)
    if (!set || set.size === 0) return false
    // Copy so a handler can add/remove listeners mid-emit safely.
    for (const fn of [...set]) fn(...args)
    return true
  }
}

export const EventBus = new Emitter()
