import EventEmitter from "events";
import { Marisa } from "../../types/marisa";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import Model from "../model/Model";
import MCPToolkit from "../mcp/MCPToolkit";
import AgentSkills from "../skill/AgentSkills";
import { ModelContextManager } from "../context/ModelContextManager";
import VecStoreContextManager from "../context/VecStoreContextManager";
import EmbeddingModel from "../model/embedding/EmbeddingModel";
import BasicContextManager from "../context/BasicContextManager";
import VectorStore from "../vecstore/VectorStore";
import fs from 'fs'
import SubAgentManager from "./SubAgentManager";
import path from "path";
import ScheduleManager from "./Schedule";
import AgentPluginBase from "../plugin/AgentPluginBase";
import PluginInstaller from "../plugin/PluginInstaller";

interface AgentEvents {
    create: [],
    ready: [],
    mcprun: [mcpname: string],
    subAgentCreate: [options: SubAgentCreateOptions]
    subAgentComplete: [agentName: string, session: Marisa.Chat.Completion.CompletionSession]
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

    protected workspace: string = path.resolve('./workspace')
    protected client: OpenAI
    protected chatModelName: string = ''
    protected chatModel: Model
    protected agentMCPServers = new Map<string, (StdioServerParameters | URL)>()
    protected agentTools: Marisa.Tool.AnyTool[] = []
    protected agentToolkits: Marisa.Tool.AnyToolkit[] = []
    protected agentUseDefaultTools: boolean = false
    protected agentSkillDir: string | null = null
    protected agentPlugins = new Map<string, AgentPluginBase>()
    protected modelContextManager: ModelContextManager
    protected modelCompletionOptions: Partial<Omit<Marisa.Model.ModelCompletionOptions, 'modelName'>> = {}
    protected subAgentModelCompletionOptions: Partial<Omit<Marisa.Model.ModelCompletionOptions, 'modelName'>> = {}
    protected modelSessions: Marisa.Chat.Completion.CompletionSession[] = []
    protected modelRolePrompt: string | null = null
    protected modelSystemPrompt: string | null = null

    protected agentDefaultSystemPrompt = `
    Always try to use tools when necessary. If you don't know how to do something, use the tools to find out.
    
    when you need to use a tool, first think step by step to decide which tool to use and how to use it, then call the tool with the correct parameters. After getting the result from the tool, think step by step to decide if you need to use another tool or return the final answer.

    you can use sub-agents to help you complete complex tasks. when creating a sub-agent, you need to provide a clear and specific system prompt for the sub-agent, and a user prompt for the sub-agent to complete. you can create multiple sub-agents to work on different tasks in parallel, and collect the results from the sub-agents after they complete their tasks.

    Always remember to think step by step and use the tools to help you complete the tasks efficiently.
    `
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

    public config(config: Partial<AgentConfig>) {
        this.agentConfig = { ...this.agentConfig, ...config }
        return this
    }

    public useDefaultContext() {
        this.modelContextManager = new BasicContextManager()
        return this
    }

    public useContextMemory(ctxmana: ModelContextManager) {
        this.modelContextManager = ctxmana
        return this
    }

    public useModelCfg(modelCompletionOptions: Partial<Omit<Marisa.Model.ModelCompletionOptions, 'modelName'>> = {}) {
        this.modelCompletionOptions = modelCompletionOptions
        return this
    }

    public useSubAgentCfg(subAgentCompletionOptions: Partial<Omit<Marisa.Model.ModelCompletionOptions, 'modelName'>> = {}) {
        this.subAgentModelCompletionOptions = subAgentCompletionOptions
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

    public usePlugin(...pluginClass: (AgentPluginBase)[]) {
        for (const pclass of pluginClass) {
            const name = pclass.pluginName
            console.log(name)
            if (this.agentPlugins.has(name)) {
                console.warn(`plugin ${name} already exists, skipped`)
                continue
            }
            this.agentPlugins.set(name, pclass)
        }
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

    public useDefaultTools() {
        this.agentUseDefaultTools = true
        return this
    }

    public async ready(modelCreateCallback?: (model: Model) => void): Promise<Model> {

        const model = this.chatModel
        const tools: Marisa.Tool.AnyTool[] = [...this.agentTools]
        const constantTools: Marisa.Tool.AnyTool[] = []

        if (this.agentUseDefaultTools) {
            tools.push()
        }

        for (const toolkit of this.agentToolkits) {
            tools.push(...toolkit)
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
            constantTools.push(loadTool)
        }

        if (this.agentConfig?.enableSubAgent) {
            const subAgentModel = this.createChatModel(this.client, this.chatModelName)
            subAgentModel.defineCompletionOptions(this.subAgentModelCompletionOptions)
            const subAgentEnableTools: Marisa.Tool.AnyTool[] = []
            subAgentModel.defineTools(...subAgentEnableTools)
            const subAgentManager = new SubAgentManager(this.workspace, subAgentModel)
            const tool = await subAgentManager.init()
            constantTools.push(tool)
        }

        if (this.modelContextManager) {
            this.modelContextManager.inject(model)
        }

        const scheduleManager = new ScheduleManager(this.workspace, model)
        const scheduleTool = scheduleManager.init()
        constantTools.push(scheduleTool)

        model.defineConstantTools(...constantTools)
        model.defineTools(...tools)
        model.defineContextManager(this.modelContextManager)
        model.defineCompletionOptions(this.modelCompletionOptions)

        if (this.agentPlugins.size > 0) {
            for (const [name, PluginClass] of this.agentPlugins.entries()) {
                await this.pluginInstaller(model, PluginClass)
            }
        }

        if (this.modelRolePrompt) {
            model.defineModelRole(this.modelRolePrompt)
        }

        model.defineSystemPrompt(`${this.agentDefaultSystemPrompt}\n\n${this.modelSystemPrompt}`)

        this.emit('ready')
        if (modelCreateCallback) {
            modelCreateCallback(model)
        }
        return model
    }

    public async pluginInstaller(model: Model, plugin: AgentPluginBase) {

        const installer = new PluginInstaller(this.workspace)
        const installFunction = plugin.installFunction
        if (installFunction) {
            installFunction(installer)
        }
        const installed = await installer.install()
        try {
            model.defineTools(...installed.tools)
            model.defineConstantTools(...installed.constantTools)
        } catch (error) {

        }
    }
}
