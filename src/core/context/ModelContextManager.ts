import OpenAI from "openai"
import { Marisa } from "../../types/marisa"
import ModelSessionView from "../session/ModelSessionView"
import { ensureDir, existsSync, readFile, writeFile } from "fs-extra"
import path from "path"
import { getWorkspacePath } from "../utils/workspace"
import ModelComponent from "../base/ModelComponent"
import JSONL from "../utils/jsonl"

interface CompletionSessionWithStatus extends Marisa.Chat.Completion.CompletionSession {
    consolidate: boolean
}

/**
 * when things pass just let it go
 * you never care about what you say in your age 3
 * it's doesn't matter
 * i dont care about what context manager you used before
 * i just care about whether i should save your context now
 * y o l o
 */


export abstract class ModelContextManager extends ModelComponent {

    protected modelSessionWindowLength: number = 20
    protected modelSessions: Marisa.Chat.Completion.CompletionSession[] = []

    constructor(sessions?: Marisa.Chat.Completion.CompletionSession[]) {
        super()
        const modelSession = (sessions?.length ? sessions : null) || this.readContext() || []
        if (modelSession && modelSession.length) {
            const len = modelSession.length
            this.modelSessions = modelSession.slice(len - this.modelSessionWindowLength, len)
        }
    }

    public addSession(session: Marisa.Chat.Completion.CompletionSession) {
        session = JSON.parse(JSON.stringify(session))
        if (this.modelSessions.length >= this.modelSessionWindowLength) {
            this.modelSessions.shift()
        }
        this.modelSessions.push(session)
        this.saveContext(session)
    }

    public abstract put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any>
    public abstract query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]>

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

    public createEmptySessionView() {
        return new ModelSessionView(this.createEmptySession())
    }

    public createUserMessage(userPrompt: string) {
        const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
            content: userPrompt,
            role: 'user',
            //@ts-ignore
            cache_control: { "type": "ephemeral" }
        }
        return userMessage
    }

    protected saveContext(session: Marisa.Chat.Completion.CompletionSession) {
        const workspace = getWorkspacePath('contexts')
        const contextFile = path.join(workspace, 'contexts.jsonl')
        const jsonl = new JSONL<Marisa.Chat.Completion.CompletionSession>()
        if (existsSync(contextFile)) {
            jsonl.parseFile(contextFile)
        }
        jsonl.add(session)
        jsonl.toFile(contextFile)
    }

    protected readContext(): Marisa.Chat.Completion.CompletionSession[] {
        const workspace = getWorkspacePath('contexts')
        const contextFile = path.join(workspace, 'contexts.jsonl')
        if (existsSync(contextFile)) {
            return new JSONL<Marisa.Chat.Completion.CompletionSession>().parseFile(contextFile).toArray()
        }
        else {
            return []
        }
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

}
