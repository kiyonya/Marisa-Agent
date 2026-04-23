import EventEmitter from "events";
import { Marisa } from "../../../types/marisa";
import { ModelContextManager } from "../../contextual/manager/model-context-manager";
import ToolGroup from "../../tool/tool-group";
import ModelSessionView from "../chat/model-session-view";
import LocalTool from "../../tool/local-tool";
import z from "zod";
import ToolBase from "../../tool/tool-base";
import MCPTool from "../../tool/mcp-tool";

//                                         |-------------------------------------------
//userprompt ---------------------------------------->                               |      
//   |                                  contextView -> llmModel -> session -> contextManager
// systemMessageBuilder -> addition                      model                       |
// basicSystemMessage  ->     +     => systemMessage ->                         memoryStore
//   |-------------------------------------------------------------------------------|


type ToolCallInterceptor = (tool: Marisa.Tool.AnyTool, callName: string, callArguments: Record<string, any>) => Promise<any> | any | Marisa.Tool.AnyTool

type BuildToolFilter = (tool: Marisa.Tool.AnyTool) => boolean

export default abstract class ChatModel extends EventEmitter<Marisa.Events.Model> {

    protected modelConstantToolSet = new Set<Marisa.Tool.AnyTool>()
    protected modelToolMap = new Map<string, Marisa.Tool.AnyTool>()
    protected modelSystemPrompt: string = ''
    protected modelRolePrompt: string = ''
    protected modelName: string
    protected modelCompletionOptions: Marisa.Model.ModelCompletionOptions = {}
    protected modelContextManager: ModelContextManager | null = null
    protected modelSkillMetadatas: Marisa.Skill.ModelSkillMetadata[] = []

    protected modelExtraSystemPrompt:string[] = []

    protected modelProgressiveToolCaller: LocalTool<{ toolNames: string[] }>
    protected modelNextProgressTurnTools: Marisa.Tool.AnyTool[] = []

    public modelToolCallInterceptor: ToolCallInterceptor | null = null

    constructor(modelName: string, modelContextManager?: ModelContextManager) {
        super()
        this.modelName = modelName
        if (modelContextManager) {
            this.modelContextManager = modelContextManager
        }

        this.modelProgressiveToolCaller = new LocalTool<{ toolNames: string[] }>('load_tools', '加载需要的工具，调用工具后会将对应的工具注入聊天上下文', ({ toolNames }) => {
            const injectedToolNames: string[] = []
            for (const name of toolNames) {
                const tool = this.modelToolMap.get(name)
                if (tool) {
                    this.modelNextProgressTurnTools.push(tool)
                    injectedToolNames.push(name)
                }
            }
            return injectedToolNames
        }, {
            toolNames: z.array(z.string())
        })

    }

    public defineExtraSystemPrompt(...prompt:string[]){
        this.modelExtraSystemPrompt.push(...prompt)
        return this
    }

    public defineConstantTools(...tools: Marisa.Tool.AnyTool[]) {

        for (const tool of tools) {
            this.modelConstantToolSet.add(tool)
            const toolName = tool.toolName
            this.modelToolMap.set(toolName, tool)
        }

        return this
    }

    public defineTools(...tools: Marisa.Tool.AnyTool[]) {
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

    public defineUseProgressiveToolLoader(is: boolean = true) {
        this.modelCompletionOptions.enableProgressiveTools = is
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

    public defineContextManager(contextManager: ModelContextManager) {
        if (this.modelContextManager) {
            this.modelContextManager.removeAllListeners()
        }
        this.modelContextManager = contextManager
        for (const e of this.modelContextManager.myEvents) {
            this.modelContextManager.on(e, (...args) => { this.emit(e, ...args) })
        }
        return this
    }

    public defineSkillMetadatas(...metadatas: Marisa.Skill.ModelSkillMetadata[]) {
        this.modelSkillMetadatas = metadatas
    }

    public defineWhoIAm() {

    }

    protected async handleToolCall(callName: string, callArguments: Record<string, any>): Promise<string> {
        //渐进式拦截
        if (callName === this.modelProgressiveToolCaller.toolName && this.modelCompletionOptions?.enableProgressiveTools) {
            return this.runTool(this.modelProgressiveToolCaller, callName, callArguments)
        }
        const tool = this.modelToolMap.get(callName)
        if (!tool) {
            return JSON.stringify({ error: `Tool ${callName} not found.` });
        }
        return this.runTool(tool, callName, callArguments)
    }

    protected async handleIsolateToolCall(toolMap: Map<string, Marisa.Tool.AnyTool>, callName: string, callArguments: Record<string, any>): Promise<string> {
        const tool = toolMap.get(callName)
        if (!tool) {
            return JSON.stringify({ error: `Tool ${callName} not found.` });
        }
        return this.runTool(tool, callName, callArguments)
    }

    protected async runTool(tool: Marisa.Tool.AnyTool, callName: string, callArguments: Record<string, any>) {
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
                result = await tool.execute(callArguments)
            }
            this.emit('toolCallResult', callName, callArguments, result)
            return JSON.stringify(result)
        } catch (error) {
            this.emit('toolCallError', callName, callArguments, error)
            return JSON.stringify({ error: `Tool call Error ${error}` });
        }
    }

    public abstract invoke(prompt: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession>

    public abstract invokeStream(prompt: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession>

    public abstract complete(prompt: string, systemPrompt?: string, toolMap?: Map<string, Marisa.Tool.AnyTool>): Promise<Marisa.Chat.Completion.CompletionSession>

    public abstract invokeIsolate(prompt: string, l1sysPrompt?: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback, roundToolFilter?: BuildToolFilter): Promise<Marisa.Chat.Completion.CompletionSession>

    public abstract invokeStreamIsolate(prompt: string, l1sysPrompt?: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback, roundToolFilter?: BuildToolFilter): Promise<Marisa.Chat.Completion.CompletionSession>

    public buildRoundTool(buildToolFilter?: BuildToolFilter): Marisa.Tool.AnyTool[] {
        let tools: Marisa.Tool.AnyTool[] = []
        if (this.modelCompletionOptions?.enableProgressiveTools) {
            const adminTools = [...this.modelToolMap.values()].filter(i => this.modelConstantToolSet.has(i))
            tools.push(...adminTools)
            tools.push(this.modelProgressiveToolCaller)
            tools.push(...this.modelNextProgressTurnTools)
        }
        else {
            tools.push(...this.modelToolMap.values())
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

        console.warn(`本轮工具 ${tools.map(u=>u.toolName)}`)
        return tools
    }

    public buildIsolationTool(toolMap: Map<string, Marisa.Tool.AnyTool>): Marisa.Tool.AnyTool[] {
        const tools = [...toolMap.values()]
        return tools
    }

    //dydy
    public buildProgressiveToolPrompt() {
        const toolDescRecord: Record<string, string> = {}
        for (const [name, tool] of this.modelToolMap.entries()) {
            toolDescRecord[name] = tool.description
        }
        const prompt = `##渐进式加载你的工具\n当前开启了渐进式工具加载，你在调用工具前必须先使用一个叫load_tools的工具来加载工具，调用这个工具时，你需要提供一个工具名称的数组，工具名称需要完全匹配，工具列表和对应的描述如下：\n${JSON.stringify(toolDescRecord,null,2)}，\n调用工具后会将对应的工具注入到聊天上下文中，在本轮后续的对话中你就可以使用这些工具了。如果你需要其他的工具了，你可以再次调用load_tools工具来加载，本次对话的工具会叠加。`
        return prompt
    }

    public builsDefaultSystemPrompt(customL1?: string): string {

        const promptFragsL1:string[] = customL1 ? [customL1] : [this.modelSystemPrompt, this.modelRolePrompt]

        const promptFragsL2:string[] = []

        const promptFragsL3:string[] = [...this.modelExtraSystemPrompt]

        const promptFrags: string[] = [...promptFragsL1,...promptFragsL2,...promptFragsL3].filter(i=>i !== null)

        if (this.modelCompletionOptions?.enableProgressiveTools) {
            promptFrags.push(this.buildProgressiveToolPrompt())
        }
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

    public createUserMessage(userPrompt: string) {
        const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
            content: userPrompt,
            role: 'user',
            //@ts-ignore
            cache_control: { "type": "ephemeral" }
        }
        return userMessage
    }

    public getModelToolMap() {
        return this.modelToolMap
    }

    //events
    protected onSessionEnd(mode: 'complete' | 'invoke' | 'invokeStream', session: Marisa.Chat.Completion.CompletionSession) {

        if (this.modelCompletionOptions?.enableProgressiveTools && this.modelNextProgressTurnTools.length) {
            this.modelNextProgressTurnTools = []
        }

        this.emit('sessionEnd', mode, session)
    }

    protected pipeModelContextManagerEvents() {
        if (this.modelContextManager) {

        }
    }
}