import OpenAI from "openai"
import { Marisa } from "../../../types/marisa"
import ModelSessionView from "../../model/chat/model-session-view"
import { ensureDirSync, existsSync, readdirSync, readFile, readFileSync, writeFileSync } from "fs-extra"
import path from "path"
import { getWorkspacePath } from "../../utils/workspace"
import ChatModelComponent from "../../model/chat/chat-model-component"
import JSONL from "../../utils/jsonl"
import SqliteVecStore from "../../store/vector/sqlite-vector-store"
import SqliteBM25MessageStore from "../../store/messages/sqlite-bm25-message-store"
import SqliteHybridStore from "../../store/hybrid/sqlite-hybrid-store"

export type MemoryCategoryAllowedType = 'user' | 'feedback' | 'reference'

export interface CategoryMemoryMetadata {
    type: MemoryCategoryAllowedType,
    description: string,
    time: number,
    name: string
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

    protected static memoryCategories: MemoryCategoryAllowedType[] = ['user', 'feedback', 'reference']
    constructor() {
        super(['consolidateSave', 'consolidated', 'sessionPut', 'sessionQuery', 'sessionSave'])
    }

    //longterm
    protected readLongtermMemory(): string {
        const memoriesDir = this.getWorkspace('memories')
        const longtermMemoryFile = path.join(memoriesDir, 'longterm.md')
        if (existsSync(longtermMemoryFile)) {
            return readFileSync(longtermMemoryFile, 'utf-8')
        }
        else {
            return ""
        }
    }

    protected updateLongtermMemory(content: string): void {
        const memoriesDir = this.getWorkspace('memories')
        const longtermMemoryFile = path.join(memoriesDir, 'longterm.md')
        writeFileSync(longtermMemoryFile, content, 'utf-8')
    }

    //category
    protected readCategoryMemoryMetadatas(): Partial<Record<MemoryCategoryAllowedType, CategoryMemoryMetadata[]>> {
        const result: Partial<Record<MemoryCategoryAllowedType, CategoryMemoryMetadata[]>> = {}
        const submemoryDir = this.getWorkspace('memories/categories')
        for (const dirname of ModelContextIOEssential.memoryCategories) {
            const dir = path.join(submemoryDir, dirname)
            if (existsSync(dir)) {
                const submemoryMetadatas: CategoryMemoryMetadata[] = []
                const items = readdirSync(dir).filter(i => path.extname(i) === '.json').map(i => path.join(dir, i))
                for (const item of items) {
                    try {
                        const data = JSON.parse(readFileSync(item, 'utf-8')) as CategoryMemory
                        const metadata = data.metadata
                        if (!data.metadata) { continue }
                        submemoryMetadatas.push(metadata)
                    } catch (error) {

                    }
                }
                if (submemoryMetadatas.length) {
                    result[dirname] = submemoryMetadatas
                }
            }
        }
        return result
    }

    protected readCategoryMemory(type: MemoryCategoryAllowedType, name: string): string | null {
        const memoryPath = path.join(this.getWorkspace('memories/categories'), `${type}/${name}.json`)
        if (existsSync(memoryPath)) {
            try {
                const data = readFileSync(memoryPath, 'utf-8')
                return data
            } catch (error) {
                return null
            }
        }
        return null
    }

    public createOrUpdateCategoryMemory(type: MemoryCategoryAllowedType, name: string, subMemory: CategoryMemory) {
        if (type && name) {
            const memoryPath = path.join(this.getWorkspace('memories/categories'), `${type}/${name}.json`)
            const dir = path.dirname(memoryPath)
            ensureDirSync(dir)
            writeFileSync(memoryPath, JSON.stringify(subMemory, null, 4))
        }
    }

    //category - publish
    public buildMemoryCategoriesIndex(): string {
        const modelSubMemoryMetadatas = this.readCategoryMemoryMetadatas()
        let storedSubMemoryNames = ''
        for (const type in modelSubMemoryMetadatas) {
            const metadatas = modelSubMemoryMetadatas[type as MemoryCategoryAllowedType] || []
            storedSubMemoryNames += `### 类型 ${type}\n`
            for (const metadata of metadatas) {
                storedSubMemoryNames += `- 记忆名称：${metadata.name},记忆描述：${metadata.description}\n`
            }
        }
        return storedSubMemoryNames
    }
}

export abstract class ModelContextManager extends ModelContextIOEssential {

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

    protected addSession(session: Marisa.Chat.Completion.CompletionSession) {
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

    protected createEmptySessionView() {
        return new ModelSessionView(this.createEmptySession())
    }

    protected createEmptyVectorStore<Metadata extends Record<string, any>>(dimension: number = 512) {
        const vecstorePath = path.join(this.getWorkspace('memories/vector'), 'memory_vector.db')
        return new SqliteVecStore<Metadata>(vecstorePath, dimension)
    }

    protected createEmptyMessageStore() {
        const searchDBPath = path.join(this.getWorkspace('memories/search'), 'message_search.db')
        return new SqliteBM25MessageStore(searchDBPath)
    }

    protected createEmptyHybridStore<Metadata extends Record<any, any> = any>(dimension: number = 512) {
        const hybridStorePath = path.join(this.getWorkspace('memories/hybrid'), 'hybrid_store.db')
        return new SqliteHybridStore<Metadata>(hybridStorePath, dimension)
    }

    protected createUserMessage(userPrompt: string) {
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
        this.emit('sessionSave', contextFile)
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


}


