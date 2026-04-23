import { Marisa } from "../../../types/marisa";
import ModelSessionView from "./model-session-view";
import ChatModel from "./chat-model";
import Anthropic from '@anthropic-ai/sdk'

type BuildToolFilter = (tool: Marisa.Tool.AnyTool) => boolean


export default class AnthropicChatModel extends ChatModel {

    private client: Anthropic
    constructor(modelName: Marisa.Provider.OpenAI.OpenAIChatModel, client?: Anthropic) {
        super(modelName)
        this.client = client || new Anthropic()
    }

    public override async complete(prompt: string, systemPrompt?: string, toolMap?: Map<string, Marisa.Tool.AnyTool>): Promise<Marisa.Chat.Completion.CompletionSession> {

        const completionSystemPrompt = systemPrompt || this.builsDefaultSystemPrompt() || ''
        const currentSessionView = this.createEmptySessionView()
        currentSessionView.pushMessage({
            role: 'system',
            content: completionSystemPrompt,
            timestamp: Date.now()
        })
        const userMessage = this.createUserMessage(prompt)
        currentSessionView.pushMessage(userMessage)
        await this._complete(currentSessionView, toolMap)
        const session = currentSessionView.getSession()
        this.onSessionEnd('complete', session)
        return session
    }

    private async _complete(sessionView: ModelSessionView, toolMap?: Map<string, Marisa.Tool.AnyTool>): Promise<Anthropic.Messages.Message> {
        const roundTools = (toolMap && toolMap.size) ? this.buildIsolationTool(toolMap).map(i => i.buildAsAnthropic()) : []
        const { system, messages } = sessionView.unpackToAnthropicMessages()
        const anthropicChatCreateOptions: Anthropic.Messages.MessageCreateParamsNonStreaming =
        {
            model: this.modelName,
            max_tokens: this.modelCompletionOptions.maxCompletionTokens!,
            system: system,
            messages: messages,
            tools: roundTools,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            stream: false,
        }

        const completion = await this.client.messages.create(anthropicChatCreateOptions)
        completion.stop_reason === 'tool_use'
        if (completion && completion.content) {
            const contentArray = Array.isArray(completion.content) ? completion.content : [completion.content]
            const toolCallCollections: Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall[] = []
            let assistantMessage: string = ""
            for (const content of contentArray) {
                const type = content.type
                if (typeof content === 'string') {
                    assistantMessage += content
                }
                else {
                    switch (type) {
                        case "text":
                            const str = content.text
                            assistantMessage += str
                            break
                        case "tool_use":
                        case "server_tool_use":
                            const toolCallFunctionLike: Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall = {
                                type: "function",
                                id: content.id,
                                function: {
                                    arguments: JSON.stringify(content.input),
                                    name: content.name,
                                }
                            }
                            toolCallCollections.push(toolCallFunctionLike)
                            break
                        case "web_search_tool_result":
                        case "web_fetch_tool_result":
                        case "code_execution_tool_result":
                        case "bash_code_execution_tool_result":
                        case "text_editor_code_execution_tool_result":
                        case "tool_search_tool_result":
                        case "container_upload":
                    }
                }
            }
            const assistantMsg: Marisa.Chat.Completion.CompletionMessage = {
                role: 'assistant',
                content: assistantMessage,
                tool_calls: toolCallCollections,
                timestamp: Date.now()
            };
            sessionView.pushMessage(assistantMsg)
            if (completion.stop_reason === 'tool_use' && toolMap) {
                for (const toolCallFunctionLike of toolCallCollections) {
                    try {
                        const callName = toolCallFunctionLike.type === 'function' ? toolCallFunctionLike.function.name : toolCallFunctionLike.custom.name
                        const argstr = toolCallFunctionLike.type === 'function' ? toolCallFunctionLike.function.arguments : toolCallFunctionLike.custom.input
                        const callArguments = JSON.parse(argstr)
                        const callResult = await this.handleIsolateToolCall(toolMap, callName, callArguments)
                        const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                            tool_call_id: toolCallFunctionLike.id,
                            timestamp: Date.now(),
                            is_error: false
                        }
                        sessionView.pushMessage(toolCallMessage)
                    } catch (error) {
                        const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: JSON.stringify({
                                error: 'Failed to execute function arguments parse error'
                            }),
                            tool_call_id: toolCallFunctionLike.id,
                            timestamp: Date.now(),
                            is_error: true
                        }
                        sessionView.pushMessage(toolCallErrorMessage)
                    }
                }
                return await this._complete(sessionView, toolMap)
            }
            else {
                //endturn
                const anthropicUsage = completion.usage
                const usage: Marisa.Chat.Completion.CompletionUsage = {
                    total_tokens: anthropicUsage.input_tokens + anthropicUsage.output_tokens,
                    completion_tokens: anthropicUsage.output_tokens,
                    prompt_tokens: anthropicUsage.input_tokens,
                    cache_tokens: anthropicUsage.cache_creation_input_tokens!
                }
                sessionView.updateUsage(usage)
                return completion
            }
        }
        else {
            return completion
        }
    }

    public override async invoke(prompt: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession> {
        const currentSessionView = this.createEmptySessionView()
        let systemPrompt = this.builsDefaultSystemPrompt()

        const [historySessions, systemPromptAddition] = this.modelContextManager ? await this.modelContextManager.query(prompt) : [[], '']
        systemPrompt += systemPromptAddition

        currentSessionView.pushMessage({
            role: 'system',
            content: systemPrompt,
            timestamp: Date.now()
        })

        const userMessage = this.createUserMessage(prompt)
        currentSessionView.pushMessage(userMessage)

        if (onSessionUpdate) {
            currentSessionView.sessionUpdateIndicator(onSessionUpdate)
        }

        const historySessionView = this.createEmptySessionView()
        for (const historySession of historySessions) {
            historySessionView.pushMessage(...historySession.messages)
        }

        await this._invoke(historySessionView, currentSessionView, onSessionUpdate)
        const session = currentSessionView.getSession()
        const historySession = historySessionView.getSession()

        if (this.modelContextManager) {
            await this.modelContextManager.put(session, [historySession])
        }

        currentSessionView.destory()
        historySessionView.destory()

        this.onSessionEnd('invoke', session)
        return session
    }

    private async _invoke(
        historySessionView: ModelSessionView,
        currentSessionView: ModelSessionView,
        onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
        toolFilter?: BuildToolFilter) {

        const roundTools = this.buildRoundTool(toolFilter).map(i => i.buildAsAnthropic())
        const { system, messages } = this.buildAnthropicMessages(historySessionView, currentSessionView)
        const anthropicChatCreateOptions: Anthropic.Messages.MessageCreateParamsNonStreaming =
        {
            model: this.modelName,
            max_tokens: this.modelCompletionOptions.maxCompletionTokens!,
            system: system,
            messages: messages,
            tools: roundTools,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            stream: false,
        }



    }

    private buildAnthropicMessages(historySessionView: ModelSessionView, currentSessionView: ModelSessionView): { system: string, messages: Anthropic.Messages.MessageParam[] } {
        const buildMessages: Anthropic.Messages.MessageParam[] = []
        const history = historySessionView.unpackToAnthropicMessages()
        buildMessages.push(...history.messages)
        const current = currentSessionView.unpackToAnthropicMessages()
        buildMessages.push(...current.messages)
        const system = current.system
        return { system, messages: buildMessages }
    }
}