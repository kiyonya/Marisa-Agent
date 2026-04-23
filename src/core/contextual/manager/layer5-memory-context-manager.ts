import z from "zod";
import chalk from "chalk";
import path from "path";
import { writeFileSync } from "fs";
import { readFileSync } from "fs-extra";
import crypto from 'crypto'

import { Marisa } from "@type/marisa";
import EmbeddingModel from "@core/model/embedding/embedding-model";
import ChatModel from "@core/model/chat/chat-model";
import { deepClone } from "@core/utils/base";
import { ModelContextManager, CategoryMemory, CategoryMemoryMetadata, MemoryCategoryAllowedType } from "./model-context-manager";
import LocalTool from "@core/tool/local-tool";
import RecursiveCharacterTextSplitter from "@core/splitter/recursive-character-text-splitter";

import BM25 from "@core/alg/bm25";
import { HybridStore, HybridStoreInsertItem } from "@core/store/hybrid/hybrid-store";
import { HybridStoreQueryResult } from "@core/store/impl/result";
import BaseHybridAlgorithm from "@core/store/hybrid-algorithm/base-hybrid-algorithm";
import HybridAlgorithm from "@core/store/hybrid-algorithm/hybrid-algorithm";
import Tokenizer from "@core/tokenizer/tokenizer";

type AllowStoreRole = 'user' | 'assistant' | 'developer'

interface Metadata {
    content: string,
    time: number,
    role: AllowStoreRole,
}

interface MetadataWithUUID extends Metadata {
    uuid: string
}

type InsertFilter = (metadatas: MetadataWithUUID[]) => MetadataWithUUID[] | Promise<MetadataWithUUID[]>

export interface Layer5MemoryConfig {
    /**
     *  @description L5 memory don't use signle file longterm memory,but you can enable it to load if this file exists
     */
    enableInjectLongtermMemory?: boolean
    /**
     * @description when query,if there are relevant memories found,inject them into system prompt for reference,default false,which means the relevant memories will not be injected into system prompt but only merged into context as messages
     * @default false
     * @description only for some mini-model
     */
    enableInjectRelevantContextIntoSystemPrompt?: boolean
    /**
     * @description L5 memory store your vector events by model-consolidate and chunking,you can force to use text-chunking mode to build which text you store.
     */
    hotMemoryLength?: number,
    /**
     * @description to set the number of sessions in hot memory to simplify,the toolcall result will be wrapped
     * @default 3
     */
    simplifyHotMemoryLength?: number
    /**
     * @description when the pending consolidate sessions length exceed the number,will start to consolidate,default 3,which means when there are more than 3 pending sessions,will start to consolidate
     * @default 3
     */
    pendingConsolidateAwaitLength?: number
    /**
     * @description when query,if the relevant memories exceed the number,will do memory decay,default 10,which means only the most recent 10 memories will be kept when the relevant memories exceed 10
     * @default 10
     */
    queryMemoryLength?: number
}

/**
 * @description `L5MemoryOSContextManager` is a long-term memory management class that inherits from ModelContextManager. It asynchronously consolidates conversation sessions and writes them to both a BM25 text database and a vector database to support dual keyword and semantic retrieval. During query, it merges hot memory, vector memory, and category memory (user/feedback/reference) based on user input, while injecting load_category_memory and search_memory tools into the large language model, enabling the model to load or search historical memory on demand, thereby achieving persistent, structured, and retrievable context augmentation across sessions.
 * 
 * @description `LL5MemoryOSContextManager` 是一个继承自 ModelContextManager 的长期记忆管理类，它会将对话会话异步整合后同时写入 BM25 文本库和向量数据库以支持关键词与语义双检索，并在查询时根据用户输入合并热记忆、向量记忆、分类记忆（用户/反馈/参考）等多种来源，同时向大语言模型注入 load_category_memory 和 search_memory 工具，使模型能够按需加载或搜索历史记忆，从而实现跨会话的持久化、结构化与可检索的上下文增强能力
 */
export default class Layer5MemoryContextManager extends ModelContextManager {

    private pendingConsolidateSessions: Marisa.Chat.Completion.CompletionSession[] = []
    private consolidatePromise: Promise<void> | null = null
    private embeddingDimension: number = 512
    private embeddingModel: EmbeddingModel | null = null
    private consolidateChatModel: ChatModel | null = null
    private hybridStore: HybridStore<Metadata>
    private injectLoadCategoryMemoryToolName: string = 'load_category_memory'
    private injectSearchMemoryToolName: string = 'search_memory'

    public config?: Layer5MemoryConfig
    public memoryHybridAlgorithm: BaseHybridAlgorithm | null = null
    public memoryInsertFilter: InsertFilter | null = null
    public memorySearchTokenizer: Tokenizer | null = null

    constructor(consolidateChatModel?: ChatModel, embeddingModel?: EmbeddingModel, embeddingDimension: number = 512, hybridStore?: HybridStore<Metadata>, config?: Layer5MemoryConfig) {
        super()
        this.config = config
        if (consolidateChatModel) {
            this.consolidateChatModel = consolidateChatModel
            consolidateChatModel.defineCompletionOptions({
                temperature: 0,
                topP: 1,
                maxCompletionTokens: 4000,
            })
        }
        if (embeddingModel) {
            this.embeddingModel = embeddingModel
        }
        if (embeddingDimension) {
            this.embeddingDimension = embeddingDimension
        }

        this.hybridStore = hybridStore || this.createEmptyHybridStore(embeddingDimension)
        if (this.hybridStore.embeddingDimension !== embeddingDimension) {
            throw new Error(`The embedding dimension of the hybrid store must be the same as the embedding dimension of the context manager, expected ${embeddingDimension} but got ${this.hybridStore.embeddingDimension}`)
        }

        const injectTools = this.createModelInjectTools()
        this.injectModelConstantTool(...injectTools)

        const pendingSessions = this.readPendingSessions()
        if (pendingSessions.length) {
            this.pendingConsolidateSessions = pendingSessions
            this.startConsolidateQuene()
        }
    }

    public override async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {
        const copySession = deepClone(session)
        this.addSession(copySession)
        this.addPendingSession(copySession)

        Promise.resolve().then(() => this.insertSession(copySession)).catch((error) => { })

        sessionPutCallback && sessionPutCallback()
    }

    public override async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {
        const hotSessions = this.filterSessions(this.config?.hotMemoryLength ?? 5, this.config?.simplifyHotMemoryLength ?? 3)

        let metadatas: Metadata[] = await this.querySession(userPrompt) || []

        console.log(chalk.bgBlue.white(`向量与查询数据库找到 ${metadatas.length} 条有关记忆`))

        metadatas = metadatas.map(i => ({
            content: `[这条消息是一条历史消息，仅供参考]${i.content}`,
            role: i.role,
            time: i.time
        }))

        const relevantContextSession = this.createEmptySession()
        const relevantContextMessages = metadatas.map(this.releventToMessage)
        relevantContextSession.messages = relevantContextMessages.filter(i => i !== null)

        const categoryMemorySystemPrompt = `
        ## 你可以使用CateMemory，也就是分类存储好的记忆来辅助你进行回答，如果你需要使用，请调用工具函数${this.injectLoadCategoryMemoryToolName}来读取对应的子记忆内容，调用时请传入type和name来读取对应的子记忆内容。
        1. CateMemory类型包括用户记忆（user）、反馈记忆（feedback）和参考记忆（reference）。用户记忆包含用户的个人信息、兴趣爱好、习惯等；反馈记忆包含用户对产品或服务的评价、建议等；参考记忆包含用户提供的链接、文档等参考资料。
        2. 当你需要获取某个子记忆的内容时，你可以调用工具函数${this.injectLoadCategoryMemoryToolName}，传入type和name来读取对应的子记忆内容。
        3. 你需要根据上下文来判断是否需要使用CateMemory，以及使用哪个CateMemory。`

        const categoryMemoryIndex = this.buildMemoryCategoriesIndex()
        const categoryMemoryIndexPrompt: string = !categoryMemoryIndex ? '## 当前还没有记忆索引' : `## 当前的记忆索引有\n${categoryMemoryIndex}\n使用load_category_memory来加载`;

        const searchMemorySystemPrompt = `你可以使用${this.injectSearchMemoryToolName}工具函数来搜索相关的记忆内容，调用时请传入一个查询字符串数组，系统会返回相关的记忆内容。你需要根据上下文来判断是否需要使用${this.injectSearchMemoryToolName}工具函数，以及如何构造查询。`

        //inject long term
        let longtermMemorySystemPrompt: string | null = null
        if (this.config?.enableInjectLongtermMemory) {
            const keepLongtermMemory = this.readLongtermMemory()
            if (keepLongtermMemory) {
                longtermMemorySystemPrompt = `##当前记录的长期记忆有\n${keepLongtermMemory}`
            }
        }

        let relevantContextInjectPrompt: string | null = null
        if (this.config?.enableInjectRelevantContextIntoSystemPrompt && relevantContextMessages.length) {
            relevantContextInjectPrompt = `## 找到以下有关的记忆供参考\n ${relevantContextMessages.map(m => JSON.stringify(m)).join('\n')}`
        }

        const systemPromptAddition: string = [categoryMemorySystemPrompt, categoryMemoryIndexPrompt, searchMemorySystemPrompt, longtermMemorySystemPrompt, relevantContextInjectPrompt].filter(i => i !== null).join('\n\n')

        const querySessions = [...hotSessions]
        if (relevantContextMessages.length) {
            querySessions.unshift(relevantContextSession)
        }

        this.emit('sessionQuery', userPrompt, querySessions, systemPromptAddition, `向量数据库找到 ${metadatas.length} 条相关记忆`)
        return [this.noSystemInject(querySessions), systemPromptAddition]

    }

    public configure(config: Partial<Layer5MemoryConfig>) {
        this.config = {
            ...this.config,
            ...config
        }
        return this
    }

    private addPendingSession(session: Marisa.Chat.Completion.CompletionSession) {
        this.pendingConsolidateSessions.push(session)
        this.startConsolidateQuene()
        this.savePendingSessions()
    }

    private startConsolidateQuene() {

        console.log(chalk.bgGray.blue('\n\n待整合会话数量：' + this.pendingConsolidateSessions.length))
        if (this.pendingConsolidateSessions.length <= (this.config?.pendingConsolidateAwaitLength ?? 3) || this.consolidatePromise) {
            return
        }
        console.log(chalk.bgGray.blue('\n\n开始整合会话，当前整合队列长度：' + this.pendingConsolidateSessions.length))
        const headSessions = this.pendingConsolidateSessions.splice(0, (this.config?.pendingConsolidateAwaitLength ?? 3) + 1)

        this.consolidate(headSessions).then(() => {
            console.log('整理完成')
            this.savePendingSessions()
        }).catch((error) => {
            console.error('整理失败:', error)
            this.pendingConsolidateSessions.unshift(...headSessions)
        })

    }

    private savePendingSessions() {
        const pendingSessions = [...this.pendingConsolidateSessions]
        const tempDir = this.getWorkspace('temp')
        const tempFile = path.join(tempDir, `pending_sessions.json`)
        writeFileSync(tempFile, JSON.stringify(pendingSessions, null, 2), 'utf-8')
    }

    private readPendingSessions(): Marisa.Chat.Completion.CompletionSession[] {
        try {
            const tempDir = this.getWorkspace('temp')
            const tempFile = path.join(tempDir, `pending_sessions.json`)
            const data = JSON.parse(readFileSync(tempFile, 'utf-8'))
            return data
        } catch (error) {
            return []
        }
    }

    private async consolidate(sessions: Marisa.Chat.Completion.CompletionSession[]): Promise<void> {
        const metadatas = sessions.map(this.extractMessages).flat()
        if (this.consolidateChatModel) {
            await this.updateCategoryMemory(this.consolidateChatModel, metadatas)
        }
    }

    //insert
    private async insertSession(session: Marisa.Chat.Completion.CompletionSession): Promise<void> {
        const metadatas = this.extractMessages(session)

        const rcharSplitter = new RecursiveCharacterTextSplitter({
            chunkOverlap: 30,
            chunkSize: 450
        })

        let insertMetadatas: MetadataWithUUID[] = []
        for (const metadata of metadatas) {
            const chunks = rcharSplitter.splitText(metadata.content)
            for (const chunk of chunks) {
                insertMetadatas.push({ ...metadata, content: chunk, uuid: this.createHashUUID(chunk) })
            }
        }

        if (this.memoryInsertFilter) {
            insertMetadatas = await this.memoryInsertFilter(insertMetadatas)
        }

        const insertMap: Record<string, HybridStoreInsertItem<Metadata>> = {}
        const embeddingInputs: string[] = []
        const isEmbedding = Boolean(this.embeddingModel)
        for (const metadata of insertMetadatas) {
            const content = metadata.content
            const tokenizedContent: string[] | null = this.memorySearchTokenizer ? await this.memorySearchTokenizer.tokenize(content) : null
            const uuid = metadata.uuid
            insertMap[uuid] = {
                uuid: uuid,
                content: tokenizedContent ? tokenizedContent.join(' ') : content,
                metadata: metadata
            }
            if (isEmbedding) {
                embeddingInputs.push(content)
            }
        }
        if (embeddingInputs.length && isEmbedding && this.embeddingModel) {
            const embeddings = await this.embeddingModel.embedding(embeddingInputs, this.embeddingDimension)
            let pindex: number = 0
            for (const embedded of embeddings.data) {
                const index = embedded.index ?? pindex
                const metadata = insertMetadatas[index]
                if (metadata) {
                    const uuid = metadata.uuid
                    if (!insertMap[uuid]) { continue }
                    insertMap[uuid].f32vec = new Float32Array(embedded.embedding)
                }
                pindex++
            }
        }
        const inserts = Object.values(insertMap)
        await this.hybridStore.batchInsert(inserts)
    }

    private async querySession(query: string): Promise<Metadata[]> {

        let queryVector: Float32Array<ArrayBufferLike> | null = null
        if (this.embeddingModel) {
            const embedding = await this.embeddingModel.embedding(query, this.embeddingDimension)
            const f32vec = embedding.data[0]?.embedding as Float32Array | undefined
            if (f32vec) {
                queryVector = f32vec
            }
        }

        const vectorQueryResult: HybridStoreQueryResult<Metadata>[] = (queryVector) ? await this.hybridStore.queryVector(queryVector) : []

        const keywordQueryResult: HybridStoreQueryResult<Metadata>[] = await this.hybridStore.queryKeyword(query)
        const limit = this.config?.queryMemoryLength ?? 15

        let hybrid: HybridStoreQueryResult<Metadata>[] = []

        if ([vectorQueryResult, keywordQueryResult].some(i => i.length === 0)) {
            hybrid.push(...vectorQueryResult.slice(0, limit), ...keywordQueryResult.slice(0, limit))
        }
        else if (this.memoryHybridAlgorithm) {
            hybrid = await this.memoryHybridAlgorithm.run<Metadata>(vectorQueryResult, keywordQueryResult, limit)
        }
        else {
            const alg = new HybridAlgorithm.ReciprocalRankFusion()
            hybrid = await alg.run<Metadata>(vectorQueryResult, keywordQueryResult, limit)
        }

        const metadatas: Metadata[] = []
        for (const hb of hybrid) {
            if (hb.metadata) {
                metadatas.push(hb.metadata)
            }
        }

        return metadatas
    }

    private async queryCategoryMemory(queryKeywords: string[]): Promise<{ type: string; name: string; }[]> {
        const categoryMemoriesIndex = this.readCategoryMemoryMetadatas()
        const metadatas: CategoryMemoryMetadata[] = []
        for (const [_, memories] of Object.entries(categoryMemoriesIndex)) {
            metadatas.push(...memories)
        }
        const matchedMetadatas: CategoryMemoryMetadata[] = []
        new BM25([metadatas.map(i => i.description)]).getTopK(queryKeywords, 5).forEach(e => {
            const item = metadatas[e.index]
            item && matchedMetadatas.push(item)
        });
        return matchedMetadatas.map(i => ({ type: i.type, name: i.name }))
    }

    private createHashUUID(content: string) {
        content = content.trim()
        const uuid = crypto.createHash('md5').update(content).digest('hex')
        return uuid
    }

    private async updateCategoryMemory(model: ChatModel, metas: Metadata[]) {

        const categoryMemoryUpdates: { type: MemoryCategoryAllowedType, name: string, subMemory: CategoryMemory }[] = []

        const updateToolDescription = `创建或者更新记忆，如果你需要操作的记忆已经存在，你需要先调用read_memory工具函数读取原有的内容，并且在原有内容的基础上进行更新，而不是直接覆盖原有内容。你需要确保更新后的内容能够反映出新的信息，同时保留原有内容中有价值的信息。`

        const readToolDescription = `读取记忆，你需要提供记忆的类型和名字来读取对应的子记忆内容。如果记忆不存在会返回null。`

        const updateTool = new LocalTool<{ type: MemoryCategoryAllowedType, name: string, description: string, content: string }>('create_or_update_memory', updateToolDescription, ({ type, name, description, content }) => {
            const metadata: CategoryMemoryMetadata = {
                type: type,
                description: description || '',
                time: Date.now(),
                name: name
            }
            const subMemory: CategoryMemory = {
                metadata: metadata,
                content: content
            }
            categoryMemoryUpdates.push({ type, name, subMemory })
            return true
        }, {
            type: z.enum(Layer5MemoryContextManager.memoryCategories),
            name: z.string(),
            description: z.string(),
            content: z.string()
        })

        const readTool = new LocalTool<{ type: MemoryCategoryAllowedType, name: string }>('read_memory', readToolDescription, ({ type, name }) => {
            const subMemory = this.readCategoryMemory(type, name)
            return subMemory
        }, {
            type: z.enum(Layer5MemoryContextManager.memoryCategories),
            name: z.string(),
        })

        const toolMap = new Map<string, Marisa.Tool.AnyTool>()
        toolMap.set(updateTool.toolName, updateTool)
        toolMap.set(readTool.toolName, readTool)

        const currentMemoryCategoriesIndex = this.buildMemoryCategoriesIndex()

        const systemPrompt = `
        你是一个记忆整理助手，你需要按照如下要求进行记忆的创建和更新：

        ## 操作要求
        1. 记忆类型：你需要根据提供的信息判断子记忆的类型，类型包括用户记忆（user）、反馈记忆（feedback）和参考记忆（reference）。用户记忆包含用户的个人信息、兴趣爱好、习惯等；反馈记忆包含用户对产品或服务的评价、建议等；参考记忆包含用户提供的链接、文档等参考资料。
        2. 创建或更新：当你提炼出有价值的信息后，你需要调用工具函数create_or_update_memory来创建或更新子记忆。调用时请传入一个包含type（子记忆类型）、name（子记忆名称）、description（子记忆描述）和content（子记忆内容）的对象。
        3. 读取子记忆：当你需要获取某个子记忆的内容时，你可以调用工具函数read_memory，传入type和name来读取对应的子记忆内容。
        4. 子记忆命名：请为每个子记忆提供一个简洁且具有描述性的名称，以便后续检索和使用。
        5. 子记忆描述：在创建或更新子记忆时，请提供一个简短的描述，说明该子记忆的主要内容或用途。
        6. 只存储有价值的信息：请确保只有在提炼出有价值的信息时才创建或更新子记忆，如果没有有价值的信息，请不要调用工具函数。
        7. 你需要根据上下文来判断什么是有价值的信息，什么是不需要存储的信息。
        8. 请确保创建或更新的子记忆内容简洁明了，突出重点，便于后续检索和使用。
        9.提供给你的对话格式是 [角色] [时间戳] 消息内容，例如 [user] [12345678910] 我最近在学习机器学习，感觉很有趣。

        ## 核心规则示范

        ### 1. user（用户记忆）
        用户的基本信息、兴趣爱好、习惯、经历、能力、偏好等
        - 正确示例：「用户喜欢玩Minecraft」、「用户玩Minecraft十四年」、「用户偏好海战主题整合包」
        - 错误示例：「用户询问游戏」、「用户喜欢玩游戏」（太笼统）

        ### 2. feedback（反馈记忆）
        用户对产品、服务、功能等的评价、建议、意见
        - 正确示例：「用户认为瓦尔基里整合包海战系统很有趣」、「用户反馈命令方块功能很强大」
        - 错误示例：「用户给了反馈」（太笼统）

        ### 3. reference（参考记忆）
        用户提供的链接、文档、资料、代码仓库等可参考的内容
        - 正确示例：「哔哩哔哩主页链接」、「GitHub上的Minecraft插件仓库」、「百度网盘整合包下载链接」
        -  错误示例：「链接」、「用户发的链接」（太笼统）

        ## 命名规范

        **记忆名称必须具体、明确、可检索，格式为：[具体对象] + [具体方面]**

        ### user 类型命名示例
        | 场景 | 错误命名 | 正确命名 |
        |------|-----------|-----------|
        | Minecraft游戏 | 游戏习惯 | Minecraft游戏习惯 |
        | 瓦尔基里整合包 | 整合包偏好 | 瓦尔基里大冒险整合包偏好 |
        | 海战主题 | 游戏喜好 | 海战主题游戏喜好 |
        | 命令方块 | 游戏技能 | Minecraft命令方块使用技能 |
        | 和朋友联机 | 社交偏好 | Minecraft多人联机偏好 |

        ### feedback 类型命名示例
        | 场景 |  错误命名 |  正确命名 |
        |------|-----------|-----------|
        | 对整合包的评价 | 反馈 | 瓦尔基里整合包评价 |
        | 对舰炮系统的看法 | 建议 | 舰炮建造系统反馈 |
        | 对海战玩法的意见 | 用户反馈 | 海战玩法意见 |

        ### reference 类型命名示例
        | 场景 |  错误命名 |  正确命名 |
        |------|-----------|-----------|
        | B站链接 | 链接 | 哔哩哔哩Minecraft视频链接 |
        | GitHub仓库 | 代码仓库 | GitHub瓦尔基里整合包仓库 |
        | 百度网盘 | 下载链接 | 百度网盘整合包下载链接 |
        | 文档链接 | 文档 | Minecraft命令方块教程链接 |

        ## 描述规范

        **描述应该简明扼要地说明这个记忆的用途和价值（20字以内）**

        | 记忆名称 |  错误描述 |  正确描述 |
        |---------|-----------|-----------|
        | Minecraft游戏习惯 | 用户的游戏习惯 | 用户玩Minecraft的游戏习惯和偏好 |
        | 瓦尔基里整合包偏好 | 用户对整合包的偏好 | 用户对瓦尔基里大冒险整合包的偏好 |

        ## 内容规范

        **内容应该存储具体的事实信息，用完整的句子描述**
        
        ## 现在已经存储的子记忆索引如下
        ${currentMemoryCategoriesIndex ? currentMemoryCategoriesIndex : "当前还没有记忆索引"}

        ## 重要注意
        1. 如果你需要更新的记忆类型和记忆名字已经存在，你需要先调用read_memory工具函数读取原有的内容，并且在原有内容的基础上进行更新，而不是直接覆盖原有内容。
        2. 你需要确保更新后的内容能够反映出新的信息，同时保留原有内容中有价值的信息。`


        const messages = metas.map(i => `[${i.role}] [${i.time}] ${i.content}`)
        const prompt = `
        请处理以下对话：
        ## 对话
        ${messages.join('\n')}`

        try {
            const timeout = new Promise<never>((_, reject) => {
                const tid = setTimeout(() => {
                    clearTimeout(tid)
                    reject(new Error('timeout'))
                }, 60 * 1000)
            })

            const completion = await Promise.race([model.complete(prompt, systemPrompt, toolMap), timeout])
            if (categoryMemoryUpdates.length) {
                for (const update of categoryMemoryUpdates) {
                    this.createOrUpdateCategoryMemory(update.type, update.name, update.subMemory)
                }
            }
        } catch (error) {
            console.log(error)
        }
    }

    public extractMessages(session: Marisa.Chat.Completion.CompletionSession): Metadata[] {
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
                                content: before.content + '\n\n[工具结果]\n' + aiMetadata.content,
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

    private releventToMessage(rel?: Metadata) {
        if (!rel) {
            return null
        }
        switch (rel.role) {
            case "user":
                const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
                    role: 'user',
                    content: rel.content,
                    timestamp: rel.time,
                }
                return userMessage
            case "assistant":
                const assistantMessage: Marisa.Chat.Completion.Messages.ChatCompletionAssistantMessageParam = {
                    role: 'assistant',
                    content: rel.content,
                    timestamp: rel.time
                }
                return assistantMessage
            case "developer":
                const developerMessage: Marisa.Chat.Completion.Messages.ChatCompletionDeveloperMessage = {
                    role: 'developer',
                    content: rel.content,
                    timestamp: rel.time
                }
                return developerMessage
        }
        return null
    }

    private createModelInjectTools() {
        const loadCategoryMemoryTool = new LocalTool<{ type: MemoryCategoryAllowedType, name: string }>(this.injectLoadCategoryMemoryToolName, '加载类型记忆文件', ({ type, name }) => {
            const data = this.readCategoryMemory(type, name)
            if (data) { return data }
            else { return '当前记忆是不存在的' }
        }, {
            type: z.enum(Layer5MemoryContextManager.memoryCategories),
            name: z.string(),
        })

        const searchMemoryTool = new LocalTool<{ query: string[] }>(this.injectSearchMemoryToolName, '根据关键词搜索相关记忆', async ({ query }): Promise<string> => {

            console.log(chalk.bgBlue.white(`模型查询关键词：${query.join(',')}`))

            const matchHybridResult = await this.querySession(query.join(' '))
            const matchCategoryMemory = await this.queryCategoryMemory(query)
            if (!matchHybridResult.length && !matchCategoryMemory.length) {
                return '没有找到相关的记忆，你现在需要去询问用户相关的内容活着继续对话，用户的回答会被记录，这样你下次就可以搜索到相关记忆了，请不要调用工具去盲目查找！';
            }

            let dbMemories: string = matchHybridResult.length ? `
            ## 数据库相关记忆\n 
            ${matchHybridResult.map(i => `- 记忆角色:${i.role}  记忆时间:${this.semantifyTimestamp(i.time)}  记忆内容:${i.content}\n`).join('')}` : '';

            let recommendCategoryMemories = matchCategoryMemory.length ? `
            ## 另外找到可能相关的类型记忆，你可以使用${this.injectLoadCategoryMemoryToolName}工具调用查看
            ${matchCategoryMemory.map(i => `- 记忆类型:${i.type}  记忆名称:${i.name}\n`)}` : '';

            const result = `根据你的查询，以下是找到的相关记忆：\n\n${dbMemories}\n\n${recommendCategoryMemories}`
            return result

        }, {
            query: z.array(z.string()).describe('你需要查询的查询字符串数组')
        })
        return [loadCategoryMemoryTool, searchMemoryTool]
    }
}

