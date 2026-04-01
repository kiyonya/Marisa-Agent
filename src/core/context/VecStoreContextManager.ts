import path from "node:path";
import { Marisa } from "../../types/marisa";
import EmbeddingModel from "../model/embedding/EmbeddingModel";
import { getWorkspacePath } from "../utils/workspace";
import VectorStore from "../vecstore/VectorStore";
import { ModelContextManager } from "./ModelContextManager";
import SqliteVecStore from "../vecstore/SqliteVecStore";
import chalk from "chalk";

type AllowStoreRole = 'user' | 'assistant' | 'developer'
interface METADATA {
    doc: string,
    time: number,
    role: AllowStoreRole
}

export default class VecStoreContextManager extends ModelContextManager {
    private embeddingModel: EmbeddingModel
    private dimensions: number
    private vectorStore: VectorStore<METADATA>
    private relevantRankLimit: number
    constructor(embeddingModel: EmbeddingModel, dimensions: number = 512, vectorStore?: VectorStore<METADATA>, limit: number = 5,sessions:Marisa.Chat.Completion.CompletionSession[] = []) {
        super(sessions)
        this.embeddingModel = embeddingModel
        this.dimensions = dimensions
        this.relevantRankLimit = limit
        const workspace = getWorkspacePath('vec')
        const dbFile = path.join(workspace, 'memory.db')
        this.vectorStore = vectorStore || new SqliteVecStore<METADATA>(dbFile, this.dimensions)
    }

    public override async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {
        const embeddingMessages: METADATA[] = []
        const time = session.timestamp
        for (const message of session.messages) {
            switch (message.role) {
                case "system":
                    break
                case "assistant":
                    if (typeof message.content === 'string') {
                        embeddingMessages.push({
                            doc: message.content,
                            time: time,
                            role: message.role
                        })
                    }
                    break
                case "developer":
                    if (typeof message.content === 'string') {
                        embeddingMessages.push({
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
                        embeddingMessages.push({
                            doc: message.content,
                            time: time,
                            role: message.role
                        })
                    }
                    break
            }

        }

        const embeddings = await this.embeddingModel.embedding(embeddingMessages.map(i => i.doc), this.dimensions)
        const datas = embeddings.data
        const inserts: { vector: Float32Array<ArrayBuffer>, metadata: METADATA }[] = []
        for (const embd of datas) {
            const dindex = embd.index
            const raw = embeddingMessages[dindex]
            const vectors = embd.embedding || new Array<number>(this.dimensions).fill(0)
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
        await this.vectorStore.batchInsert(inserts)
        if (sessionPutCallback) {
            sessionPutCallback()
        }
    }

    public override async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {

        const embeddings = await this.embeddingModel.embedding(userPrompt, this.dimensions)
        const vectors = embeddings.data[0]?.embedding || new Array<number>(this.dimensions).fill(0)
        const f32array = new Float32Array(vectors)

        const relevant = await this.vectorStore.search(f32array, undefined, { limit: this.relevantRankLimit, orderBy: 'distance' })
        console.log(chalk.bgBlue.white(`找到以下信息进行参照\n${relevant.map(u => u.metadata?.doc).join('\n')}\n`))
        const messages = relevant.map(i => i.metadata).map(this.releventToMessage)
        const relevantSession = this.createEmptySession()
        relevantSession.messages = messages.filter(i => i !== null)
        const sessions = this.filterSessions(3, 2)

        return [this.noSystemInject([relevantSession, ...sessions]), '']
    }

    private releventToMessage(rel?: METADATA) {
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
}