import OpenAI from "openai";
import BaseModel from "./base_model";
import { Marisa } from "../../types/marisa";

export interface ModelBasicOptions {
    modelName?: string,
    baseURL?: string,
    apiKey?: string,
    maxRetries?: number
}

export interface LLMCreateOptions extends ModelBasicOptions {
    llmContexts?: Marisa.Chat.Completion.CompletionContext,
    llmToolMap?: Map<string, Marisa.Tool.AnyTool>,
}

export interface OpenAILLMCreateOptions extends LLMCreateOptions {
    openAIClient?: OpenAI,
}

export default class OpenAIModel extends BaseModel implements Marisa.Implements.IModel {

    private openAIClient: OpenAI

    constructor(modelOptions: Marisa.Model.OpenAIModelOptions, modelCompletionOptions: Marisa.Model.ModelCompletionOptions) {
        super(modelOptions, modelCompletionOptions)
        this.openAIClient = modelOptions.client
    }

    public async invoke(
        userPrompt: string,
        onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
        mode: Marisa.Chat.Completion.CompletionMode = 'context'): Promise<Marisa.Chat.Completion.CompletionSession> {

        const session = this._createEmptySession()
        session.messages.push({
            role: 'user',
            content: userPrompt,
        })

        if (mode === 'context') {
            this.modelContexts.latestActive = Date.now()
            this.modelContexts.sessions.push(session)
        }

        onSessionUpdate && onSessionUpdate(session)

        const completion = await this._invoke(session, onSessionUpdate, mode)
        if (completion.usage) {
            session.usage = completion.usage
        }
        if (onSessionUpdate) {
            onSessionUpdate(session)
        }

        this._dumpContexts()

        return session
    }

    private async _invoke(session: Marisa.Chat.Completion.CompletionSession,
        onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
        mode: Marisa.Chat.Completion.CompletionMode = 'context'): Promise<OpenAI.Chat.Completions.ChatCompletion> {

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
        switch (mode) {
            case "context":
                messages.push(...this._buildOpenAIMessageWithContext())
                break
            case "sessionOnly":
                messages.push(...this._buildOpenAIMessageWithSession(session))
                break
            case "sessionIsolation":
                messages.push(...this._buildOpenAIMessageWithContext(), ...this._buildOpenAIMessageWithSession(session))
                break
            default:
                messages.push(...this._buildOpenAIMessageWithContext())
        }
        if (!this.modelCompletionOptions.modelName) {
            throw new Error('No Model To Call')
        }

        const openaiChatCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams =
        {
            model: this.modelCompletionOptions.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: messages,
            stream: false,
            tools: this.modelBuiltTools,
            prompt_cache_retention: this.modelCompletionOptions.promptCacheRetention,
            tool_choice: this.modelCompletionOptions.toolChoice,
            parallel_tool_calls: this.modelCompletionOptions.parallelToolCalls,
        }

        const completion = await this.openAIClient.chat.completions.create(openaiChatCreateOptions)
        const choice = completion.choices[0];
        if (choice && choice.message) {
            const assistantMsg: Marisa.Chat.Completion.CompletionMessage = {
                role: 'assistant',
                content: choice.message.content || '',
                tool_calls: choice.message.tool_calls,
            };

            session.messages.push(assistantMsg)


            if (onSessionUpdate) {
                onSessionUpdate(session)
            }

            if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
                for (const toolCall of choice.message.tool_calls) {
                    if (toolCall.type === 'function') {
                        try {
                            const callName = toolCall.function.name
                            const callArguments = JSON.parse(toolCall.function.arguments)

                            this.emit('toolCall', callName, callArguments)

                            const callResult = await this._callTool(callName, callArguments)

                            const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                                tool_call_id: toolCall.id,
                            }

                            session.messages.push(toolCallMessage)

                            if (onSessionUpdate) {
                                onSessionUpdate(session)
                            }

                        } catch (error) {

                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolCall.id,
                            }

                            session.messages.push(toolCallErrorMessage)

                            if (onSessionUpdate) {
                                onSessionUpdate(session)
                            }
                        }
                    }
                }
                return await this._invoke(session, onSessionUpdate, mode);
            }
        }
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

    public async invokeStream(
        userPrompt: string,
        onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback,
        onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
        mode: Marisa.Chat.Completion.CompletionMode = 'context'):
        Promise<Marisa.Chat.Completion.CompletionSession> {

        const session: Marisa.Chat.Completion.CompletionSession = {
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            },
            messages: [],
            sessionId: Date.now()
        }

        if (mode === 'context') {
            this.modelContexts.latestActive = Date.now()
            this.modelContexts.sessions.push(session)
        }

        session.messages.push({
            role: 'user',
            content: userPrompt,
        })

        if (onSessionUpdate) {
            onSessionUpdate(session)
        }

        const completion = await this._invokeStream(session, onResponse, onSessionUpdate, mode)

        if (completion.usage) {
            session.usage = completion.usage
        }
        if (onSessionUpdate) {
            onSessionUpdate(session)
        }

        this._dumpContexts()
        return session
    }

    private async _invokeStream(
        session: Marisa.Chat.Completion.CompletionSession,
        onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback,
        onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
        mode: Marisa.Chat.Completion.CompletionMode = 'context'
    ): Promise<OpenAI.Chat.ChatCompletion> {

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

        switch (mode) {
            case "context":
                messages.push(...this._buildOpenAIMessageWithContext())
                break
            case "sessionOnly":
                messages.push(...this._buildOpenAIMessageWithSession(session))
                break
            case "sessionIsolation":
                messages.push(...this._buildOpenAIMessageWithContext(), ...this._buildOpenAIMessageWithSession(session))
                break
            default:
                messages.push(...this._buildOpenAIMessageWithContext())
        }
        if (!this.modelCompletionOptions.modelName) {
            throw new Error('No Model To Call')
        }
        const openaiChatStreamCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
        {
            model: this.modelCompletionOptions.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: messages,
            stream: true,
            tools: this.modelBuiltTools,
            prompt_cache_retention: this.modelCompletionOptions.promptCacheRetention,
            tool_choice: this.modelCompletionOptions.toolChoice,
            parallel_tool_calls: this.modelCompletionOptions.parallelToolCalls,
        }

        this.emit('chatCreate', openaiChatStreamCreateOptions)

        const chatStream = await this.openAIClient.chat.completions.create(
            openaiChatStreamCreateOptions
        )

        let responseContent = ''
        let usage: OpenAI.CompletionUsage = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0
        }

        const toolCallsMap: Record<number, OpenAI.Chat.Completions.ChatCompletionMessageToolCall> = {}
        let finishReason: OpenAI.Chat.Completions.ChatCompletionChunk['choices'][0]['finish_reason'] =
            null

        const assistantMessage: Marisa.Chat.Completion.CompletionMessage = {
            role: 'assistant',
            content: responseContent,
        }

        for await (const event of chatStream) {
            if (event.usage) {
                usage = {
                    prompt_tokens: event.usage.prompt_tokens || 0,
                    completion_tokens: event.usage.completion_tokens || 0,
                    total_tokens: event.usage.total_tokens || 0
                }
            }

            const choice = event.choices[0]
            if (!choice) continue

            if (choice.finish_reason) {
                finishReason = choice.finish_reason
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

        session.messages.push(assistantMessage)

        if (onSessionUpdate) {
            onSessionUpdate(session)
        }

        const toolCalls = Object.values(toolCallsMap)

        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls
        }

        if (finishReason === 'tool_calls' || toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
                if (toolCall.type === 'function') {
                    try {
                        const callName = toolCall.function.name
                        const callArguments = JSON.parse(toolCall.function.arguments)

                        this.emit('toolCall', callName, callArguments)

                        const callResult = await this._callTool(callName, callArguments)

                        const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                            tool_call_id: toolCall.id
                        }

                        session.messages.push(toolCallMessage)

                        if (onSessionUpdate) {
                            onSessionUpdate(session)
                        }

                    } catch (error) {

                        const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: JSON.stringify({
                                error: 'Failed to execute function arguments parse error'
                            }),
                            tool_call_id: toolCall.id
                        }

                        session.messages.push(toolCallErrorMessage)

                        if (onSessionUpdate) {
                            onSessionUpdate(session)
                        }
                    }
                }
            }

            return await this._invokeStream(session, onResponse, onSessionUpdate)
        }

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
                        content: responseContent,
                        refusal: null,
                        tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    },
                    finish_reason: finishReason || 'stop',
                    logprobs: null
                }
            ],
            usage: usage
        }
        return chatCompletion
    }

    private _buildOpenAIMessageWithContext(): OpenAI.Chat.ChatCompletionMessageParam[] {
        const openaiMessage: OpenAI.Chat.ChatCompletionMessageParam[] = []

        openaiMessage.push({
            role: 'system',
            content: this._buildSystemMessage()
        })

        const selectedSessions = this._filterSessions()
        openaiMessage.push(...this._transformSessionsToOpenAIMessages(selectedSessions))
        return openaiMessage
    }

    private _buildOpenAIMessageWithSession(session: Marisa.Chat.Completion.CompletionSession): OpenAI.Chat.ChatCompletionMessageParam[] {
        const openaiMessage: OpenAI.Chat.ChatCompletionMessageParam[] = []
        openaiMessage.push({
            role: 'system',
            content: this._buildSystemMessage()
        })
        for (const message of session.messages) {
            switch (message.role) {
                case 'developer':
                    openaiMessage.push({
                        role: 'developer',
                        content: message.content,
                        name: message.name
                    })
                    break
                case 'user':
                    openaiMessage.push({
                        role: 'user',
                        content: message.content,
                        name: message.name
                    })
                    break
                case 'assistant':
                    const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                        role: 'assistant',
                        content: message.content,
                        name: message.name
                    }
                    if (message.tool_calls) {
                        assistantMsg.tool_calls = message.tool_calls
                    }
                    openaiMessage.push(assistantMsg)
                    break
                case 'tool':
                    openaiMessage.push({
                        role: 'tool',
                        content: message.content,
                        tool_call_id: message.tool_call_id
                    })
                    break
                default:
                    console.warn('Unrecognized message role encountered')
            }
        }
        return openaiMessage
    }

    private _transformSessionsToOpenAIMessages(sessions: Marisa.Chat.Completion.CompletionSession[]) {
        const openaiMessage: OpenAI.Chat.ChatCompletionMessageParam[] = []
        for (const session of sessions) {
            for (const message of session.messages) {
                switch (message.role) {
                    case 'developer':
                        openaiMessage.push({
                            role: 'developer',
                            content: message.content,
                            name: message.name
                        })
                        break
                    case 'user':
                        openaiMessage.push({
                            role: 'user',
                            content: message.content,
                            name: message.name
                        })
                        break
                    case 'assistant':
                        const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
                            role: 'assistant',
                            content: message.content,
                            name: message.name
                        }
                        if (message.tool_calls) {
                            assistantMsg.tool_calls = message.tool_calls
                        }
                        openaiMessage.push(assistantMsg)
                        break
                    case 'tool':
                        openaiMessage.push({
                            role: 'tool',
                            content: message.content,
                            tool_call_id: message.tool_call_id
                        })
                        break
                    default:
                        console.warn('Unrecognized message role encountered')
                }
            }
        }
        return openaiMessage
    }
}