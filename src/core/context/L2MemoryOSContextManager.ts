import z from "zod";
import { Marisa } from "../../types/marisa";
import TextScore from "../alg/textscore/TextScore";
import EmbeddingModel from "../model/embedding/EmbeddingModel";
import Model from "../model/Model";
import LocalTool from "../tool/LocalTool";
import VectorStore from "../vecstore/VectorStore";
import { ModelContextManager } from "./ModelContextManager";
import path from "node:path";
import { existsSync, readFileSync, writeFile, writeFileSync } from "fs-extra";
import FormatPrint from "../use/format_print";
import chalk from "chalk";
import SqliteVecStore from "../vecstore/SqliteVecStore";
import { deepClone } from "../utils/base";
import PQueue from 'p-queue';

type AllowStoreRole = 'user' | 'assistant' | 'developer'

interface Metadata {
    doc: string,
    time: number,
    role: AllowStoreRole
}

const systemPrompt = `
你需要严格按照下列要求完成任务

## 重要说明
- 你应该更加倾向存储用户说的，而非人工智能助手说的事情
- 你需要严格按照操作方法和工具的描述做事
- 消息不是每条都要存储，你要有所取舍，保留最值得存储的事情

## 操作方法
1. 你可以使用 append_event 工具添加事件 ，例如用户说明最近正在做的一些事情，用户的想法，用户的一些评价，或者人工智能的一些回答，你需要对内容总结成一段话，并且区分好角色进行存储
2. 你可以在对话中调用 update_longterm_memory 工具来更新用户的长期记忆。
调用规则：
仅当用户明确表达以下信息时，才调用该工具进行记忆更新：
用户的基本信息（如名字、称呼、性别、年龄等）
用户的喜好（如兴趣爱好、喜欢的事物、喜欢的交流方式等）
用户的雷点（如不喜欢的话题、讨厌的称呼、反感的内容等）
可用于完善用户画像的稳定、长期有效的个人信息
不因临时性、一次性或无关紧要的对话内容调用记忆更新。
更新记忆时，需对已有记忆进行合并、去重或修正，确保存储内容简洁、无矛盾。
调用工具时，请传入更新后的完整记忆作为参数，而非仅写入新增内容。

3. 每条记忆你都需要进行压缩，只保留关键的信息，去掉干扰性的信息
4. 你记录的每条记忆都是用户确切表述的，不存在可能，或许这类不确定的表达
5. 当用户明确要求记住的事情，必须存储
6. 当用户的信息只是随便说说，或者没有存储的意义，你不应该存储
7. 如果你认为没有任何需要更新或者变动的，请立即结束会话
8. 每条消息组成为 [消息时间戳][角色] 消息内容
`
export default class L2MemoryOSContextManager extends ModelContextManager {

    private pendingSessions = new Set<Marisa.Chat.Completion.CompletionSession>()
    private hotMemoryLength = 5
    private relevantRankLimit: number = 5
    private embeddingModel: EmbeddingModel
    private embeddingDimensions: number = 512
    private chatModel: Model
    private vectorStore: VectorStore<Metadata>

    private putToolMap: Map<string, Marisa.Tool.AnyTool> = new Map()
    private tempAppendEvents: Metadata[] = []
    private tempMemoryUpdate: string = ''

    private pendingConsolidateSessionsSet = new Set<Marisa.Chat.Completion.CompletionSession[]>()
    private consolidateQueue = new PQueue({ concurrency: 1 })

    constructor(sessions: Marisa.Chat.Completion.CompletionSession[], chatModel: Model, embeddingModel: EmbeddingModel, vectorStore?: VectorStore<Metadata>) {
        super(sessions)
        this.chatModel = chatModel
        this.embeddingModel = embeddingModel
        const store = this.getWorkspace('memories')
        this.vectorStore = vectorStore || new SqliteVecStore<Metadata>(path.join(store, 'vecstore.db'), this.embeddingDimensions)
        this.putToolMap = this.createPutToolMap()

        const pendingSessionSaves = this.readPendingSessionsState() || []
        for (const session of pendingSessionSaves) {
            this.addPendingSession(session)
        }

    }

    public override async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {

        this.addSession(session)
        this.addPendingSession(session)
        sessionPutCallback && sessionPutCallback()
        this.emit('sessionPut', session)
    }

    public addPendingSession(session: Marisa.Chat.Completion.CompletionSession) {

        //靠北啦
        const cloneSession = deepClone(session)
        const lastPendingArray = [...this.pendingConsolidateSessionsSet][-1]
        if (!lastPendingArray || lastPendingArray.length > this.hotMemoryLength) {
            const insertArray: Marisa.Chat.Completion.CompletionSession[] = []
            insertArray.push(cloneSession)
            this.pendingConsolidateSessionsSet.add(insertArray)
        }
        else {
            lastPendingArray.push(cloneSession)
        }
        this.savePendingSessionsState()

        if (lastPendingArray && lastPendingArray.length > this.hotMemoryLength) {
            this.consolidateQueue.add(() => this.consolidate(lastPendingArray)).then(() => {
                this.pendingConsolidateSessionsSet.delete(lastPendingArray)
                this.savePendingSessionsState()
            })
        }
    }

    public savePendingSessionsState() {
        const allPendingSessions = [...this.pendingConsolidateSessionsSet].flat()
        const temp = this.getWorkspace('temp')
        const tempPendingFile = path.join(temp, 'mos_pending_sessions.json')
        writeFileSync(tempPendingFile, JSON.stringify(allPendingSessions), 'utf-8')
    }

    public readPendingSessionsState(): Marisa.Chat.Completion.CompletionSession[] {
        const temp = this.getWorkspace('temp')
        const tempPendingFile = path.join(temp, 'mos_pending_sessions.json')
        if (existsSync(tempPendingFile)) {
            const sessions: Marisa.Chat.Completion.CompletionSession[] = JSON.parse(readFileSync(tempPendingFile, 'utf-8'))
            return sessions
        }
        return []
    }

    private readCurrentLongtermMemory(): string {
        const memories = this.getWorkspace('memories')
        const longfile = path.join(memories, 'Memory.md')
        if (existsSync(longfile)) {
            const content = readFileSync(longfile, 'utf-8')
            return content
        }
        return ''
    }

    private createPutToolMap(): Map<string, Marisa.Tool.AnyTool> {

        const appenEventTool = new LocalTool<{ content: string, time: number, role: AllowStoreRole }>('append_event', '添加事件', async ({ content, time, role }) => {
            time = Number(time)
            if (!['user', 'assistant', 'developer'].includes(role)) {
                role === 'developer'
            }
            if (content) {
                this.tempAppendEvents.push({
                    role: role,
                    time: time,
                    doc: content
                })
            }
            return true
        },
            {
                content: z.string().describe('总结后的文本,一段话表述主要事件/决策/主题/观念等信息'),
                time: z.number().describe("信息时间戳"),
                role: z.enum(['user', 'assistant', 'developer']).describe('存储的角色类型')
            }
        )

        const updateLongtermMemoryTool = new LocalTool<{ content: string }>('update_longterm_memory', '更新长期记忆', ({ content }) => {
            this.tempMemoryUpdate = content
            return true
        },
            {
                content: z.string().describe('总结后的完整记忆内容，条目之间要使用换行符分割')

            })

        const toolMap = new Map<string, Marisa.Tool.AnyTool>()
        toolMap.set(appenEventTool.toolName, appenEventTool)
        toolMap.set(updateLongtermMemoryTool.toolName, updateLongtermMemoryTool)

        return toolMap
    }

    private async consolidate(sessions: Marisa.Chat.Completion.CompletionSession[]) {
        const preprocessedMetadatas = this.filterMetadata(sessions)
        const messages: string[] = []
        for (const metadata of preprocessedMetadatas) {
            messages.push(`[${metadata.time}][${metadata.role}] ${metadata.doc}`)
        }
        const prompt = `
        请根据下面的内容进行总结，提取关键信息，并且调用工具存储信息

        ## 以下为聊天消息
        ${messages.join('\n')}

        ## 以下为当前长期记忆
        ${this.readCurrentLongtermMemory()}
        `
        this.chatModel.defineSystemPrompt(systemPrompt)
        this.chatModel.defineCompletionOptions({
            temperature: 0,
            parallelToolCalls: true,
            toolChoice: 'auto'
        })
        this.chatModel.on('toolCallResult', FormatPrint.printToolCallResult)
        try {
            const completion = await this.chatModel.complete(prompt, undefined, this.putToolMap)
            this.emit('consolidated', completion)
        } catch (error) {
            console.error(error)
            const keepLength = 5
            this.tempAppendEvents = preprocessedMetadatas.slice(0, keepLength)
            this.tempMemoryUpdate = ''
        }

        await Promise.all([this.storeEvents(), this.storeMemories()])
        this.emit('consolidateSave')
    }

    private async storeEvents() {

        if (!this.tempAppendEvents.length) { return }
        const embeddingTexts: string[] = this.tempAppendEvents.map(i => i.doc)
        const embeddings = await this.embeddingModel.embedding(embeddingTexts, this.embeddingDimensions)
        const datas = embeddings.data
        const inserts: { vector: Float32Array<ArrayBuffer>, metadata: Metadata }[] = []
        for (const embd of datas) {
            const dindex = embd.index
            const raw = this.tempAppendEvents[dindex]
            const vectors = embd.embedding || new Array<number>(this.embeddingDimensions).fill(0)
            const f32 = new Float32Array(vectors)
            if (raw?.doc && raw.time && f32) {
                inserts.push({
                    metadata: {
                        doc: raw.doc,
                        time: raw.time,
                        role: raw.role
                    },
                    vector: f32
                })
            }
        }
        const filteredInserts: { vector: Float32Array<ArrayBuffer>, metadata: Metadata }[] = []
        for (const insert of inserts) {
            const search = await this.vectorStore.search(insert.vector)
            if (search.some(i => i.distance <= 0.1)) {
                console.log('跳过当前插入', insert.metadata.doc)
                continue
            }
            else {
                filteredInserts.push(insert)
            }
        }
        if (filteredInserts.length) {
            await this.vectorStore.batchInsert(filteredInserts)
        }

        this.tempAppendEvents = []
    }

    private async storeMemories() {
        if (!this.tempMemoryUpdate) { return }
        const memories = this.getWorkspace('memories')
        const longfile = path.join(memories, 'Memory.md')
        await writeFile(longfile, this.tempMemoryUpdate, 'utf-8')
        this.tempMemoryUpdate = ''
    }

    private filterMetadata(sessions: Marisa.Chat.Completion.CompletionSession[]): Metadata[] {
        const metadatas: Metadata[] = []

        for (const session of sessions) {
            metadatas.push(...this.extractMessages(session))
        }
        const metaLength = metadatas.length
        const keepMetaLength = Math.floor(metaLength * 1)

        type MetadataWithScore = Metadata & { score: number }

        const scoredMetadatas: MetadataWithScore[] = []
        for (const metadata of metadatas) {
            const score = TextScore.EntropyScore(metadata.doc)
            scoredMetadatas.push({ ...metadata, score: score })
        }

        const keepMetadata: Metadata[] = scoredMetadatas.sort((a, b) => b.score - a.score).slice(0, keepMetaLength).map(({ doc, time, role }) => ({ doc, time, role }))

        return metadatas
    }

    private extractMessages(session: Marisa.Chat.Completion.CompletionSession): Metadata[] {
        const extractMessages: Metadata[] = []
        for (const message of session.messages) {
            const time = message.timestamp || session.timestamp
            switch (message.role) {
                case "system":
                    break
                case "assistant":
                    if (typeof message.content === 'string') {
                        extractMessages.push({
                            doc: message.content,
                            time: time,
                            role: message.role
                        })
                    }
                    break
                case "developer":
                    if (typeof message.content === 'string') {
                        extractMessages.push({
                            doc: message.content,
                            time: time,
                            role: message.role,
                        })
                    }
                    break
                case "tool":
                    break
                case "user":
                    if (typeof message.content === 'string') {
                        extractMessages.push({
                            doc: message.content,
                            time: time,
                            role: message.role
                        })
                    }
                    break
            }
        }
        return extractMessages
    }

    public override async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {
        const hotSessions = this.filterSessions(this.hotMemoryLength, this.hotMemoryLength)
        const embeddings = await this.embeddingModel.embedding(userPrompt, this.embeddingDimensions)
        const vectors = embeddings.data[0]?.embedding || new Array<number>(this.embeddingDimensions).fill(0)
        const f32array = new Float32Array(vectors)

        const relevant = await this.vectorStore.search(f32array, undefined, { limit: this.relevantRankLimit, orderBy: 'distance' })
        const messages = relevant.map(i => i.metadata).map(this.releventToMessage)
        const relevantSession = this.createEmptySession()
        relevantSession.messages = messages.filter(i => i !== null)
        const currentLongtermMemory = this.readCurrentLongtermMemory()
        //进行BM25
        const querySessions = [relevantSession, ...hotSessions]
        this.emit('sessionQuery', userPrompt, querySessions, currentLongtermMemory, `向量数据库找到 ${relevant.length} 条相关记忆`)
        return [this.noSystemInject(querySessions), currentLongtermMemory]
    }

    private releventToMessage(rel?: Metadata) {
        if (!rel) {
            return null
        }
        switch (rel.role) {
            case "user":
                const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
                    role: 'user',
                    content: rel.doc,
                    timestamp: rel.time,
                }
                return userMessage
            case "assistant":
                const assistantMessage: Marisa.Chat.Completion.Messages.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: rel.doc,
                    timestamp: rel.time
                }
                return assistantMessage
            case "developer":
                const developerMessage: Marisa.Chat.Completion.Messages.ChatCompletionDeveloperMessage = {
                    role: 'developer',
                    content: rel.doc,
                    timestamp: rel.time
                }
                return developerMessage
        }
        return null
    }

    public async dream() {
        const sessions = this.modelSessions
        await this.consolidate(sessions)
    }

}