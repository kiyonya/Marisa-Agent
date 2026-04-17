import z from "zod";
import { Marisa } from "../../types/marisa";
import Model from "../model/Model";
import LocalTool from "../tool/LocalTool";
import ModelToolBuilder from "../builder/ModelToolBuilder";
import { ModelContextManager } from "./ModelContextManager";
import { getWorkspacePath } from "../utils/workspace";
import path from "node:path";
import { existsSync, readFile } from "fs-extra";
import { Stack } from "../utils/stack";
import jieba from 'nodejieba'
import JSONL from "../utils/jsonl";
import BM25 from "../alg/BM25";

interface MemoryDumpJSONL {
    tokens: string[],
    content: string,
    time: number,
}

export default class LLMSummaryFileContextManager extends ModelContextManager {

    private model: Model
    private summaryPrompt = '你是一个总结大师，你需要总结我给你的文本内容，然后提取关键信息，之后存储到类别'
    private summaryTypes = {
        user: '用户的相关喜好，用户画像，用户的基本信息',
        longterm: '长期记忆，你认为十分有必要长期记忆的内容',
        neverdo: '永远不要尝试做的事情，用户很反感的事情',
    }
    private modelToolMap: Map<string,Marisa.Tool.AnyTool> = new Map<string,Marisa.Tool.AnyTool>()
    private modelPendingSummaryMessages = new Stack<string[]>(3)

    constructor(model: Model,sessions?:Marisa.Chat.Completion.CompletionSession[]) {
        super(sessions)
        this.model = model
        model.defineSystemPrompt(this.summaryPrompt)
        model.defineCompletionOptions({
            temperature: 0
        })
        this.createToolMap()
    }

    private async readMemory(type: string): Promise<string> {
        const memoryDir = getWorkspacePath('memory')
        const file = path.join(memoryDir, `${type}.jsonl`)
        if (!existsSync(file)) {
            return ""
        }
        else {
            return await readFile(file, 'utf-8')
        }
    }

    private async writeMemory(type: string, content: string,time:number) {
        time = Number(time)
        const contentTokens: string[] = jieba.cut(content)
        const contentLine: MemoryDumpJSONL = {
            content: content,
            tokens: contentTokens,
            time:time
        }
        const memoryDir = getWorkspacePath('memory')
        const file = path.join(memoryDir, `${type}.jsonl`)

        const jsonl = new JSONL<MemoryDumpJSONL>()
        if (existsSync(file)) {
            jsonl.parseFile(file)
        }
        jsonl.add(contentLine).toFile(file)
    }

    private createToolMap(){
        let typesDescription = '\n\n' + Object.entries(this.summaryTypes).map((i) => `${i[0]}:${i[1]}`).join('\n')
        const writeMemoryTool = new LocalTool<{ type: string, content: string,timestamp:number }>(
            'write_memory',
            `将新的内容写入到记忆文件，你需要提供记忆的类型和记忆的条目内容，你可以写入的类型有 ${typesDescription}`,
            async ({ type, content,timestamp }) => {
                try {
                    await this.writeMemory(type, content,timestamp)
                } catch (error) {

                }
                return true
            },
            {
                type: z.enum(Object.keys(this.summaryTypes)),
                content: z.string(),
                timestamp:z.number(),
            }
        )

        this.modelToolMap.set('write_memory',writeMemoryTool)
    }

    public override async put(currentSession: Marisa.Chat.Completion.CompletionSession, _: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {
        this.modelSessions.push(currentSession)
        this.saveContext(currentSession)

        let currentMessages: string[] = []
        for (const message of currentSession.messages) {
            if (message.role === 'user') {
                currentMessages.push(`[${currentSession.timestamp}:用户消息] ${message.content}`)
            }
            else if (message.role === 'assistant' && message.content && typeof message.content === 'string') {
                currentMessages.push(`[${currentSession.timestamp}:回复消息] ${message.content}`)
            }
        }

        if (this.modelPendingSummaryMessages.full()) {
            const allMessages: string[] = []
            for (const messages of this.modelPendingSummaryMessages) {
                allMessages.push(...messages)
            }

            const prompt = `
        请阅读后总结下面这段聊天记录，并且使用工具进行分类存储你认为有必要长期记忆存储的

        ## 重要提示
        1. 你需要给出记忆的类型和要记忆的条目
        2. 你需要调用工具存储,每条消息前的数字为时间戳，你需要携带
        3. 如果你认为没有必要存储信息，请结束会话
        4. 存储时每个类别的内容应该简洁明了，提取关键信息即可
        5. 你只能记录那些用户明确说过的内容，不能出现可能性的表达，如果用户没有明确说，请不要记录
        6. 当用户明确表示请记住的时候，这个内容必须写入

        ## 你需要记录的内容例如
        - 用户喜欢吃草莓蛋糕
        - 用户身高180cm

        ## 你应该忽略的内容例如
        - 我今天走路摔了一跤
        - 我现在有点无聊

        ## 当前对话记录
        ${allMessages.join('\n')}
        `
            const completeSession = await this.model.complete(prompt, undefined,this.modelToolMap)
            sessionPutCallback && sessionPutCallback()
            console.log(completeSession)
            this.modelPendingSummaryMessages.clear()
        }

        this.modelPendingSummaryMessages.push(currentMessages)
        this.emit('sessionPut',currentSession)
    }

    public fmtTmstp(timestampms:number){
        const date = new Date(timestampms)
        const y = date.getFullYear()
        const m = date.getMonth() + 1
        const d = date.getDate()
        const dayEnum:Record<number,string> = {
            0:"星期天",
            1:"星期一",
            2:"星期二",
            3:"星期三",
            4:"星期四",
            5:"星期五",
            6:"星期六",
        }
        const h = date.getHours()
        const min = date.getMinutes()
        const s = date.getSeconds()
        const da = dayEnum[date.getDay()]
        return `${y}-${m}-${d},${da} ${h}:${min}:${s}`
    }

    public override async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {
        const beforeSessions = this.filterSessions(5, 3)
        const memoryDir = getWorkspacePath('memory')
        const longterm = path.join(memoryDir, 'longterm.jsonl')
        const longtermMemories: string[] = []
        if (existsSync(longterm)) {
            const saves = new JSONL<MemoryDumpJSONL>().parseFile(longterm).toArray()
            for (const save of saves) {
                if (save.content) {
                    longtermMemories.push(`[${this.fmtTmstp(save.time)}] ${save.content}`)
                }
            }
        }

        const subMemoriesJSONL: MemoryDumpJSONL[] = []
        const types = Object.keys(this.summaryTypes)
        for (const type of types) {
            const file = path.join(memoryDir, `${type}.jsonl`)
            if (existsSync(file)) {
                const saves = new JSONL<MemoryDumpJSONL>().parseFile(file).toArray()
                subMemoriesJSONL.push(...saves)
            }
        }
        
        const now = Date.now()
        const validSubMemories = subMemoriesJSONL.filter(m => (now - m.time) <= 5 * 24 * 3600 * 1000)
        validSubMemories.sort((a, b) => b.time - a.time)

        const userPromptTokens = jieba.cut(userPrompt)
        const subMemoriesTokens: string[][] = validSubMemories.map(i => i.tokens)

        const topks = new BM25(subMemoriesTokens).getTopK(userPromptTokens, 10).filter(i=>i.score >= 0.8)
        const filteredSubMemories: string[] = []
        for (const i of topks) {
            const v = validSubMemories[i.index]?.content
            const t = validSubMemories[i.index]?.time
            if (v && t) {
                filteredSubMemories.push(`[${this.fmtTmstp(t)}] ${v}`)
            }
        }
        const promptAddition = longtermMemories.length || filteredSubMemories.length ? `
        ## 数据查找到以下有关信息供参考
        ${longtermMemories.join('\n')}
        ${filteredSubMemories.join('\n')}
        ` : ''

       this.emit('sessionQuery',userPrompt,beforeSessions,promptAddition,'')
        return [this.noSystemInject(beforeSessions), promptAddition]
    }
}