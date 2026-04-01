export class Stack<Item = any> {
    private stackSize: number;
    private stack: Array<Item>;
    constructor(size: number) {
        this.stackSize = size;
        this.stack = [];
    }
    public push(item: Item): void {
        if (this.stack.length >= this.stackSize) {
            throw new Error('Stack Overflow');
        }
        this.stack.push(item);
    }
    public pop(): Item | undefined {
        return this.stack.pop();
    }
    public bottom(): Item | undefined {
        return this.stack[0];
    }
    public top(): Item | undefined {
        return this.stack[this.stack.length - 1];
    }
    public clear(): void {
        this.stack = [];
    }
    public empty(): boolean {
        return this.stack.length === 0;
    }
    public full(): boolean {
        return this.stack.length === this.stackSize;
    }
    public size(): number {
        return this.stack.length;
    }
    public [Symbol.iterator](): Iterator<Item> {
        let index = this.stack.length - 1;
        const stack = this.stack;
        return {
            next(): IteratorResult<Item> {
                if (index >= 0) {
                    return { value: stack[index--] as Item, done: false };
                }
                return { value: undefined as any, done: true };
            }
        };
    }
}