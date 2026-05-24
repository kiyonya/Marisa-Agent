import z from "zod";
import path from "node:path";
import crypto from 'crypto'
import fs from 'node:fs'
import chalk from "chalk";

import { Marisa } from "@type/marisa";
import { ModelContextManager } from "./model-context-manager";
import { deepClone } from "@core/utils/base";
import ChatModel from "@core/model/chat/chat-model";
import LocalTool from "@core/tool/local-tool";
import LongtermCategoricalMemoryStore from "../longterm/longterm-cmemory-manager";
import { SqliteLongtermCategoricalMemoryManager as SqliteLongtermCategoricalMemoryStore } from "../longterm/sqlite-longterm-cmemory";
import EmbeddingModel from "@core/model/embedding/embedding-model";
import { HybridStore, HybridStoreInsertItem } from "@core/store/hybrid/hybrid-store";
import SqliteHybridStore from "@core/store/hybrid/sqlite-hybrid-store";
import { HybridStoreQueryResult } from "@core/store/impl/result";
import DynamicTool from "@core/tool/dynamic-tool";
import XMLPromptTemplate from "@core/prompt/template/xml-prompt-template";

export interface MemoryOptions {
    singleSummarizeLength?: number,
    maxQueryMemoryLength?: number,
    hotMemoryLength?: number,
    simplifyHotMemoryLength?: number,
    hybridVectorWeight?: number,
    hybridKeywordWeight?: number,
    hybridScoreThreshold?: number
}

type AllowStoreRole = 'user' | 'assistant' | 'developer'
export type MemoryCategoryAllowedType = 'user' | 'feedback' | 'reference' | 'experience'

interface Metadata {
    content: string,
    time: number,
    role: AllowStoreRole,
}

interface LongtermCategoricalMemoryMetadata {
    name: string,
    type: MemoryCategoryAllowedType,
    description: string,
    keywords: string[],
    time: number
}

interface LongtermCategoricalMemory {
    metadata: LongtermCategoricalMemoryMetadata,
    content: string
}

interface EmbeddingKnowledge {
    referenceIds: string[], summary: string, keywords: string[]
}

export default class LayerMarisaMemorySystem extends ModelContextManager {

    protected readonly LONGTERM_MEMORY_TYPE = ['user', 'feedback', 'reference', 'experience']
    protected readonly LOAD_MEMORY_TOOL_NAME = 'LoadCategoricalMemory'
    protected readonly SEARCH_MEMORY_KNOWLEDGE_TOOL_NAME = 'SearchMemoryAndKnowledge'
    protected readonly MAX_SUMMARIZE_FAIL_COUNT = 3

    //store
    protected longtermCategoricalMemoryStore: LongtermCategoricalMemoryStore | null = null
    protected hybridKnowledgeStore: HybridStore | null = null

    public memoryOptions?: MemoryOptions
    protected summarizeSessionsPromise: Promise<void> | null = null
    protected pendingSummarizeQueue: Marisa.Chat.Completion.CompletionSession[] = []
    //model
    protected embeddingModel: EmbeddingModel | null = null
    protected embeddingDimension: number = 768
    protected summarizeChatModel: ChatModel | null = null
    protected savePendingSummarizeQueue: (() => void) | null = null
    protected addContextFunction: ((session: Marisa.Chat.Completion.CompletionSession) => void) | null = null

    public relevantKnowledgeHybridMethod?: (vectorQueryResult: HybridStoreQueryResult<Metadata>[], keywordQueryResult: HybridStoreQueryResult<Metadata>[], limit: number, vecWeight: number, keywordWeight: number, scoreThreshold: number) => HybridStoreQueryResult<Metadata>[] | Promise<HybridStoreQueryResult<Metadata>[]>

    constructor(summarizeChatModel?: ChatModel, embeddingModel?: EmbeddingModel, embeddingDimension?: number, longtermCategoricalMemoryStore?: LongtermCategoricalMemoryStore, hybridStore?: HybridStore, options?: MemoryOptions) {
        super()

        if (summarizeChatModel) {
            this.summarizeChatModel = summarizeChatModel
        }
        if (embeddingModel) {
            this.embeddingModel = embeddingModel
        }
        if (embeddingDimension) {
            this.embeddingDimension = embeddingDimension
        }
        if (options) {
            this.memoryOptions = options
        }

        this.installFunction = (installer, _modelInfo) => {

            this.loadContext(installer.getWorkspace('contexts'))
            this.addContextFunction = this.createAddContextFunction(installer.getWorkspace('contexts'))

            if (longtermCategoricalMemoryStore) {
                this.longtermCategoricalMemoryStore = longtermCategoricalMemoryStore
            }
            else {
                const longtermStorePath = path.join(installer.getWorkspace('memories/categories'), 'longterm.db')
                this.longtermCategoricalMemoryStore = new SqliteLongtermCategoricalMemoryStore(longtermStorePath)
            }

            if (hybridStore) {
                this.hybridKnowledgeStore = hybridStore
            }
            else {
                const hybridStorePath = path.join(installer.getWorkspace('memories/hybrid'), 'hybrid.db')
                this.hybridKnowledgeStore = new SqliteHybridStore(hybridStorePath, this.embeddingDimension)
            }

            if (this.hybridKnowledgeStore.embeddingDimension !== this.embeddingDimension) {
                throw new Error(`dimension of hybrid store ${this.hybridKnowledgeStore.embeddingDimension} is not equal with provided embedding dimension ${this.embeddingDimension}`)
            }

            const tempFilePath = path.join(installer.getWorkspace('temp'), 'pending_summarize_quene.json')

            if (fs.existsSync(tempFilePath)) {
                const queue = JSON.parse(fs.readFileSync(tempFilePath, 'utf-8')) as Marisa.Chat.Completion.CompletionSession[]
                this.pendingSummarizeQueue = queue
            }
            else {
                this.pendingSummarizeQueue = []
            }

            this.savePendingSummarizeQueue = () => {
                const queueArray = [...this.pendingSummarizeQueue]
                const tempFilePath = path.join(installer.getWorkspace('temp'), 'pending_summarize_quene.json')
                fs.writeFileSync(tempFilePath, JSON.stringify(queueArray, null, 4), 'utf-8')
            }

            const tools = this.buildAgentMemoryTool()
            installer.registerTool(...tools)
            installer.registerModelContextPutFunction(this.put.bind(this))
            installer.registerModelContextQueryFunction(this.query.bind(this))
            installer.registerSlashCommand('forget', () => {
                this.modelSessions = []
                console.log("已忘记上下文")
            })

            installer.registerSlashCommand('memoryDebug', (mode: string) => {
                if (mode === 'fsmrz') {
                    console.log("尝试强制总结")
                    this.tryProcessPendingSummarizeQuene(true)
                }
                else if (mode === 'clsp') {
                    this.pendingSummarizeQueue = []
                    this.savePendingSummarizeQueue?.()
                }
                else if (mode === 'lstp') {
                    console.log(this.pendingSummarizeQueue)
                }
            })
        }

    }

    protected async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void) {

        const copySession = deepClone(session)
        this.addContextFunction?.(copySession)
        this.appendSessionIntoPendingSummarizeQueue(copySession)

        if (sessionPutCallback) {
            sessionPutCallback()
        }
    }

    protected async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {

        const hotSessions = this.filterSessions(this.memoryOptions?.hotMemoryLength ?? 5, this.memoryOptions?.simplifyHotMemoryLength ?? 3)

        const hybridStoreQueryResult = await this.queryRelevantKnowledge(userPrompt) || []
        const relevantKnowledgeSession = this.createSessionFromHybridResult(hybridStoreQueryResult)

        const relevantReminderPrompt = "content include in tag <relevant-reminder></relevant-reminder> is a history relevant message for you to know,just accept it when it suitable"

        return [this.noSystemInject([relevantKnowledgeSession, ...hotSessions]), relevantReminderPrompt]
    }

    protected appendSessionIntoPendingSummarizeQueue(session: Marisa.Chat.Completion.CompletionSession) {
        this.pendingSummarizeQueue.push(session)
        this.savePendingSummarizeQueue?.()
        this.tryProcessPendingSummarizeQuene()
    }

    protected tryProcessPendingSummarizeQuene(force: boolean = false, failedTime: number = 0) {
        if (this.summarizeSessionsPromise) { return }
        if (failedTime > this.MAX_SUMMARIZE_FAIL_COUNT) {
            console.warn("总结屡次失败，强制关闭")
            return
        }
        const needSummarizeSessions = force ? this.pendingSummarizeQueue.splice(0, this.pendingSummarizeQueue.length) : this.needCreateSummarizationOfPendingSummarizeQueue()
        if (!needSummarizeSessions || !needSummarizeSessions.length) { return }

        else {
            this.emit('summarizeStart')
            this.summarizeSessionsPromise = this.runSummarizeSessions(needSummarizeSessions).then((session) => {
                this.savePendingSummarizeQueue?.()
                if (session) {
                    const completion = session.completion
                    const updateKnowledgeCount = session.updateKnowledgeCount
                    const updateMemoryCount = session.updateMemoryCount
                    this.emit('summarizeSuccess', completion, updateKnowledgeCount, updateMemoryCount)
                }
            }).catch((error) => {

                this.pendingSummarizeQueue.unshift(...needSummarizeSessions)
                failedTime++
                this.emit('summarizeFail', error)

            }).finally(() => {
                this.savePendingSummarizeQueue?.()
                this.summarizeSessionsPromise = null
                if (failedTime >= 1) {
                    const delay = Math.min(1000 * Math.pow(2, failedTime), 30000)
                    this.sleep(delay).then(() => this.tryProcessPendingSummarizeQuene(force, failedTime))
                }
                else {
                    this.tryProcessPendingSummarizeQuene(force, failedTime)
                }
            })
        }
    }

    protected needCreateSummarizationOfPendingSummarizeQueue(): null | Marisa.Chat.Completion.CompletionSession[] {
        const singleSummarizeLength = this.memoryOptions?.singleSummarizeLength ?? 5
        let needSlicePendingQuene: boolean = false

        if (this.pendingSummarizeQueue.length >= singleSummarizeLength) {
            needSlicePendingQuene = true
        }
        else {
            let currentMessageContentLength: number = 0

            for (const pendingSession of this.pendingSummarizeQueue) {
                const statisticMessages = pendingSession.messages.filter(i => ['assistant', 'user'].includes(i.role))
                for (const message of statisticMessages) {
                    const dataLength = message.content?.length || 0
                    currentMessageContentLength += dataLength
                }
            }
            if (currentMessageContentLength >= 2000) {
                needSlicePendingQuene = true
            }
        }

        if (needSlicePendingQuene) {
            //切多少啊
            const slicedPendingSessions = this.pendingSummarizeQueue.splice(0, singleSummarizeLength)
            return slicedPendingSessions
        }
        return null
    }

    protected async runSummarizeSessions(sessions: Marisa.Chat.Completion.CompletionSession[]) {

        const flatSessionMetadatas = sessions.map(this.extractSessionMessagesToMetadatas).flat()
        if (this.summarizeChatModel) {
            const boko = await this.runSummarizeSubAgent(this.summarizeChatModel, flatSessionMetadatas)
            return boko
        }

    }

    protected async runSummarizeSubAgent(model: ChatModel, metadatas: Metadata[]) {

        if (!this.longtermCategoricalMemoryStore) { return }

        //生成映射
        const metaIdMap = new Map<string, Metadata>()
        for (let i = 0; i < metadatas.length; i++) {
            const id = String(i)
            metaIdMap.set(id, metadatas[i] as Metadata)
        }

        const EMBEDDING_TOOL_NAME = 'EmbeddingKnownledge'
        const READ_TOOL_NAME = 'ReadCategoricalMemory'
        const CREATE_UPDATE_TOOL_NAME = 'CreateOrUpdateCategoricalMemory'

        const currentLongtermCategoricalMemories = await this.longtermCategoricalMemoryStore.getAllMemoryMetamap()

        const systemPrompt = `
        你是一个记忆整理助手，你整理记忆的原则是**宁可漏整也不误整**

        ## 操作方法
        - 你需要对提供的聊天记录使用工具进行整合或者归类
        - 你需要严格按照工具的提示进行操作，所有的关键词和内容必须来自于提供的聊天记录，严禁捏造
        - 你只需要调用工具进行整理或者结束会话，禁止生成其他的内容
        - 当提供的内容没有任何整理价值时，请立即结束对话，严禁调用工具
        - 禁止无端揣测！所有信息必须在原文中有所体现，总结的内容和关键词必须依据原文

        ## 值得存储的内容（必须同时满足）
        - 长期或重复出现（如“我最近一直在…”“我习惯…”）
        - 明确的喜好/厌恶/价值观/性格特点
        - AI获得用户明确认可的内容
        - 用户明确要求“请记住”的内容
        - 你不知道但用户提供的知识

        ## 操作步骤
        - 如果用户明确在内容中要求 请记住 你必须调用工具进行记忆
        - 简单巡视一遍聊天记录，如果没有值得存储的，立即结束会话
        - 首先你需要检查当前文章内容是否有值得进入你的知识数据库的内容，例如用户表达了长期或重复出现的信息，用户明确的喜好或者厌恶，AI聊天助手的收到用户认可的回复，你不知道的知识等，使用${EMBEDDING_TOOL_NAME}工具将他们嵌入你的知识数据库
        - 之后你要站在整体的视角去看整个聊天上下文，总结哪些值得分类存储或者需要更新当前的分类存储，严格按照${CREATE_UPDATE_TOOL_NAME}的要求进行更新
        - 之后你需要立即结束会话，禁止生成内容

        ## 聊天记录格式
        引用id | 角色 | 内容
        referenceId:001 | role:user | content:你知道我最喜欢玩得游戏是什么吗 | timestamp:123456

        ## 当前已经存储的分类记忆(如果你需要读取或者更新)
        ${JSON.stringify(currentLongtermCategoricalMemories)}`

        let prompt = ``
        for (const [id, meta] of metaIdMap.entries()) {
            prompt += `referenceId:${id} | role:${meta.role} | content:${meta.content} | timestamp:${meta.time}\n`
        }

        const commitEmbeddingDesc = `
        提交知识数据库嵌入信息

        ## 严格禁止
        - 禁止无端揣测！所有信息必须有原文引用，总结的内容和关键词必须依据原文
        - 禁止反复存储！相同的信息仅存储一次

        ## 使用方法:
        - 你需要提供referenceIds数组，即原话的id，之后对这几个原话进行总结生成一段简短的总结，叫做summary，之后根据总结的内容生成若干个关键词方便后续匹配，叫做keywords
        - 你需要从对话中找到有长期记忆价值的对话，对他们进行总结
        - 总结summary的长度控制在100词以内，保持简短，同时尽可能准确表示原话的语义
        - 一旦你发现需要总结的内容，你必须立刻调用这个工具
        - 如果没有需要总结的内容，严禁调用这个工具
        
        ## 需要调用工具存储（必须同时满足）:
        1. 用户表达了长期或重复出现的信息或者用户说了你不知道的内容（如：“最近、一直、经常、我习惯、我一般是”）
        2. 信息属于以下类型之一：
            - 知识类，科普类
            - 用户正在从事的长期活动（学习、工作、爱好，持续数天以上）
            - 明确的喜好 / 厌恶 / 价值观 / 性格特点
            - 有利于个性化生成的稳定特征
        3. 信息不是短期需求或临时状态
        4. 信息有指导意义，值得长期学习和借鉴

        ## 禁止调用工具存储（遇到以下情况，直接不调用）:
        - 代码、配置、文件路径、项目结构
        - 一次性需求（“我想吃冰淇淋”、“今天想玩游戏”）
        - 不确定的语气（“我可能喜欢”、“也许”）
        - 当前设备信息、网络状态等环境信息
        - 用户发来的原文、日志、报错内容

        ## 重要：
        - referenceIds的元素必须来自于聊天信息提供的referenceId，不可提供不存在的referenceId，referenceIds必须保持升序
        - summary的内容需要简洁的同时尽可能包含完整的语义
        - keywords需要按照内容生成，例如“我喜欢吃冰淇淋”分割的关键词为 （喜欢，冰淇淋，用户喜好，食品）
        - 你必须严格判断哪些应该存储哪些不应该存储
        
        ## 关键词策略
        - 数量：3-6个
        - 包含三类：
            - 核心实体（具体名称）
            - 类别标签（如：游戏、饮食、职业）
            - 用户画像标签（如：用户喜好、性格特征、长期活动）
        - 禁止使用：动词、情绪词、短句

        ## 不确定时的根本原则
        **宁可漏存，也不误存！**。  
        如果无法明确判断是否符合长期记忆条件 → **不调用工具**。

        示例聊天：
        referenceId:001 | role:用户 | content:你知道我最喜欢玩得游戏是什么吗 | timestamp:123456
        referenceId:002 | role:AI | content:我不知道，你可以分享一下吗？ | timestamp:123456
        referenceId:003 | role:用户 | content:我最近正在玩明日方舟，但是我最喜欢玩的还是碧蓝航线 | timestamp:123456
        referenceId:004 | role:AI | content:原来是碧蓝航线，的确很好玩，明日方舟也是很不错的游戏 | timestamp:123456

        你的总结 {referenceIds:["001","002","003"],summary:"用户最喜欢玩的游戏是碧蓝航线",keywords:["用户喜好","游戏","碧蓝航线","爱好","电子游戏","游戏风格"]}
        
        **请注意referenceIds是 string[] **
        `

        const commitEmbeddingKnowledges: EmbeddingKnowledge[] = []

        const commitEmbeddingTool = new LocalTool<{ referenceIds: string[], summary: string, keywords: string[] }>(EMBEDDING_TOOL_NAME, commitEmbeddingDesc, ({ referenceIds, summary, keywords }) => {

            for (const id of referenceIds) {
                if (!metaIdMap.has(id)) {
                    throw new Error(`Id ${id} is not exists`)
                }
            }
            if (!summary) {
                throw new Error(`No Summary Provided`)
            }
            if (!keywords || keywords.length < 3) {
                throw new Error(`Keywords less or not provided`)
            }
            commitEmbeddingKnowledges.push({
                referenceIds: referenceIds,
                summary: summary,
                keywords: keywords
            })
            return "Successed"
        }, {
            referenceIds: z.array(z.enum([...metaIdMap.keys()])),
            summary: z.string(),
            keywords: z.array(z.string()).min(3)
        })

        const commitMemoryUpdateDesc = `
        提交分类记忆的更新或创建分类记忆
        你需要根据提供的对话整体进行总结和长期记忆的分类与提取，你需要站在宏观的视角去提炼对话的内容，同时使用本工具完成创建和更新

        ## 重要注意
        1. 如果你需要更新的记忆类型和记忆名字已经存在，你需要先调用${READ_TOOL_NAME}工具函数读取原有的内容，并且在原有内容的基础上进行更新，而不是直接覆盖原有内容。
        2. 你需要确保更新后的内容能够反映出新的信息，同时保留原有内容中有价值的信息。

        ## 要求
        1. 记忆类型：你需要根据提供的信息判断子记忆的类型，类型包括用户记忆（user）、反馈记忆（feedback）参考记忆（reference）经历记忆（experience）。用户记忆包含用户的个人信息、兴趣爱好、习惯等；反馈记忆包含用户对产品或服务的评价、建议等；参考记忆包含用户提供的链接、文档等参考资料，经历记忆包含用户参加过的事情，做过的事，遇到过的人等
        2. 创建或更新：当你提炼出有价值的信息后，你需要调用这个来创建或更新子记忆。调用时请传入一个包含type（记忆类型）、name（记忆名称）、description（记忆描述）content（记忆内容）keywords（记忆关键词）的对象。
        3. 记忆类型：记忆类型必须为已经给出的 user feedback reference experience 中的一个
        4. 记忆命名：请为每个记忆提供一个简洁且具有描述性的名称，以便后续检索和使用。
        5. 记忆描述：在创建或更新记忆时，请提供一个简短的描述，说明该子记忆的主要内容或用途。
        6. 记忆关键词：你需要根据记忆的内容生成记忆关键词用来精确匹配，关键词需要包含三类：
            - 核心实体（具体名称）
            - 类别标签（如：游戏、饮食、职业）
            - 用户画像标签（如：用户喜好、性格特征、长期活动）
            你需要提供至少1个记忆关键词
        7. 记忆内容：记忆内容为总结后的话语，保持精简，必须严格切合原意
        8. 只存储有价值的信息：请确保只有在提炼出有价值的信息时才创建或更新记忆，如果没有有价值的信息，禁止调用工具函数。
        9. 你需要根据上下文来判断什么是有价值的信息，什么是不需要存储的信息
        10. 请确保创建或更新的记忆内容简洁明了，突出重点，便于后续检索和使用
        
        ## 记忆归类规范
        1. user（用户记忆）
        用户的基本信息、兴趣爱好、习惯、经历、能力、偏好等
        - 正确示例：用户喜欢玩Minecraft、用户玩Minecraft十四年、用户偏好海战主题整合包
        - 错误示例：「用户询问游戏」、「用户喜欢玩游戏」（太笼统）
        2. feedback（反馈记忆）
        用户对产品、服务、功能等的评价、建议、意见
        - 正确示例：用户认为瓦尔基里整合包海战系统很有趣、用户反馈命令方块功能很强大
        - 错误示例：「用户给了反馈」（太笼统）
        3. reference（参考记忆）
        用户提供的链接、文档、资料、代码仓库等可参考的内容
        - 正确示例：哔哩哔哩主页链接、GitHub上的Minecraft插件仓库、百度网盘整合包下载链接
        - 错误示例：「链接」、「用户发的链接」（太笼统）
        4. experience（经历记忆）
        用户明确说过自己的经历
        - 正确示例：用户去了北京长城、用户去爬华山的见闻
        - 错误示例：游玩记录（太笼统—）
        
        ## 记忆命名规范
        记忆名称必须具体、明确、可检索，格式为：[具体对象] + [具体方面]

        - 示例
        | 场景 | 错误命名 | 正确命名 |
        |------|-----------|-----------|
        | Minecraft游戏 | 游戏习惯 | Minecraft游戏习惯 |
        | 瓦尔基里整合包 | 整合包偏好 | 瓦尔基里大冒险整合包偏好 |
        | 海战主题 | 游戏喜好 | 海战主题游戏喜好 |
        | 命令方块 | 游戏技能 | Minecraft命令方块使用技能 |
        | 和朋友联机 | 社交偏好 | Minecraft多人联机偏好 |
        | 对整合包的评价 | 反馈 | 瓦尔基里整合包评价 |
        | 对舰炮系统的看法 | 建议 | 舰炮建造系统反馈 |
        | 对海战玩法的意见 | 用户反馈 | 海战玩法意见 |
        | B站链接 | 链接 | 哔哩哔哩Minecraft视频链接 |
        | GitHub仓库 | 代码仓库 | GitHub瓦尔基里整合包仓库 |
        | 百度网盘 | 下载链接 | 百度网盘整合包下载链接 |
        | 文档链接 | 文档 | Minecraft命令方块教程链接 |

        ## 描述规范
        描述应该简明扼要地说明这个记忆的用途和价值（20字以内）
        | 记忆名称 |  错误描述 |  正确描述 |
        |---------|-----------|-----------|
        | Minecraft游戏习惯 | 用户的游戏习惯 | 用户玩Minecraft的游戏习惯和偏好 |
        | 瓦尔基里整合包偏好 | 用户对整合包的偏好 | 用户对瓦尔基里大冒险整合包的偏好 |

        ## 内容规范
        内容应该存储具体的事实信息，用完整的句子描述，内容必须来自对话，严禁揣测

        ## 关键词规范
        关键词应该涵盖内容的主要部分，要满足 真实客观、便于查找、反应主体三个原则`

        const commitMemoryUpdates: LongtermCategoricalMemory[] = []

        const commitMemoryUpdateTool = new LocalTool<{ type: MemoryCategoryAllowedType, name: string, description: string, content: string, keywords: string[] }>(CREATE_UPDATE_TOOL_NAME, commitMemoryUpdateDesc, ({ type, name, description, content, keywords }) => {

            const metadata: LongtermCategoricalMemoryMetadata = {
                type: type,
                name: name,
                description: description,
                keywords: keywords,
                time: Date.now()
            }
            const memory: LongtermCategoricalMemory = {
                metadata: metadata,
                content: content
            }
            commitMemoryUpdates.push(memory)
            return "Successed"
        }, {
            type: z.enum(['user', 'feedback', 'reference', 'experience']),
            name: z.string(),
            description: z.string(),
            content: z.string(),
            keywords: z.array(z.string())
        })

        const readMemoryTool = new LocalTool<{ type: MemoryCategoryAllowedType, name: string }>(READ_TOOL_NAME, '读取分类记忆的内容，你必须提供记忆的类型(type)和记忆的名称(name),如果记忆不存在将会报错', async ({ type, name }) => {
            const memory = await this.longtermCategoricalMemoryStore?.readMemory(type, name)
            if (!memory) {
                throw new Error(`memory with type "${type}" and name "${name}" is not exists`)
            }
            return memory
        }, {
            type: z.enum(this.LONGTERM_MEMORY_TYPE),
            name: z.string()
        })

        const toolMap = new Map<string, Marisa.Tool.AnyTool>()
        toolMap.set(readMemoryTool.toolName, readMemoryTool)
        toolMap.set(commitMemoryUpdateTool.toolName, commitMemoryUpdateTool)
        toolMap.set(commitEmbeddingTool.toolName, commitEmbeddingTool)

        const cmpl = await model.complete(prompt, systemPrompt, toolMap)
        //非曰能之，愿学焉

        await Promise.all([this.createKnowledgeEmbedding(metaIdMap, commitEmbeddingKnowledges), this.createMemoryUpdate(commitMemoryUpdates)])

        return {
            completion: cmpl,
            updateMemoryCount: commitMemoryUpdates.length,
            updateKnowledgeCount: commitEmbeddingKnowledges.length
        }
    }

    protected async createKnowledgeEmbedding(map: Map<string, Metadata>, commits: EmbeddingKnowledge[]) {

        if (!commits.length) { return }

        const updateItems: { summary: string, keywords: string[], metadata: Metadata }[] = []

        for (const commit of commits) {
            const rawMetas: Metadata[] = []
            const ids = commit.referenceIds
            for (const id of ids) {
                const rawMeta = map.get(id)
                if (rawMeta) { rawMetas.push(rawMeta) }
            }
            const combinedMeta = this.combineMetadata(rawMetas)
            const summary = commit.summary
            const keywords = commit.keywords
            updateItems.push({
                summary: summary,
                keywords: keywords,
                metadata: combinedMeta
            })
        }
        const insertItemsTemp: HybridStoreInsertItem<Metadata>[] = []
        const insertItemsUUIDMap = new Map<string, HybridStoreInsertItem<Metadata>>()
        for (const update of updateItems) {
            const rawContent = update.metadata.content
            const uuid = this.createHashUUID(rawContent.trim())
            const hybridInsert: HybridStoreInsertItem<Metadata> = {
                metadata: update.metadata,
                content: update.summary,
                uuid: uuid
            }
            insertItemsUUIDMap.set(uuid, hybridInsert)
            insertItemsTemp.push(hybridInsert)
        }

        if (this.embeddingModel) {
            const embeddingInputs = insertItemsTemp.map(i => i.content)
            const embedded = await this.embeddingModel.embedding(embeddingInputs, this.embeddingDimension)
            for (const item of embedded.data) {
                const f32vec = new Float32Array(item.embedding)
                const index = item.index
                const rawInsertItem = insertItemsTemp[index]
                if (!rawInsertItem) { continue }

                const uuid = rawInsertItem.uuid
                const dmapv = insertItemsUUIDMap.get(uuid)
                if (!dmapv) { continue }
                dmapv.f32vec = f32vec
                insertItemsUUIDMap.set(uuid, dmapv)
            }
        }
        const createInsert = [...insertItemsUUIDMap.values()]
        //gc
        insertItemsTemp.length = 0
        insertItemsUUIDMap.clear()
        await this.hybridKnowledgeStore?.batchInsert(createInsert)
    }

    protected async createMemoryUpdate(commits: LongtermCategoricalMemory[]) {
        if (!this.longtermCategoricalMemoryStore) { return }
        for (const commit of commits) {
            await this.longtermCategoricalMemoryStore.createOrUpdateMemory(commit)
        }
    }

    protected createHashUUID(content: string) {
        content = content.trim()
        const uuid = crypto.createHash('md5').update(content).digest('hex')
        return uuid
    }

    protected combineMetadata(metadatas: Metadata[]): Metadata {
        let focusRole: AllowStoreRole = 'user'
        let combineContent: string = ""
        let latestTime: number = 0
        for (const metadata of metadatas) {
            combineContent += metadata.content + '\n\n'
            if (metadata.time > latestTime) {
                latestTime = metadata.time
            }
        }
        const metadata: Metadata = {
            role: focusRole,
            content: combineContent,
            time: latestTime
        }
        return metadata
    }

    protected extractSessionMessagesToMetadatas(session: Marisa.Chat.Completion.CompletionSession): Metadata[] {
        const stack: Metadata[] = [];
        const result: Metadata[] = [];
        let pendingTool = false;

        for (const message of session.messages) {
            const role = message.role;
            const time = message.timestamp || session.timestamp;
            switch (role) {
                case "system":
                    break;

                case "tool":
                    pendingTool = true;
                    break;

                case "assistant":
                case "developer":
                    if (message.content && typeof message.content === 'string') {
                        const aiMetadata: Metadata = {
                            role: 'assistant',
                            content: message.content,
                            time: time,
                        };
                        if (stack.length === 0) {
                            stack.push(aiMetadata);
                        }
                        else if (stack[stack.length - 1]?.role === 'assistant' && !pendingTool) {
                            const top = stack.pop()!;
                            result.push(top);
                            stack.push(aiMetadata);
                        }
                        else if (stack[stack.length - 1]?.role === 'assistant' && pendingTool) {
                            const before = stack.pop()!;
                            const combined: Metadata = {
                                role: 'assistant',
                                content: before.content + '\n\n[工具调用]\n' + aiMetadata.content,
                                time: aiMetadata.time,
                            };
                            stack.push(combined);
                            pendingTool = false;
                        }
                        else {
                            stack.push(aiMetadata);
                        }
                    }
                    break;

                case "user":
                    if (message.content && typeof message.content === 'string') {
                        pendingTool = false;
                        if (stack.length === 0) {
                            result.push({
                                role: 'user',
                                content: message.content,
                                time: time,

                            });
                        } else {
                            const aiContext = stack.map(ai => ai.content).join('\n');
                            stack.length = 0;
                            result.push({
                                role: 'user',
                                content: `[问答]\n问：${aiContext}\n答：${message.content}`,
                                time: time,

                            });
                        }
                    }
                    break;
            }
        }
        for (const remaining of stack) {
            result.push(remaining);
        }
        return result;
    }

    protected async queryRelevantKnowledge(query: string): Promise<HybridStoreQueryResult<Metadata>[]> {
        if (!this.hybridKnowledgeStore) { return [] }

        let queryVector: Float32Array<ArrayBufferLike> | null = null
        if (this.embeddingModel) {
            const embedding = await this.embeddingModel.embedding(query, this.embeddingDimension)
            const f32vec = embedding.data[0]?.embedding as Float32Array | undefined
            if (f32vec) {
                queryVector = f32vec
            }
        }

        const limit = this.memoryOptions?.maxQueryMemoryLength ?? 5

        const vectorQueryResult: HybridStoreQueryResult<Metadata>[] = (queryVector) ? await this.hybridKnowledgeStore.queryVector(queryVector, limit) : []
        const keywordQueryResult: HybridStoreQueryResult<Metadata>[] = await this.hybridKnowledgeStore.queryKeyword(query, limit)

        const vecWeight: number = this.memoryOptions?.hybridVectorWeight ?? 0.7
        const keywordWeight: number = this.memoryOptions?.hybridKeywordWeight ?? 1 - vecWeight
        const scoreThreshold = this.memoryOptions?.hybridScoreThreshold ?? 0.6

        let hybrid: HybridStoreQueryResult<Metadata>[] = this.relevantKnowledgeHybridMethod ? await this.relevantKnowledgeHybridMethod(vectorQueryResult, keywordQueryResult, limit, vecWeight, keywordWeight, scoreThreshold) : this.hybridVectorAndKeyword(vectorQueryResult, keywordQueryResult, limit, vecWeight, keywordWeight, scoreThreshold)
        return hybrid
    }

    protected async queryRelevantLongtermMemory(keywords: string[]): Promise<LongtermCategoricalMemory[]> {
        if (!this.longtermCategoricalMemoryStore) { return [] }
        const memories = await this.longtermCategoricalMemoryStore.matchMemory(keywords)
        return memories
    }

    protected hybridVectorAndKeyword(vectorQueryResult: HybridStoreQueryResult<Metadata>[], keywordQueryResult: HybridStoreQueryResult<Metadata>[], limit: number, vecWeight: number, keywordWeight: number, scoreThreshold: number) {

        const hybridMap = new Map<string, HybridStoreQueryResult<Metadata>>()

        const vectorScoreArray = [...vectorQueryResult.map(i => i.score)]
        const minVecScore = Math.min(...vectorScoreArray)
        const maxVecScore = Math.max(...vectorScoreArray)
        const vecMinMaxDelta = maxVecScore - minVecScore
        for (const result of vectorQueryResult) {
            const score = result.score
            const minmaxScore = (score - minVecScore) / vecMinMaxDelta
            const weightScore = minmaxScore * vecWeight
            const uuid = result.uuid
            if (hybridMap.has(uuid)) {
                const item = hybridMap.get(uuid)!
                item.score += weightScore
                hybridMap.set(uuid, item)
            }
            else {
                hybridMap.set(uuid, { ...result, score: weightScore })
            }
        }

        const keywordScoreArray = [...keywordQueryResult.map(u => u.score)]
        const minKeywordScore = Math.min(...keywordScoreArray)
        const maxKeywordScore = Math.max(...keywordScoreArray)
        const keywordMinMaxDelta = maxKeywordScore - minKeywordScore
        for (const result of keywordQueryResult) {
            const score = result.score
            const minmaxScore = (score - minKeywordScore) / keywordMinMaxDelta
            const weightScore = minmaxScore * keywordWeight
            const uuid = result.uuid
            if (hybridMap.has(uuid)) {
                const item = hybridMap.get(uuid)!
                item.score += weightScore
                hybridMap.set(uuid, item)
            }
            else {
                hybridMap.set(uuid, { ...result, score: weightScore })
            }
        }

        const result = [...hybridMap.values()].sort((a, b) => b.score - a.score).filter(s => s.score >= scoreThreshold).slice(0, limit)
        console.warn(JSON.stringify(result, null, 4))
        return result
    }

    protected buildAgentMemoryTool() {

        if (!this.longtermCategoricalMemoryStore) { return [] }
        const longtermCategoricalMemoryStore = this.longtermCategoricalMemoryStore

        const loadLongtermCategoricalMemoryDynamicTool = new DynamicTool<{ type: MemoryCategoryAllowedType, name: string }>(this.LOAD_MEMORY_TOOL_NAME, async () => {

            const currentLongtermCategoricalMemories = await longtermCategoricalMemoryStore.getAllMemoryMetamap()
            let currentMemoryPrompt = ""
            for (const [cate, metadatas] of Object.entries(currentLongtermCategoricalMemories)) {
                currentMemoryPrompt += `Type: **${cate}**:\n`
                for (const meta of metadatas) {
                    currentMemoryPrompt += `- | name:${meta.name} | description:${meta.description} | keywords:${meta.keywords.join(',')}\n`
                }
            }

            const toolDescription = `Load Memory\nWhen user talk something relevant to any memory in Available Memory List Below,use this tool to load it into current conversation,so that you can talk to the user more intellience\n\nImportant:\n- you need provide the memory type and memory name to load.\n- you can just load the memory in Available Memory List Below.\n- the tool will return "no such memory" when the memory doesn't exists or cannot be read,dont call this tool again,just continue your conversation or end the coversation!\n\nAvailable Memory:\n${currentMemoryPrompt}`

            const tool = new LocalTool<{ type: MemoryCategoryAllowedType, name: string }>(this.LOAD_MEMORY_TOOL_NAME, toolDescription, async ({ type, name }) => {
                if (!type || !name) {
                    throw new Error("Invalid Params")
                }
                const memory = await longtermCategoricalMemoryStore.readMemory(type, name)
                if (!memory) {
                    throw new Error(`Memory with type "${type}" and name "${name}" is not exists`)
                }
                const formatMemory = `## Memory ${type}:${name}\n\n${JSON.stringify(memory)}`
                return formatMemory
            }, {
                type: z.enum(this.LONGTERM_MEMORY_TYPE),
                name: z.string(),
            })

            return tool
        })

        const searchMemoryAndKnowledgeToolDesc = `Search Relevant Memories By Keywords\nIf you need to find some memory you need,provide an array of keywords and call this tool.\n\nImportant:\n- You need provide at least 1 query keywords to search\n- When no relavant memory,you can ask user about it or just continue the conversation,dont call this tools with same keywords again!\n- The tool will also return relavent Categorical Memory if matches,you can call **${this.SEARCH_MEMORY_KNOWLEDGE_TOOL_NAME}** to load it into your conversation if needed`

        const searchMemoryAndKnowledgeTool = new LocalTool<{ query: string[] }>(this.SEARCH_MEMORY_KNOWLEDGE_TOOL_NAME, searchMemoryAndKnowledgeToolDesc, async ({ query }): Promise<string> => {

            console.log(chalk.bgBlue.white(`模型查询关键词：${query.join(',')}`))

            const matchKnowledges = await this.queryRelevantKnowledge(query.join(' '))
            const matchCategoricalMemories = await this.queryRelevantLongtermMemory(query)

            if (!matchKnowledges.length && !matchCategoricalMemories.length) {
                return 'No Relavant Memory,Just continue your conversation or ask user about it';
            }

            let knowledges: string = matchKnowledges.length ? `
            ## Knowledge Maybe Relavant:\n ${matchKnowledges.map(i => `- summary:${i.content} | role:${i.metadata?.role} | raw-content:${i.metadata?.content} | time:${i.metadata ? this.semantifyTimestamp(i.metadata.time) : 'no-time'}`).join('\n')}` : '';

            let categoricalMemories = matchCategoricalMemories.length ? `
            ## Categorical Memory Maybe Matches:\n${matchCategoricalMemories.map(i => `- type:${i.metadata.type} | name:${i.metadata.name} | description:${i.metadata.description}\n`)}` : '';

            const result = `Here is the memories relavant to your query,You can use it if is matches：\n\n${knowledges}\n\n${categoricalMemories}`
            return result
        }, {
            query: z.array(z.string()).describe('query keywords array')
        })

        return [loadLongtermCategoricalMemoryDynamicTool, searchMemoryAndKnowledgeTool]
    }

    protected sleep(timems: number) {
        return new Promise<void>((resolve) => {
            const timer = setInterval(() => {
                clearInterval(timer)
                resolve()
            }, timems);
        })
    }

    protected createSessionFromHybridResult(hybridResult: HybridStoreQueryResult<Metadata>[]): Marisa.Chat.Completion.CompletionSession {
        const session = this.createEmptySession()
        for (const result of hybridResult) {
            if (result.metadata) {
                const raw = result.metadata.content
                const summary = result.content
                const time = result.metadata.time || Date.now()
                const xml = new XMLPromptTemplate({
                    "relevant-reminder": {
                        ...(summary ? { summary: summary } : {}),
                        "raw-content": raw
                    }
                }).toString()
                console.log(xml)
                session.messages.push({
                    role: 'user',
                    content: xml,
                    timestamp: time
                })
            }
        }
        return session
    }
}