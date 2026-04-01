import EventEmitter from "events";
import { Marisa } from "../../types/marisa";
import SystemMessageBuilder from "../builder/SystemMessageBuilder";
import { ModelContextManager } from "../context/ModelContextManager";
import BasicContextManager from "../context/BasicContextManager";
import { ModelPluginRegister, ModelRegisterMiddleware } from "../plugin/ModelPluginRegister";
import Toolkit from "../tool/Toolkit";
import ModelSessionView from "../session/ModelSessionView";

//                                         |-------------------------------------------
//userprompt ---------------------------------------->                               |      
//   |                                  contextView -> llmModel -> session -> contextManager
// systemMessageBuilder -> addition                      model                       |
// basicSystemMessage  ->     +     => systemMessage ->                         memoryStore
//   |-------------------------------------------------------------------------------|

export default abstract class Model extends EventEmitter<Marisa.Events.Model> {

    protected modelToolMap = new Map<string, Marisa.Tool.AnyTool>()
    protected modelSystemPrompt: string = ''
    protected modelRolePrompt: string = ''
    protected modelName: string
    protected modelCompletionOptions: Marisa.Model.ModelCompletionOptions = {}
    protected modelContextManager: ModelContextManager | null = null
    protected modelSkillMetadatas:Marisa.Skill.ModelSkillMetadata[] = []

    constructor(modelName: string, modelContextManager?: ModelContextManager) {
        super()
        this.modelName = modelName
        if(modelContextManager){
            this.modelContextManager = modelContextManager
        }
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

    public defineToolkits(...toolkits: Toolkit[]) {
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

    public builsDefaultSystemPrompt() {
        return this.modelSystemPrompt + this.modelRolePrompt
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
        this.modelContextManager = contextManager
        return this
    }

    public defineSkillMetadatas(...metadatas:Marisa.Skill.ModelSkillMetadata[]){
        this.modelSkillMetadatas = metadatas
    }

    protected async handleToolCall(callName: string, callArguments: Record<string, any>): Promise<string> {
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
            const result: any = await tool.execute(callArguments)
            this.emit('toolCallResult', callName, callArguments, result)
            return JSON.stringify(result)
        } catch (error) {
            this.emit('toolCallError', callName, callArguments, error)
            return JSON.stringify({ error: `Tool call Error ${error}` });
        }
    }

    public abstract invoke(prompt: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession>

    public abstract invokeStream(prompt: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession>

    public abstract complete(prompt: string, toolMap: Map<string, Marisa.Tool.AnyTool>): Promise<Marisa.Chat.Completion.CompletionSession>

    public async plugin(plugin: ModelPluginRegister) {
        const middleware = new ModelRegisterMiddleware(this)
        await plugin.Install(middleware)
    }

    public buildRoundTool(): Marisa.Tool.AnyTool[] {
        const tools = [...this.modelToolMap.values()]
        return tools
    }

    public buildIsolationTool(toolMap: Map<string, Marisa.Tool.AnyTool>): Marisa.Tool.AnyTool[] {
        const tools = [...toolMap.values()]
        return tools
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
}