import EventEmitter from "events";
type EventMap<T> = Record<keyof T, any[]>;

/**
 * you know that ts or js has no f\*\*king runtime types
 * if there already a event registered on emitter01 and expected params string
 * you pipe a same event name to emitter01 and emit value typed number
 * and no one knows
 * no error no f\*\*king error and no ts error
 * you just serious declared this event can only accept string but a number go through without any error
 * this will cause you code lose control
 * so use it carefully,really really important
 * this game will never end and fuck javascript!
 */

export default class JustEventEmitter<T extends EventMap<T> = any> extends EventEmitter<T> {

    protected declaredEventName = new Set<keyof T>()
    private pipes = new Map<keyof T, (...args: any[]) => void>();

    public isEventAcceptable(eventName: string | number | symbol) {
        return this.declaredEventName.has(eventName as any)
    }

    constructor(eventDeclares: (keyof T)[], options?: EventEmitter.EventEmitterOptions) {
        super(options)
        for (const d of eventDeclares) {
            this.declaredEventName.add(d)
        }
    }

    public pipeTo<U extends EventMap<U> = any>(eventEmitter: JustEventEmitter<U> | EventEmitter<U>): this {
        for (const myEvent of this.declaredEventName.values()) {
            let canPipe: boolean = false
            if (eventEmitter instanceof JustEventEmitter) {
                canPipe = eventEmitter.isEventAcceptable(myEvent)
            }
            else {
                canPipe = true
            }
            if (canPipe) {
                const handler = (...args: any[]) => {
                    eventEmitter.emit(myEvent as any, ...args as unknown as any);
                }
                this.on(myEvent as any, handler);
                if (!this.pipes.has(myEvent)) {
                    this.pipes.set(myEvent, handler);
                }
            }
        }
        return this;
    }

    public unpipeTo(eventName: keyof T): this {
        const handler = this.pipes.get(eventName);
        if (handler) {
            this.off(eventName as any, handler);
            this.pipes.delete(eventName);
        }
        return this;
    }

    public unpipeAll(): this {
        for (const [event, handler] of this.pipes) {
            this.off(event as any, handler);
        }
        this.pipes.clear();
        return this;
    }

}

