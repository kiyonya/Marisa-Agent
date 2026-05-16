export type RestArray<T> = T extends Array<any> ? T : [T]


export type Interceptor<I> = (prev: I) => I

export class InterceptorChain<Input> {

    private interceptorChain = new Set<Interceptor<Input>>()
    private useDeepclone: boolean = false
    constructor(deepclone: boolean = false) {
        this.useDeepclone = deepclone
    }

    get interceptors() {
        return [...this.interceptorChain.values()]
    }

    get size() {
        return this.interceptorChain.size
    }

    public concat(interceptorChain: InterceptorChain<Input>) {
        const interceptors = interceptorChain.interceptors
        for (const interceptor of interceptors) {
            this.addInterceptor(interceptor)
        }
        return this
    }

    public async through(input: Input): Promise<Input> {
        let currentInputs = input
        for (const interceptor of this.interceptorChain) {
            if (typeof interceptor === 'function') {
                const result = await interceptor(currentInputs)
                currentInputs = result
            }
        }
        return currentInputs
    }

    public addInterceptor(interceptor: Interceptor<Input>) {
        this.interceptorChain.add(interceptor)
        return this
    }

    public removeInterceptor(interceptor: Interceptor<Input>) {
        this.interceptorChain.delete(interceptor)
        return this
    }

    public removeAllInterceptor() {
        this.interceptorChain.clear()
        return this
    }


}


