import EventEmitter from "events";
import { Marisa } from "../types/marisa";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import Model from "../core/model/Model";
import MCPToolkit from "../core/mcp/mcp_client";
import AgentSkills from "../core/skill/AgentSkills";
import { ModelContextManager } from "../core/context/ModelContextManager";
import VecStoreContextManager from "../core/context/VecStoreContextManager";
import EmbeddingModel from "../core/model/embedding/EmbeddingModel";
import BasicContextManager from "../core/context/BasicContextManager";
import VectorStore from "../core/vecstore/VectorStore";
import { ModelPluginRegister } from "../core/plugin/ModelPluginRegister";
import LLMSummaryFileContextManager from "../core/context/LLMSummaryFileContextManager";
import LLMSummaryVecStoreContextManager from "../core/context/LLMSummaryVecStoreContextManager";
import fs from 'fs'
import LocalTool from "../core/tool/LocalTool";
import z from "zod";
import L2MemoryOSContextManager from "../core/context/L2MemoryOSContextManager";

interface AgentEvents {
    create: [],
    ready: [],
    mcprun: [mcpname: string],
    subAgentCreate:[options:SubAgentCreateOptions]
    subAgentComplete:[agentName:string,session:Marisa.Chat.Completion.CompletionSession]
}

interface AgentConfig {
    enableSubAgent?: boolean,
    enableAutoDream?: boolean
}

interface SubAgentCreateOptions {
    agents: {
        systemPrompt: string,
        prompt: string,
        agentName: string
    }[],
    parallel: boolean
    collectResult: boolean
}

export default abstract class Agent extends EventEmitter<AgentEvents> {

    protected client: OpenAI
    protected chatModelName:string = ''
    protected chatModel: Model
    protected agentMCPServers = new Map<string, (StdioServerParameters | URL)>()
    protected agentTools: Marisa.Tool.AnyTool[] = []
    protected agentToolkits: Marisa.Tool.AnyToolkit[] = []
    protected agentSkillDir: string | null = null
    protected modelContextManager: ModelContextManager
    protected modelCompletionOptions: Partial<Marisa.Model.ModelCompletionOptions> = {}
    protected modelSessions: Marisa.Chat.Completion.CompletionSession[] = []
    protected modelPlugins = new Set<ModelPluginRegister>()
    protected modelRolePrompt: string | null = null
    protected modelSystemPrompt: string | null = null

    protected agentConfig?: AgentConfig

    constructor(chatModelName: string, client: OpenAI, sessions?: Marisa.Chat.Completion.CompletionSession[]) {
        super()
        this.client = client
        this.chatModelName = chatModelName
        this.chatModel = this.createChatModel(this.client, chatModelName)
        if (sessions) {
            this.modelSessions = sessions
        }
        this.modelContextManager = new BasicContextManager(this.modelSessions)
        this.emit('create')
    }

    //不同平台自行实现
    protected abstract createEmbeddingModel(client: OpenAI, modelName: string, dimonsion: number): EmbeddingModel
    protected abstract createChatModel(client: OpenAI, modelName: string): Model

    public useVectorContext(embeddingModelName: string, dimonsion: number = 512, vectorStore?: VectorStore<any>, newClient?: OpenAI) {
        const embeddingModel = this.createEmbeddingModel(newClient || this.client, embeddingModelName, dimonsion)
        this.modelContextManager = new VecStoreContextManager(embeddingModel, dimonsion, vectorStore, 5, this.modelSessions)
        return this
    }

    public config(config:Partial<AgentConfig>){
        this.agentConfig = {...this.agentConfig,...config}
        return this
    }

    public useDefaultContext() {
        this.modelContextManager = new BasicContextManager()
        return this
    }

    public useLLMSummarizationContext(summaryModelName: string, newClient?: OpenAI) {
        const summaryModel = this.createChatModel(newClient || this.client, summaryModelName)
        this.modelContextManager = new LLMSummaryFileContextManager(summaryModel, [])
        return this
    }

    public useLLMVecContext(summaryModelName: string, embeddingModelName: string, dimonsion: number = 512, vectorStore?: VectorStore<any>, newClient?: OpenAI) {
        const summaryModel = this.createChatModel(newClient || this.client, summaryModelName)
        const embeddingModel = this.createEmbeddingModel(this.client, embeddingModelName, dimonsion)
        this.modelContextManager = new LLMSummaryVecStoreContextManager(summaryModel, embeddingModel, dimonsion, vectorStore)
        return this
    }

    public useL2MemoryOSContext(summaryModelName: string, embeddingModelName: string, dimonsion: number = 512, vectorStore?: VectorStore<any>, newClient?: OpenAI){
        const summaryModel = this.createChatModel(newClient || this.client, summaryModelName)
        const embeddingModel = this.createEmbeddingModel(this.client, embeddingModelName, dimonsion)
        this.modelContextManager = new L2MemoryOSContextManager([],summaryModel,embeddingModel,vectorStore)
        return this
    }

    public useModelCfg(modelCompletionOptions: Partial<Marisa.Model.ModelCompletionOptions> = {}) {
        this.modelCompletionOptions = modelCompletionOptions
        return this
    }

    public useMCP(mcpServers: Record<string, (StdioServerParameters | URL)>) {
        for (const [serverName, server] of Object.entries(mcpServers)) {
            this.agentMCPServers.set(serverName, server)
        }
        return this
    }

    public useTool(...tools: Marisa.Tool.AnyTool[]) {
        this.agentTools.push(...tools)
        return this
    }

    public useSkill(skillDir: string) {
        this.agentSkillDir = skillDir
        return this
    }

    public useToolkits(...toolkits: Marisa.Tool.AnyToolkit[]) {
        this.agentToolkits.push(...toolkits)
        return this
    }

    public usePlugin(plugin: ModelPluginRegister) {
        this.modelPlugins.add(plugin)
        return this
    }

    public useRole(rolePrompt: string) {
        this.modelRolePrompt = rolePrompt
        return this
    }

    public useRoleMd(roleMdFile: string) {
        if (fs.existsSync(roleMdFile)) {
            const md = fs.readFileSync(roleMdFile, 'utf-8')
            this.modelRolePrompt = md
        }
        return this
    }

    public useSystemPrompt(systemPrompt: string) {
        this.modelSystemPrompt = systemPrompt
        return this
    }

    private createSubAgentTool(extendTools: Marisa.Tool.AnyTool[] = []) {

        const createSubAgentTool = new LocalTool<SubAgentCreateOptions>('create_subagent', '创建SubAgent以分配任务', async ({ agents, parallel, collectResult }) => {

            this.emit('subAgentCreate',{agents,parallel,collectResult})

            const toolMap = new Map<string, Marisa.Tool.AnyTool>()
            for (const tool of extendTools) {
                toolMap.set(tool.toolName, tool)
            }

            const subAgents: { model: Model, prompt: string, name: string }[] = []
            for (const agent of agents) {
                const subAgentModel = this.createChatModel(this.client, this.chatModelName)

                subAgentModel.defineTools(...extendTools)
                subAgentModel.defineSystemPrompt(agent.prompt)
                subAgents.push({
                    model: subAgentModel,
                    prompt: agent.prompt,
                    name: agent.agentName
                })
            }

            const resultCollection: Record<string, string> = {}

            if (parallel) {
                await Promise.all(subAgents.map(async (agent) => {
                    const complete = await agent.model.complete(agent.prompt, toolMap)
                    const lastMessage = complete.messages[-1] || ''
                    if (typeof lastMessage === 'string') {
                        resultCollection[agent.name] = lastMessage
                    }
                    this.emit('subAgentComplete', agent.name, complete)
                    return complete
                }))
            }
            else {
                for (const agent of subAgents) {
                    const complete = await agent.model.complete(agent.prompt, toolMap)
                    this.emit('subAgentComplete', agent.name, complete)
                    //这里可以根据complete的结果来决定是否继续执行下一个agent，或者对后续agent的prompt进行调整
                    const lastMessage = complete.messages[-1] || ''
                    if (typeof lastMessage === 'string') {
                        resultCollection[agent.name] = lastMessage
                    }
                }
            }
            console.log(resultCollection)

            if (collectResult) { return resultCollection }
            else { return true }

        }, {
           agents: z.array(z.object({
                systemPrompt: z.string().describe('用于设置子Agent的系统角色，指导子Agent的行为和思维方式'),
                prompt: z.string().describe('用于驱动子Agent进行思考和行动的输入，可以是一个问题、任务描述或者任何需要子Agent处理的信息'),
                agentName: z.string().describe('子Agent的名称，用于区分不同的子Agent，便于管理和结果收集')            
            })),
            parallel: z.boolean().default(false).describe('决定子Agent是并行执行还是串行执行，默认为false，即串行执行。并行执行可以加快处理速度，但可能会增加资源消耗和管理复杂度'),
            collectResult: z.boolean().default(false).describe('决定是否收集子Agent的结果，默认为false。如果设置为true，工具将返回一个包含每个子Agent结果的对象；如果为false，则只返回一个表示成功的布尔值')
        })

        return createSubAgentTool
    }

    public async ready(modelCreateCallback?: (model: Model) => void): Promise<Model> {

        const model = this.chatModel
        const tools: Marisa.Tool.AnyTool[] = [...this.agentTools]

        for (const toolkit of this.agentToolkits) {
            tools.push(...toolkit.list())
        }

        for (const [serverName, server] of this.agentMCPServers.entries()) {
            const mcp = new MCPToolkit(serverName, server)
            const mcptools = await mcp.init()
            this.emit('mcprun', serverName)
            tools.push(...mcptools)
        }

        if (this.agentSkillDir) {
            const agentSkills = new AgentSkills(this.agentSkillDir)
            const [metadatas, loadTool] = await agentSkills.registerSkills()
            model.defineSkillMetadatas(...metadatas.values())
            tools.push(loadTool)
        }

        if (this.agentConfig?.enableSubAgent) {
            tools.push(this.createSubAgentTool())
        }

        model.defineTools(...tools)
        model.defineContextManager(this.modelContextManager)
        model.defineCompletionOptions(this.modelCompletionOptions)

        const plugins = [...this.modelPlugins.values()]
        for (const plugin of plugins) {
            await model.plugin(plugin)
        }

        if (this.modelRolePrompt) {
            model.defineModelRole(this.modelRolePrompt)
        }

        if (this.modelSystemPrompt) {
            model.defineSystemPrompt(this.modelSystemPrompt)
        }

        this.emit('ready')
        if (modelCreateCallback) {
            modelCreateCallback(model)
        }
        return model
    }
}
