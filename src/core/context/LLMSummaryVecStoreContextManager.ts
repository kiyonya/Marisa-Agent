import path from "node:path";
import { Marisa } from "../../types/marisa";
import EmbeddingModel from "../model/embedding/EmbeddingModel";
import { getWorkspacePath } from "../utils/workspace";
import SqliteVecStore from "../vecstore/SqliteVecStore";
import VectorStore from "../vecstore/VectorStore";
import { ModelContextManager } from "./ModelContextManager";
import Model from "../model/Model";
import z from "zod";
import LocalTool from "../tool/LocalTool";
import chalk from "chalk";

export default class LLMSummaryVecStoreContextManager extends ModelContextManager {

    private model: Model
    private embeddingModel: EmbeddingModel
    private vectorStore: VectorStore<{ doc: string, time: number }>
    private modelToolMap: Map<string, Marisa.Tool.AnyTool> = new Map<string, Marisa.Tool.AnyTool>()
    private dimensions: number = 512
    constructor(model: Model, embeddingModel: EmbeddingModel, dimensions: number = 512, vectorStore?: VectorStore<{ doc: string, time: number }>) {
        super()
        this.model = model
        this.embeddingModel = embeddingModel
        this.dimensions = dimensions
        const workspace = getWorkspacePath('vec')
        const dbFile = path.join(workspace, 'memory.db')
        this.vectorStore = vectorStore || new SqliteVecStore<{ doc: string, time: number }>(dbFile, this.dimensions)
        this.createToolMap()
    }

    private async writeMemory(content: string, time: number): Promise<boolean> {

        const embeddings = await this.embeddingModel.embedding(content, this.dimensions)
        const vectors = embeddings.data[0]?.embedding || new Array<number>(this.dimensions).fill(0)
        const f32array = new Float32Array(vectors)

        await this.vectorStore.insert(f32array, {
            doc: content,
            time: Number(time) || Date.now()
        })

        return true
    }

    private createToolMap() {

        const writeMemoryTool = new LocalTool<{ content: string, timestamp: number }>(
            'write_memory',
            `使用这个工具将总结好的记忆存入数据库，你需要提供总结的内容和时间`,
            async ({ content, timestamp }) => {

                console.log(chalk.bgBlue.white(content))
                try {
                    await this.writeMemory(content, timestamp)
                } catch (error) {

                }
                return true
            },
            {
                content: z.string(),
                timestamp: z.number(),
            }
        )

        this.modelToolMap.set('write_memory', writeMemoryTool)
    }

    public override async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {

        this.modelSessions.push(session)
        await this.saveContext(session)

        let currentMessages: string[] = []
        for (const message of session.messages) {
            if (message.role === 'user') {
                currentMessages.push(`[${session.timestamp}:用户消息] ${message.content}`)
            }
            else if (message.role === 'assistant' && message.content && typeof message.content === 'string') {
                currentMessages.push(`[${session.timestamp}:回复消息] ${message.content}`)
            }
        }

        const prompt = `
        请阅读后总结下面这段聊天记录，并且使用工具进行分类存储你认为有必要长期记忆存储的

        ## 重要提示
        1. 只要必要的时候你才调用工具存储,每条消息前的数字为时间戳，你需要携带
        2. 如果你认为没有必要存储信息，请结束会话
        3. 存储时每个类别的内容应该简洁明了，提取关键信息即可
        4. 你只能记录那些用户明确说过的内容，不能出现可能性的表达，如果用户没有明确说，请不要记录
        5. 当用户明确表示请记住的时候，这个内容必须写入

        ## 你需要记录的内容例如
        - 用户喜欢吃草莓蛋糕
        - 用户身高180cm

        ## 你应该忽略的内容例如
        - 我今天走路摔了一跤
        - 我现在有点无聊
        - 用户提供了一段代码

        ## 当前对话记录
        ${currentMessages.join('\n')}
        `
        this.model.defineSystemPrompt('你是一个总结大师，你只需要总结应该总结的事情')
        const completion = await this.model.complete(prompt, this.modelToolMap)
        console.log(completion)
        if (sessionPutCallback) {
            sessionPutCallback()
        }
    }

    public override async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {
        const historySessions = this.filterSessions(5, 2)
        const embeddings = await this.embeddingModel.embedding(userPrompt, this.dimensions)
        const vectors = embeddings.data[0]?.embedding || new Array<number>(this.dimensions).fill(0)
        const f32array = new Float32Array(vectors)

        const datas = await this.vectorStore.search(f32array, undefined, { limit: 5, orderBy: 'distance' })

        const relativeMessages: string[] = []
        for (const data of datas) {
            const time = data.metadata?.time
            const doc = data.metadata?.doc
            if (doc && time) {
                relativeMessages.push(`[${this.fmtTmstp(time)}] ${doc}`)
            }
        }

        const addition = relativeMessages.length ? `## 数据查找到以下有关信息供参考\n${relativeMessages.join('\n')}` : ''

        console.log(`\n${chalk.blue(addition)}\n`)
        return [this.noSystemInject(historySessions), addition]
    }

    public fmtTmstp(timestampms: number) {
        const date = new Date(timestampms)
        const y = date.getFullYear()
        const m = date.getMonth() + 1
        const d = date.getDate()
        const dayEnum: Record<number, string> = {
            0: "星期天",
            1: "星期一",
            2: "星期二",
            3: "星期三",
            4: "星期四",
            5: "星期五",
            6: "星期六",
        }
        const h = date.getHours()
        const min = date.getMinutes()
        const s = date.getSeconds()
        const da = dayEnum[date.getDay()]
        return `${y}-${m}-${d},${da} ${h}:${min}:${s}`
    }

}