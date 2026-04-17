import OpenAI from "openai";
import { Marisa } from "../../../types/marisa";
import Model from "../Model";
import ModelSessionView from "../../session/ModelSessionView";

type BuildToolFilter = (tool:Marisa.Tool.AnyTool)=>boolean

export default class OpenAIModel extends Model {

    private client: OpenAI
    constructor(OpenAIModelName: Marisa.Provider.OpenAI.OpenAIChatModel, client?: OpenAI) {
        super(OpenAIModelName)
        this.client = client || new OpenAI()
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

    private async _complete(sessionView: ModelSessionView, toolMap?: Map<string, Marisa.Tool.AnyTool>): Promise<OpenAI.Chat.Completions.ChatCompletion> {

        const roundTools = (toolMap && toolMap.size) ? this.buildIsolationTool(toolMap).map(i => i.build()) : []
        const messages = this.headSystemMessages(sessionView.unpackToOpenAIMessages())

        const openaiChatCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams =
        {
            model: this.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: messages,
            stream: false,
            tools: roundTools,
            prompt_cache_retention: this.modelCompletionOptions.promptCacheRetention,
            tool_choice: this.modelCompletionOptions.toolChoice,
            parallel_tool_calls: this.modelCompletionOptions.parallelToolCalls,
        }
        const completion = await this.client.chat.completions.create(openaiChatCreateOptions)
        const choice = completion.choices[0];
        if (choice && choice.message) {
            const assistantMsg: Marisa.Chat.Completion.CompletionMessage = {
                role: 'assistant',
                content: choice.message.content || '',
                tool_calls: choice.message.tool_calls,
                timestamp: Date.now()
            };
            sessionView.pushMessage(assistantMsg)
            if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
                for (const toolCall of choice.message.tool_calls) {
                    if (toolCall.type === 'function' && toolMap) {
                        try {
                            const callName = toolCall.function.name
                            const callArguments = JSON.parse(toolCall.function.arguments)

                            this.emit('toolCall', callName, callArguments)

                            const callResult = await this.handleIsolateToolCall(toolMap, callName, callArguments)

                            const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                                tool_call_id: toolCall.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessage(toolCallMessage)
                        } catch (error) {
                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolCall.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessage(toolCallErrorMessage)
                        }
                    }
                }
                return await this._complete(sessionView, toolMap);
            }
        }
        if (completion.usage) { sessionView.updateUsage(completion.usage) }
        const chatCompletion: OpenAI.Chat.Completions.ChatCompletion = {
            id: '',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: process.env.MODEL_NAME || 'gpt-4',
            choices: [
                {
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: choice?.message?.content || '',
                        refusal: null,
                        tool_calls: choice?.message?.tool_calls
                    },
                    finish_reason: choice?.finish_reason || 'stop',
                    logprobs: null
                }
            ],
            usage: completion.usage
        }
        return chatCompletion;
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
        toolFilter?:BuildToolFilter
    ): Promise<void> {

        const roundTools = this.buildRoundTool(toolFilter).map(i => i.build())

        const openaiChatCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams =
        {
            model: this.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: this.buildOpenAIMessages(historySessionView, currentSessionView),
            stream: false,
            tools: roundTools,
            prompt_cache_retention: this.modelCompletionOptions.promptCacheRetention,
            tool_choice: this.modelCompletionOptions.toolChoice,
            parallel_tool_calls: this.modelCompletionOptions.parallelToolCalls,
        }

        const completion = await this.client.chat.completions.create(openaiChatCreateOptions)
        const choice = completion.choices[0];
        if (choice && choice.message) {

            const assistantMsg: Marisa.Chat.Completion.CompletionMessage = {
                role: 'assistant',
                content: choice.message.content || '',
                tool_calls: choice.message.tool_calls,
                timestamp: Date.now(),

            };

            //@ts-ignore
            if (choice.reasoning_content) {
                //@ts-ignore
                assistantMsg.reasoning_content = choice.reasoning_content
            }

            currentSessionView.pushMessage(assistantMsg)

            if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
                for (const toolCall of choice.message.tool_calls) {
                    if (toolCall.type === 'function') {
                        try {
                            const callName = toolCall.function.name
                            const callArguments = JSON.parse(toolCall.function.arguments)

                            this.emit('toolCall', callName, callArguments)

                            const callResult = await this.handleToolCall(callName, callArguments)

                            const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                                tool_call_id: toolCall.id,
                                timestamp: Date.now()
                            }

                            currentSessionView.pushMessage(toolCallMessage)

                        } catch (error) {

                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolCall.id,
                                timestamp: Date.now()
                            }
                            currentSessionView.pushMessage(toolCallErrorMessage)
                        }
                    }
                }
                return await this._invoke(historySessionView, currentSessionView, onSessionUpdate,toolFilter);
            }
        }

        const usage = {
            prompt_tokens: completion?.usage?.prompt_tokens || 0,
            completion_tokens: completion?.usage?.completion_tokens || 0,
            total_tokens: completion?.usage?.total_tokens || 0
        }
        currentSessionView.updateUsage(usage)
    }

    public override async invokeStream(prompt: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback): Promise<Marisa.Chat.Completion.CompletionSession> {

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

        const complete = await this._invokeStream(historySessionView, currentSessionView, onResponse, onSessionUpdate)
        const session = currentSessionView.getSession()
        const historySession = historySessionView.getSession()
        if (this.modelContextManager) {
            await this.modelContextManager.put(session, [historySession])
        }

        currentSessionView.destory()
        historySessionView.destory()

        this.onSessionEnd('invokeStream', session)
        return session
    }

    private async _invokeStream(
        historySessionView: ModelSessionView,
        currentSessionView: ModelSessionView,
        onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback,
        onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
        toolFilter?:BuildToolFilter,
    ): Promise<void> {

        const roundTools = this.buildRoundTool(toolFilter).map(i => i.build())
        const openaiChatStreamCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
        {
            model: this.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: this.buildOpenAIMessages(historySessionView, currentSessionView),
            stream: true,
            tools: roundTools,
            prompt_cache_retention: this.modelCompletionOptions.promptCacheRetention,
            tool_choice: this.modelCompletionOptions.toolChoice,
            parallel_tool_calls: this.modelCompletionOptions.parallelToolCalls,
        }

        const chatStream = await this.client.chat.completions.create(
            openaiChatStreamCreateOptions
        )

        let responseContent = ''
        const toolCallsMap: Record<number, OpenAI.Chat.Completions.ChatCompletionMessageToolCall> = {}
        let finishReason: OpenAI.Chat.Completions.ChatCompletionChunk['choices'][0]['finish_reason'] =
            null

        const assistantMessage: Marisa.Chat.Completion.CompletionMessage = {
            role: 'assistant',
            content: responseContent,
            timestamp: Date.now()
        }

        for await (const event of chatStream) {
            if (event.usage) {
                const usage = {
                    prompt_tokens: event.usage.prompt_tokens || 0,
                    completion_tokens: event.usage.completion_tokens || 0,
                    total_tokens: event.usage.total_tokens || 0
                }
                currentSessionView.updateUsage(usage)
            }

            const choice = event.choices[0]
            if (!choice) continue

            if (choice.finish_reason) {
                finishReason = choice.finish_reason
            }

            //@ts-ignore
            if (choice.reasoning_content) {
                //@ts-ignore
                assistantMessage.reasoning_content = choice.reasoning_content
            }

            if (choice.delta.content) {
                const delta = choice.delta.content
                responseContent += delta
                assistantMessage.content = responseContent

                if (onResponse) {
                    onResponse(delta, responseContent)
                }
            }

            if (choice.delta.tool_calls) {
                for (const toolCallDelta of choice.delta.tool_calls) {
                    const index = toolCallDelta.index

                    if (!toolCallsMap[index]) {
                        toolCallsMap[index] = {
                            id: toolCallDelta.id || '',
                            type: 'function',
                            function: {
                                name: toolCallDelta.function?.name || '',
                                arguments: toolCallDelta.function?.arguments || ''
                            }
                        }
                    } else {
                        if (toolCallDelta.function?.arguments && toolCallsMap[index].type === 'function') {
                            toolCallsMap[index].function.arguments += toolCallDelta.function.arguments
                        }
                    }
                }
            }
        }

        const toolCalls = Object.values(toolCallsMap)

        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls
        }
        currentSessionView.pushMessage(assistantMessage)

        if (finishReason === 'tool_calls' || toolCalls.length > 0) {

            //mimo-v2-flash  mimo-v2-pro callreason
            //@ts-ignore

            for (const toolCall of toolCalls) {
                if (toolCall.type === 'function') {
                    try {
                        const callName = toolCall.function.name
                        const callArguments = JSON.parse(toolCall.function.arguments)

                        this.emit('toolCall', callName, callArguments)

                        const callResult = await this.handleToolCall(callName, callArguments)

                        const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                            tool_call_id: toolCall.id,
                            timestamp: Date.now()
                        }
                        currentSessionView.pushMessage(toolCallMessage)
                    } catch (error) {

                        const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: JSON.stringify({
                                error: 'Failed to execute function arguments parse error'
                            }),
                            tool_call_id: toolCall.id,
                            timestamp: Date.now()
                        }
                        currentSessionView.pushMessage(toolCallErrorMessage)
                    }
                }
            }

            return await this._invokeStream(historySessionView, currentSessionView, onResponse, onSessionUpdate,toolFilter)
        }

    }

    public override async invokeIsolate(prompt: string, l1sysPrompt?: string, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,roundToolFilter?:BuildToolFilter): Promise<Marisa.Chat.Completion.CompletionSession> {
        const currentSessionView = this.createEmptySessionView()
        let systemPrompt = this.builsDefaultSystemPrompt(l1sysPrompt)

        const [_, systemPromptAddition] = this.modelContextManager ? await this.modelContextManager.query(prompt) : [[], '']
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

        await this._invoke(this.createEmptySessionView(), currentSessionView, onSessionUpdate,roundToolFilter)
        const session = currentSessionView.getSession()
        currentSessionView.destory()
        this.onSessionEnd('invoke', session)
        return session
    }

    public override async invokeStreamIsolate(prompt: string, l1sysPrompt?: string, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback, onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,roundToolFilter?:BuildToolFilter): Promise<Marisa.Chat.Completion.CompletionSession> {
        const currentSessionView = this.createEmptySessionView()
        let systemPrompt = this.builsDefaultSystemPrompt(l1sysPrompt)
        const [_, systemPromptAddition] = this.modelContextManager ? await this.modelContextManager.query(prompt) : [[], '']
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
        await this._invokeStream(this.createEmptySessionView(), currentSessionView, onResponse, onSessionUpdate,roundToolFilter)
        const session = currentSessionView.getSession()
        currentSessionView.destory()
        this.onSessionEnd('invokeStream', session)
        return session
    }

    private headSystemMessages(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
        const systemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
        const notSystemMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = []
        for (const message of messages) {
            if (message.role === 'system') {
                systemMessages.push(message)
            }
            else {
                notSystemMessages.push(message)
            }
        }
        return [...systemMessages, ...notSystemMessages]
    }

    private buildOpenAIMessages(historySessionView: ModelSessionView, currentSessionView: ModelSessionView) {
        let messages = [...historySessionView.unpackToOpenAIMessages().filter(i => i.role !== 'system'), ...currentSessionView.unpackToOpenAIMessages()]
        messages = this.headSystemMessages(messages)
        return messages
    }
}
