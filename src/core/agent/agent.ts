import EventEmitter from "events";
import { Marisa } from "../../types/marisa";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import ChatModel from "../model/chat/chat-model";
import MCPToolGroup from "../mcp/mcp-tool-group";
import { ModelContextManager } from "../contextual/manager/model-context-manager";
import EmbeddingModel from "../model/embedding/embedding-model";
import BasicContextManager from "../contextual/manager/basic-context-manager";
import fs from 'fs'
import path from "path";
import AgentPluginBase from "../plugin/agent-plugin-base";
import PluginInstaller from "../plugin/plugin-installer";
import AgentComponent from "./impl/agent-component";
import AgentComponentInstaller from "./impl/agent-component-installer";
import ToolGroup from "@core/tool/tool-group";
import ChatModelComponent from "@core/model/chat/chat-model-component";
import { Interceptor } from "@core/utils/interceptor";
import AgentTODO from "./todo/todo";

interface AgentEvents {
    create: [],
    ready: [],
    mcprun: [mcpname: string],
    subAgentCreate: [options: SubAgentCreateOptions]
    subAgentComplete: [agentName: string, session: Marisa.Chat.Completion.CompletionSession]
}

interface AgentOptions {
    enableSubAgent?: boolean,
    enableAutoDream?: boolean,
    enableSkill?: boolean,
    enableSchedule?: boolean
    enableAgentCreateTODO?: boolean
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


abstract class AgentDefination extends EventEmitter<AgentEvents> {

    protected workspace: string
    protected client: OpenAI
    protected chatModelName: string = ''
    protected chatModel: ChatModel
    protected agentMCPServers = new Map<string, (StdioServerParameters | URL)>()
    protected agentTools: Marisa.Tool.AnyToolParam[] = []
    protected agentToolkits: Marisa.Tool.AnyToolkit[] = []
    protected agentUseDefaultTools: boolean = false
    protected agentPlugins = new Map<string, AgentPluginBase>()
    protected agentComponents: AgentComponent<any>[] = []
    protected modelMemoryComponent?: ModelContextManager
    protected modelCompletionOptions: Partial<Omit<Marisa.Model.ModelCompletionOptions, 'modelName'>> = {}
    protected subAgentModelCompletionOptions: Partial<Omit<Marisa.Model.ModelCompletionOptions, 'modelName'>> = {}
    protected modelSessions: Marisa.Chat.Completion.CompletionSession[] = []
    protected modelRolePrompt: string | null = null
    protected modelSystemPrompt: string | null = null

    protected agentDefaultSystemPrompt = `Always try to use tools when necessary. If you don't know how to do something, use the tools to find out.`
    protected agentOptions?: AgentOptions

    constructor(workspace: string, chatModelName: string, client: OpenAI, sessions?: Marisa.Chat.Completion.CompletionSession[]) {
        super()
        this.workspace = path.resolve(workspace)
        this.client = client
        this.chatModelName = chatModelName
        this.chatModel = this.createChatModel(this.client, chatModelName)
        if (sessions) {
            this.modelSessions = sessions
        }
        this.emit('create')
    }

    //不同平台自行实现
    protected abstract createEmbeddingModel(client: OpenAI, modelName: string, dimonsion: number): EmbeddingModel
    protected abstract createChatModel(client: OpenAI, modelName: string): ChatModel

    public config(config: Partial<AgentOptions>) {
        this.agentOptions = { ...this.agentOptions, ...config }
        return this
    }

    public useDefaultContext() {
        this.modelMemoryComponent = new BasicContextManager()
        return this
    }

    public useMemory(memoryComponent: ModelContextManager) {
        this.modelMemoryComponent = memoryComponent
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

    public useTool(...tools: Marisa.Tool.AnyToolParam[]) {
        this.agentTools.push(...tools)
        return this
    }

    public useToolGroups(...toolkits: Marisa.Tool.AnyToolkit[]) {
        this.agentToolkits.push(...toolkits)
        return this
    }

    public usePlugin(...pluginClass: (AgentPluginBase)[]) {
        for (const pclass of pluginClass) {
            const name = pclass.pluginName
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

    public useComponent(agentComponent: AgentComponent<any>) {
        this.agentComponents.push(agentComponent)
        return this
    }

}

export default abstract class Agent extends AgentDefination {

    constructor(workspace: string, chatModelName: string, client: OpenAI, sessions?: Marisa.Chat.Completion.CompletionSession[]) {
        super(workspace, chatModelName, client, sessions)
    }

    public async ready(modelCreateCallback?: (model: ChatModel) => void): Promise<ChatModel> {

        const model = this.chatModel
        const readyComponents: AgentComponent<any>[] = [...this.agentComponents]
        const readyTools: Marisa.Tool.AnyToolParam[] = []
        const readyToolGroups: ToolGroup[] = []
        const readyMCPServers = new Map<string, URL | StdioServerParameters>()
        const readyPlugins: AgentPluginBase[] = []
        const readyExtraSystemPrompt: string[] = []
        const readyModelComponents: ChatModelComponent<any>[] = []
        const readyModelInterceptorRecords: { [K in keyof Marisa.Model.ModelInterceptors]?: Interceptor<Marisa.Model.ModelInterceptors[K]>[] }[] = []
        const readyModelSlashCommands = new Map<string, (...args: string[]) => any>()
        const readyModelMentionCommands = new Map<string, (...args: string[]) => any>()

        if (this.agentTools.length) {
            readyTools.push(...this.agentTools)
        }
        if (this.agentToolkits.length) {
            readyToolGroups.push(...this.agentToolkits)
        }
        if (this.agentMCPServers.size) {
            for (const [name, server] of this.agentMCPServers.entries()) {
                readyMCPServers.set(name, server)
            }
        }
        if (this.agentPlugins.size) {
            readyPlugins.push(...this.agentPlugins.values())
        }
        if (this.modelMemoryComponent) {
            readyModelComponents.push(this.modelMemoryComponent)
        }

        //解压组件
        if (readyComponents.length) {
            for (const agentComponent of readyComponents) {
                try {
                    if (!agentComponent.installFunction) {
                        continue
                    }
                    const installerBridge = new AgentComponentInstaller(this.workspace, model)
                    await agentComponent.installFunction(installerBridge)
                    const manifest = installerBridge.createInstallManifest()

                    if (manifest.tools) {
                        readyTools.push(...manifest.tools)
                    }
                    if (manifest.toolGroups) {
                        readyToolGroups.push(...manifest.toolGroups)
                    }
                    if (manifest.mcps && manifest.mcps.size) {
                        for (const [name, server] of manifest.mcps.entries()) {
                            readyMCPServers.set(name, server)
                        }
                    }
                    if (manifest.plugins?.length) {
                        readyPlugins.push(...manifest.plugins)
                    }
                    if (manifest.modelComponent?.length) {
                        readyModelComponents.push(...manifest.modelComponent)
                    }
                    if (manifest.modelInterceptors) {
                        readyModelInterceptorRecords.push(manifest.modelInterceptors)
                    }
                    if (manifest.modelSlashCommands && manifest.modelSlashCommands.size) {
                        for (const [cmd, callback] of manifest.modelSlashCommands.entries()) {
                            readyModelSlashCommands.set(cmd, callback)
                        }
                        manifest.modelSlashCommands.clear()
                    }
                    if (manifest.modelMentionCommands && manifest.modelMentionCommands.size) {
                        for (const [cmd, callback] of manifest.modelMentionCommands.entries()) {
                            readyModelSlashCommands.set(cmd, callback)
                        }
                        manifest.modelMentionCommands.clear()
                    }
                    if (manifest.modelSystemPromptFragments?.length) {
                        readyExtraSystemPrompt.push(...manifest.modelSystemPromptFragments)
                    }
                } catch (error) {
                }
            }
        }

        //解压agent插件
        //上一步可能会增加新的插件
        for (const plugin of readyPlugins) {
            const installer = new PluginInstaller(this.workspace)
            const installFunction = plugin.installFunction
            if (installFunction) {
                await installFunction(installer)
            }
            const installed = await installer.install()
            try {
                readyTools.push(...installed.tools)
                readyExtraSystemPrompt.push(...installed.systemPrompts)
            } catch (error) {
                continue
            }
        }

        //解压工具箱
        for (const toolgroup of readyToolGroups) {
            readyTools.push(...toolgroup)
        }

        //安装mcp服务器
        for (const [serverName, server] of readyMCPServers.entries()) {
            const mcp = new MCPToolGroup(serverName, server)
            const mcptools = await mcp.init()
            this.emit('mcprun', serverName)
            readyTools.push(...mcptools)
        }

        //gc
        readyComponents.length = 0
        readyPlugins.length = 0
        readyToolGroups.length = 0
        readyMCPServers.clear()

        //注入
        for (const component of readyModelComponents) {
            model.installComponent(component)
        }
        model.defineTools(...readyTools)
        model.defineCompletionOptions(this.modelCompletionOptions)
        if (this.modelRolePrompt) {
            model.defineModelRole(this.modelRolePrompt)
        }
        const agentSystemPrompt = [this.agentDefaultSystemPrompt, this.modelSystemPrompt].filter(Boolean).join('\n\n')
        model.defineSystemPrompt(agentSystemPrompt)
        if (readyModelInterceptorRecords.length) {
            for (const r of Object.values(readyModelInterceptorRecords)) {
                for (const [type, interceptors] of Object.entries(r)) {
                    for (const interceptor of interceptors) {
                        model.installModelInterceptor(type as keyof Marisa.Model.ModelInterceptors, interceptor)
                    }
                }
            }
        }
        if (readyModelSlashCommands.size) {
            for (const [command, callback] of readyModelSlashCommands.entries()) {
                model.installSlashCommand(command, callback)
            }
        }
        if (readyModelMentionCommands.size) {
            for (const [command, callback] of readyModelMentionCommands.entries()) {
                model.installMentionCommand(command, callback)
            }
        }

        this.emit('ready')
        if (modelCreateCallback) {
            modelCreateCallback(model)
        }
        return model
    }
}
