import type { LLMCompletion } from "./completion"

export namespace LLMMemory {
    export interface Contexts<ContextType = any> {
        id: string | number,
        sessions: ContextSession[]
    }
    export interface ContextSession {
        sessionId: string | number,
        messages: LLMCompletion.CompletionMessage[]
        usage?: LLMCompletion.CompletionUsage
    }
}