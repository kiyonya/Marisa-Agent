
import { Marisa } from "../../../types/marisa"
import { existsSync } from "fs-extra"
import path from "path"
import ChatModelComponent from "../../model/chat/chat-model-component"
import JSONL from "../../utils/jsonl"

export type MemoryCategoryAllowedType = 'user' | 'feedback' | 'reference' | 'experience'

export interface CategoryMemoryMetadata {
    type: MemoryCategoryAllowedType,
    description: string,
    time: number,
    name: string,
    keywords: string[]
}

export interface CategoryMemory {
    metadata: CategoryMemoryMetadata,
    content: string
}


/**
 * when things pass just let it go
 * you never care about what you say in your age 3
 * it's doesn't matter
 * i dont care about what context manager you used before
 * i just care about whether i should save your context now
 * y o l o
 */

/**
 *  (dir) memories
 *     - longterm.md
 *     - (dir) submemory
 *          - user
 *          - feedback
 *          - reference
 *              - bilibili-link.json
 *              - ncm-link.json
 *      - vector
 *          - memory_vector.db
 *      - search
 *          - memory_search.db
 */
abstract class ModelContextIOEssential extends ChatModelComponent<Marisa.Events.ModelContextManager> {

    protected static memoryCategories: MemoryCategoryAllowedType[] = ['user', 'feedback', 'reference', 'experience']

    constructor() {
        super()
    }
}

export abstract class ModelContextManager extends ModelContextIOEssential {

    protected modelSessionWindowLength: number = 20
    protected modelSessions: Marisa.Chat.Completion.CompletionSession[] = []
    protected registeredTools: Marisa.Tool.AnyToolParam[] = []

    constructor(sessions?: Marisa.Chat.Completion.CompletionSession[]) {
        super()
        const modelSession = (sessions?.length ? sessions : null) || []
        if (modelSession && modelSession.length) {
            const len = modelSession.length
            this.modelSessions = modelSession.slice(len - this.modelSessionWindowLength, len)
        }
    }

    protected createAddContextFunction(contextWorkspace: string) {
        const func = (session: Marisa.Chat.Completion.CompletionSession) => {
            if (this.modelSessions.length >= this.modelSessionWindowLength) {
                this.modelSessions.shift()
            }
            this.modelSessions.push(session)
            const contextFile = path.join(contextWorkspace, 'contexts.jsonl')
            const jsonl = new JSONL<Marisa.Chat.Completion.CompletionSession>()
            if (existsSync(contextFile)) {
                jsonl.parseFile(contextFile)
            }
            jsonl.add(session)
            jsonl.toFile(contextFile)
            this.emit('sessionSave', contextFile)
        }
        return func
    }

    protected loadSessionToContext(contextsWorkspace: string) {
        const contextFile = path.join(contextsWorkspace, 'contexts.jsonl')
        if (existsSync(contextFile)) {
            const sessions = new JSONL<Marisa.Chat.Completion.CompletionSession>().parseFile(contextFile).toArray()
            this.modelSessions.push(...sessions)
        }
    }

    public createEmptySession(): Marisa.Chat.Completion.CompletionSession {
        const session: Marisa.Chat.Completion.CompletionSession = {
            messages: [],
            sessionId: Date.now(),
            usage: {
                prompt_tokens: 0,
                total_tokens: 0,
                completion_tokens: 0
            },
            timestamp: Date.now()
        }
        return session
    }


    protected getFileDumpDate() {
        const date = new Date()
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        return `${year}-${month}-${day}`
    }

    protected filterSessions(sessionCount: number = 5, keepCount: number = 3): Marisa.Chat.Completion.CompletionSession[] {
        const sessions = this.modelSessions.slice(-(sessionCount));
        const totalSessions = sessions.length;
        const actualKeepCount = Math.min(keepCount, totalSessions);
        const keepStartIndex = totalSessions - actualKeepCount;
        const keepSessions = sessions.slice(keepStartIndex);
        const processSessions = sessions.slice(0, keepStartIndex);
        const processedSessions = processSessions.map(session => ({
            ...session,
            messages: session.messages?.map(message => {
                const newMessage = { ...message };

                if (newMessage.role === 'tool') {
                    newMessage.content = '';
                }
                else if (newMessage.role === 'assistant' && newMessage.tool_calls?.length) {
                    newMessage.tool_calls = newMessage.tool_calls.map(call => {
                        const newCall = { ...call };
                        if (newCall.type === 'function') {
                            newCall.function = { ...newCall.function, arguments: '{}' };
                        }
                        else if (newCall.type === 'custom') {
                            newCall.custom = { ...newCall.custom, input: '{}' };
                        }
                        return newCall;
                    });
                }
                return newMessage;
            })
        }));
        return [...processedSessions, ...keepSessions];
    }

    protected noSystemInject(sessions: Marisa.Chat.Completion.CompletionSession[]) {
        return sessions.map(session => ({
            ...session,
            messages: session.messages.filter(i => i.role !== 'system')
        }));
    }

    protected semantifyTimestamp(timestamp: number): string {
        const date = new Date(timestamp)
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const hours = date.getHours()
        const minutes = date.getMinutes()
        const seconds = date.getSeconds()
        const timePass = Date.now() - timestamp
        const passDays = Math.floor(timePass / (1000 * 60 * 60 * 24))
        return `[${year}-${month}-${day} ${hours}:${minutes}:${seconds}] (${passDays} days ago)`
    }

    protected registerTool(...tools: Marisa.Tool.AnyToolParam[]) {
        this.registeredTools.push(...tools)
    }

}


