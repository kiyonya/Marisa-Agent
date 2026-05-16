import EventEmitter from "events";
import { Marisa } from "@type/marisa";
import { ModelContextManager } from "@core/contextual/manager/model-context-manager";
import ToolGroup from "@core/tool/tool-group";
import ModelSessionView from "@core/model/chat/model-session-view";
import LocalTool from "@core/tool/local-tool";
import MCPTool from "@core/tool/mcp-tool";
import DynamicTool from "@core/tool/dynamic-tool";
import { Interceptor, InterceptorChain } from "@core/utils/interceptor";
import CommandProcessor from "../command/command-processor";
import chalk from "chalk";
import InquirerPermissionAsker from "@core/permission/inquirer-permission-asker";
import ChatModelComponent from "./chat-model-component";
import ChatModelComponentInstaller, { ChatModelInstallManifest } from "./chat-model-component-installer";
import ModelEndPoint from "@core/endpoint/model-endpoint";

//                                         |-------------------------------------------
//userprompt ---------------------------------------->                               |      
//   |                                  contextView -> llmModel -> session -> contextManager
// systemMessageBuilder -> addition                      model                       |
// basicSystemMessage  ->     +     => systemMessage ->                         memoryStore
//   |-------------------------------------------------------------------------------|


type ToolCallInterceptor = (tool: Marisa.Tool.AnyTool, callName: string, callArguments: Record<string, any>) => Promise<any> | any | Marisa.Tool.AnyTool

type BuildToolFilter = (tool: Marisa.Tool.AnyTool) => boolean

export type RoundToolGetter = () => Promise<Marisa.Tool.AnyTool[]>

export type ContextPutFunction = (session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void) => void

export type ContextQueryFunction = (userPrompt: string) => Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]>


abstract class ChatModelAbstractImpl extends EventEmitter<Marisa.Events.Model> {
    constructor() {
        super()
    }

    protected abstract completeHandler(
        sessionView: ModelSessionView,
        toolMap?: Map<string, Marisa.Tool.AnyTool>):
        Promise<void>

    protected abstract invokeHandler(
        sessionView: ModelSessionView,
        toolGatter: RoundToolGetter):
        Promise<void>

    protected abstract invokeStreamHandler(
        sessionView: ModelSessionView,
        toolGatter: RoundToolGetter,
        onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback):
        Promise<void>

}

abstract class ChatModelAbstractDefination extends ChatModelAbstractImpl {
    protected modelToolMap = new Map<string, Marisa.Tool.AnyToolParam>()
    protected modelSystemPrompt: string = ''
    protected modelRolePrompt: string = ''
    protected modelName: string
    protected modelCompletionOptions: Marisa.Model.ModelCompletionOptions = {}
    protected modelContextPutFunction: ContextPutFunction | null = null
    protected modelContextQueryFunction: ContextQueryFunction | null = null

    protected modelExtraSystemPrompt: string[] = []
    public workspace: string
    constructor(modelName: string, workspace: string) {
        super()
        this.modelName = modelName
        this.workspace = workspace
    }

    public defineExtraSystemPrompt(...prompt: string[]) {
        this.modelExtraSystemPrompt.push(...prompt)
        return this
    }

    public defineTools(...tools: Marisa.Tool.AnyToolParam[]) {
        for (const tool of tools) {
            const toolName = tool.toolName
            if (this.modelToolMap.has(toolName)) {
                console.warn()
            }
            this.modelToolMap.set(toolName, tool)
        }
        return this
    }

    public defineToolkits(...toolkits: ToolGroup[]) {
        for (const toolkit of toolkits) {
            this.defineTools(...toolkit.list())
        }
        return this
    }

    public defineSystemPrompt(prompt: string) {
        this.modelSystemPrompt = prompt
        return this
    }

    public defineModelRole(rolePrompt: string) {
        this.modelRolePrompt = rolePrompt
        return this
    }

    public defineCompletionOptions(options: Partial<Marisa.Model.ModelCompletionOptions>) {
        this.modelCompletionOptions = {
            ...this.modelCompletionOptions,
            ...options
        }
        if (options.modelName) {
            this.modelName = options.modelName
        }
        return this
    }

    public endpoint(Endpoint: new () => ModelEndPoint) {
        const endpoint = new Endpoint()
    }
}

export interface ModelInterceptors {
    userPromptInput: InterceptorChain<{ inputMessages: Marisa.Chat.Completion.CompletionMessage[] }>,
}

export default abstract class ChatModel extends ChatModelAbstractDefination {

    public modelToolCallInterceptor: ToolCallInterceptor | null = null

    public interceptors = ChatModel.CreateModelInterceptorChainTemplate()
    public modelCommand = new CommandProcessor()
    public permissionAsker = new InquirerPermissionAsker()

    private modelContextManagerComponent?: ModelContextManager

    get interceptorKeys() {
        return Object.keys(this.interceptors)
    }

    get modelInfo(): Marisa.Model.ChatModelInfo {
        return {
            modelName: this.modelName,
            completionOptions: this.modelCompletionOptions
        }
    }

    get contextManager() {
        return this.modelContextManagerComponent
    }

    get cpermissionAsker() {
        return this.permissionAsker
    }

    get slashCommands() {
        return [...this.modelCommand.slashCommands.keys()]
    }

    get mentionCommands() {
        return [...this.modelCommand.mentionCommands.keys()]
    }

    constructor(modelName: string, workspace: string) {
        super(modelName, workspace)

        //注册指令
        this.modelCommand.registerSlashCommand("tool", () => {
            let tip: string = chalk.bgBlue.white("当前可用的工具有\n")
            for (const [name, tool] of this.modelToolMap.entries()) {
                if (tool instanceof DynamicTool) {
                    tip += `${chalk.yellow(`[Dyanmic] ${tool.toolName}`)}\n`
                }
                else tip += `${chalk.green(name)} - ${chalk.gray(tool.description.replaceAll('\n', '').slice(0, 30))}...\n`
            }
            console.log(tip)
        })

        this.modelCommand.registerSlashCommand("syspmt", () => {
            console.log(chalk.gray(console.log(this.builsDefaultSystemPrompt())))
        })
    }

    public installComponent(component: ChatModelComponent<any>) {
        if (!component.installFunction) { return this }
        const installerBridge = new ChatModelComponentInstaller(this.workspace)
        component.installFunction(installerBridge, this.modelInfo)
        const manifest = installerBridge.createInstallManifest()
        const isModelContextManager: boolean = component instanceof ModelContextManager

        if (isModelContextManager) {
            if (manifest.context) {
                this.modelContextPutFunction = (manifest.context.putFunction)
                this.modelContextQueryFunction = (manifest.context.queryFunction)
            }
            this.modelContextManagerComponent = component as ModelContextManager
        }
        else if (manifest.context) {
            throw new Error('only class Extends ModelContextManager can install context callback')
        }
        this.handleManifestInstall(manifest)
        return this
    }

    private handleManifestInstall(manifest: ChatModelInstallManifest) {
        if (manifest.tools) {
            this.defineTools(...manifest.tools)
        }
        if (manifest.modelInterceptors) {
            for (const [type, interceptors] of Object.entries(manifest.modelInterceptors)) {
                for (const interceptor of interceptors) {
                    this.installModelInterceptor(type as keyof Marisa.Model.ModelInterceptors, interceptor)
                }
            }
        }
        if (manifest.modelSlashCommands?.size) {
            for (const [command, callback] of manifest.modelSlashCommands.entries()) {
                this.installSlashCommand(command, callback)
            }
        }
        if (manifest.modelMentionCommands?.size) {
            for (const [command, callback] of manifest.modelMentionCommands.entries()) {
                this.installMentionCommand(command, callback)
            }
        }
    }

    public installModelInterceptor<K extends keyof Marisa.Model.ModelInterceptors>(type: K, interceptor: Interceptor<Marisa.Model.ModelInterceptors[K]>) {
        this.interceptors[type].addInterceptor(interceptor)
        return this
    }

    public installSlashCommand(command: string, callback: (...args: string[]) => any) {
        this.modelCommand.registerSlashCommand(command, callback)
        return this
    }

    public installMentionCommand(command: string, callback: (...args: string[]) => any) {
        this.modelCommand.registerMentionCommand(command, callback)
        return this
    }

    public async complete(prompt: string, systemPrompt?: string, toolMap?: Map<string, Marisa.Tool.AnyTool>): Promise<Marisa.Chat.Completion.CompletionSession> {

        const completionSystemPrompt: string = systemPrompt || this.builsDefaultSystemPrompt() || ''
        const userMessage = await this.createUserMessage(prompt)

        const sessionView = new ModelSessionView()
        sessionView.setSystemPrompt(completionSystemPrompt)
        sessionView.pushMessageToCurrentSession(...userMessage)

        await this.completeHandler(sessionView, toolMap)

        const session = sessionView.getSession()
        return session
    }

    public async invoke(prompt: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession | 'cmd'> {

        const userMessage = await this.createChatUserMessage(prompt)
        if (userMessage === null) {
            return 'cmd'
        }

        let systemPrompt = this.builsDefaultSystemPrompt()
        const [historySessions, systemPromptAddition] = this.modelContextQueryFunction ? await this.modelContextQueryFunction(prompt) : [[], '']
        systemPrompt += systemPromptAddition

        const sessionView = new ModelSessionView()
        sessionView.setSystemPrompt(systemPrompt)
        sessionView.setHistorySessions(historySessions)
        sessionView.pushMessageToCurrentSession(...userMessage)


        if (onSessionUpdate) {
            sessionView.sessionUpdateIndicator(onSessionUpdate)
        }

        const toolGatter = () => this.buildRoundTool()

        await this.invokeHandler(sessionView, toolGatter)

        const historySession = sessionView.getHistorySessions()
        const session = sessionView.getNoTemporarySession()

        if (this.modelContextPutFunction) {
            await this.modelContextPutFunction(session, historySession)
        }

        sessionView.destory()

        return session
    }

    public async invokeStream(prompt: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession | "cmd"> {

        const userMessage = await this.createChatUserMessage(prompt)
        if (userMessage === null) {
            return 'cmd'
        }

        let systemPrompt = this.builsDefaultSystemPrompt()
        const [historySessions, systemPromptAddition] = this.modelContextQueryFunction ? await this.modelContextQueryFunction(prompt) : [[], '']
        systemPrompt += systemPromptAddition

        const sessionView = new ModelSessionView()
        sessionView.setSystemPrompt(systemPrompt)
        sessionView.setHistorySessions(historySessions)
        sessionView.pushMessageToCurrentSession(...userMessage)


        if (onSessionUpdate) {
            sessionView.sessionUpdateIndicator(onSessionUpdate)
        }

        const toolGatter = () => this.buildRoundTool()

        await this.invokeStreamHandler(sessionView, toolGatter, onResponse)

        const historySession = sessionView.getHistorySessions()
        const session = sessionView.getNoTemporarySession()

        if (this.modelContextPutFunction) {
            await this.modelContextPutFunction(session, historySession)
        }

        sessionView.destory()

        return session
    }

    public async invokeIsolate(prompt: string, l1sysPrompt?: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback, roundToolFilter?: BuildToolFilter): Promise<Marisa.Chat.Completion.CompletionSession> {

        const userMessage = await this.createUserMessage(prompt)
        let systemPrompt = this.builsDefaultSystemPrompt(l1sysPrompt)

        const [_, systemPromptAddition] = this.modelContextQueryFunction ? await this.modelContextQueryFunction(prompt) : [[], '']
        systemPrompt += systemPromptAddition

        const sessionView = new ModelSessionView()
        sessionView.setSystemPrompt(systemPrompt)
        sessionView.pushMessageToCurrentSession(...userMessage)

        if (onSessionUpdate) {
            sessionView.sessionUpdateIndicator(onSessionUpdate)
        }

        const toolGatter = () => this.buildRoundTool(roundToolFilter)
        await this.invokeHandler(sessionView, toolGatter)

        const session = sessionView.getNoTemporarySession()
        sessionView.destory()

        return session
    }

    public async invokeStreamIsolate(prompt: string, l1sysPrompt?: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback, roundToolFilter?: BuildToolFilter): Promise<Marisa.Chat.Completion.CompletionSession> {

        const userMessage = await this.createUserMessage(prompt)

        let systemPrompt = this.builsDefaultSystemPrompt(l1sysPrompt)
        const [_, systemPromptAddition] = this.modelContextQueryFunction ? await this.modelContextQueryFunction(prompt) : [[], '']
        systemPrompt += systemPromptAddition

        const sessionView = new ModelSessionView()
        sessionView.setSystemPrompt(systemPrompt)
        sessionView.pushMessageToCurrentSession(...userMessage)

        if (onSessionUpdate) {
            sessionView.sessionUpdateIndicator(onSessionUpdate)
        }

        const toolGatter = () => this.buildRoundTool(roundToolFilter)
        await this.invokeStreamHandler(sessionView, toolGatter, onResponse)
        const session = sessionView.getSession()
        sessionView.destory()
        return session
    }

    protected async handleToolCall(callName: string, callArguments: Record<string, any>): Promise<string> {
        let tool = this.modelToolMap.get(callName)
        if (!tool) {
            return JSON.stringify({ error: `Tool ${callName} not found.` });
        }
        if (tool instanceof DynamicTool) {
            tool = await tool.generate()
        }
        tool = tool as Marisa.Tool.AnyTool
        return this.runTool(tool, callName, callArguments, true)
    }

    protected async handleIsolateToolCall(toolMap: Map<string, Marisa.Tool.AnyTool>, callName: string, callArguments: Record<string, any>): Promise<string> {
        const tool = toolMap.get(callName)
        if (!tool) {
            return JSON.stringify({ error: `Tool ${callName} not found.` });
        }
        return this.runTool(tool, callName, callArguments, false)
    }

    protected async runTool(tool: Marisa.Tool.AnyTool, callName: string, callArguments: Record<string, any>, needPermission: boolean) {
        try {
            this.emit('toolCall', callName, callArguments)
            let result: any = null
            if (this.modelToolCallInterceptor) {
                const interceptorReturns = await this.modelToolCallInterceptor(tool, callName, callArguments)
                if (interceptorReturns instanceof LocalTool || interceptorReturns instanceof MCPTool) {
                    result = await interceptorReturns.execute(callArguments)
                }
                else {
                    result = interceptorReturns
                }
            }
            else {
                if (tool instanceof MCPTool) {
                    result = await tool.execute(callArguments)
                }
                else if (tool instanceof LocalTool) {
                    result = await tool.execute(callArguments, this.permissionAsker)
                }
            }
            this.emit('toolCallResult', callName, callArguments, result)
            return JSON.stringify(result)
        } catch (error) {
            this.emit('toolCallError', callName, callArguments, error)
            return JSON.stringify({ error: `Tool call Error ${error}` });
        }
    }

    public async buildRoundTool(buildToolFilter?: BuildToolFilter): Promise<Marisa.Tool.AnyTool[]> {
        let tools: Marisa.Tool.AnyTool[] = []

        for (const toolParam of this.modelToolMap.values()) {
            if (toolParam instanceof DynamicTool) {
                const generatedTool = await toolParam.generate()
                tools.push(generatedTool)
            }
            else {
                tools.push(toolParam)
            }
        }

        const uniqueTools = new Map<string, Marisa.Tool.AnyTool>();
        for (const tool of tools) {
            if (!uniqueTools.has(tool.toolName)) {
                uniqueTools.set(tool.toolName, tool);
            }
        }
        tools = Array.from(uniqueTools.values());

        if (buildToolFilter) {
            tools = tools.filter(buildToolFilter)
        }
        return tools
    }

    public buildIsolationTool(toolMap: Map<string, Marisa.Tool.AnyTool>): Marisa.Tool.AnyTool[] {
        const tools = [...toolMap.values()]
        return tools
    }

    public builsDefaultSystemPrompt(customL1?: string): string {

        const promptFragsL1: string[] = customL1 ? [customL1] : [this.modelSystemPrompt, this.modelRolePrompt]
        const promptFragsL2: string[] = []
        const promptFragsL3: string[] = [...this.modelExtraSystemPrompt]
        const promptFrags: string[] = [...promptFragsL1, ...promptFragsL2, ...promptFragsL3].filter(i => i !== null)

        return promptFrags.join('\n\n')
    }

    protected getTimeContext() {
        const now = new Date()
        const week = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]
        const timeContext = `Current time is ${now.toLocaleString()} ${week}.`
        return timeContext
    }

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

    public createEmptySessionView() {
        return new ModelSessionView(this.createEmptySession())
    }

    public async createUserMessage(userPrompt: string) {
        const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
            content: userPrompt,
            role: 'user',
            //@ts-ignore
            cache_control: { "type": "ephemeral" }
        }
        const _ = await this.interceptors.userPromptInput.through({ inputMessages: [userMessage] })
        return _.inputMessages
    }

    public async createChatUserMessage(userPrompt: string) {
        const isSlashCommand = this.modelCommand.isSlashCommand(userPrompt)
        if (isSlashCommand) {
            await this.modelCommand.runSlashCommand(userPrompt)
            return null
        }
        else {
            return this.createUserMessage(userPrompt)
        }
    }

    public createSystemMessage(systemPrompt: string) {
        const systemMessage: Marisa.Chat.Completion.Messages.ChatCompletionSystemMessage = {
            role: 'system',
            content: systemPrompt,
            timestamp: Date.now()
        }
        return systemMessage
    }

    public getModelToolMap() {
        return this.modelToolMap
    }

    public static CreateModelInterceptorChainTemplate() {
        const interceptors: { [K in keyof Marisa.Model.ModelInterceptors]: InterceptorChain<Marisa.Model.ModelInterceptors[K]> } = {
            userPromptInput: new InterceptorChain<{ inputMessages: Marisa.Chat.Completion.CompletionMessage[] }>(),
        }
        return interceptors
    }

}