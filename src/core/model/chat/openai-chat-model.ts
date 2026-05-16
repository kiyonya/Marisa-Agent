import OpenAI from "openai";
import { Marisa } from "../../../types/marisa";
import ChatModel, { RoundToolGetter } from "./chat-model";
import ModelSessionView from "./model-session-view";
import path from "path";

type BuildToolFilter = (tool: Marisa.Tool.AnyTool) => boolean

export default class OpenAIChatModel extends ChatModel {

    private client: OpenAI
    constructor(workspace: string, OpenAIModelName: Marisa.Provider.OpenAI.OpenAIChatModel, client?: OpenAI) {
        super(OpenAIModelName, path.resolve(workspace))
        this.client = client || new OpenAI()
    }

    protected override async completeHandler(
        sessionView: ModelSessionView,
        toolMap?: Map<string, Marisa.Tool.AnyTool>):
        Promise<void> {

        const roundTools = (toolMap && toolMap.size) ? this.buildIsolationTool(toolMap).map(i => i.buildAsOpenAI()) : []
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

            //@ts-ignore
            if (choice.reasoning_content) {
                //@ts-ignore
                assistantMsg.reasoning_content = choice.reasoning_content
            }

            sessionView.pushMessageToCurrentSession(assistantMsg)
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
                            sessionView.pushMessageToCurrentSession(toolCallMessage)
                        } catch (error) {
                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolCall.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessageToCurrentSession(toolCallErrorMessage)
                        }
                    }
                }
                return await this.completeHandler(sessionView, toolMap);
            }
        }
        if (completion.usage) { sessionView.setUsage(completion.usage) }
    }

    protected override async invokeHandler(
        sessionView: ModelSessionView,
        toolGatter: RoundToolGetter
    ): Promise<void> {

        const roundTools = (await toolGatter()).map(i => i.buildAsOpenAI())

        const openaiChatCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams =
        {
            model: this.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: sessionView.unpackToOpenAIMessages(),
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

            sessionView.pushMessageToCurrentSession(assistantMsg)

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

                            sessionView.pushMessageToCurrentSession(toolCallMessage)

                        } catch (error) {

                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolCall.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessageToCurrentSession(toolCallErrorMessage)
                        }
                    }
                }
                return await this.invokeHandler(sessionView, toolGatter);
            }
        }

        const usage: Marisa.Chat.Completion.CompletionUsage = {
            prompt_tokens: completion?.usage?.prompt_tokens || 0,
            completion_tokens: completion?.usage?.completion_tokens || 0,
            total_tokens: completion?.usage?.total_tokens || 0,
            completion_tokens_details: completion.usage?.completion_tokens_details,
            prompt_tokens_details: completion.usage?.prompt_tokens_details
        }
        sessionView.setUsage(usage)
    }

    protected override async invokeStreamHandler(
        sessionView: ModelSessionView,
        toolGatter: RoundToolGetter,
        onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback
    ): Promise<void> {

        const roundTools = (await toolGatter()).map(i => i.buildAsOpenAI())
        const openaiChatStreamCreateOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
        {
            model: this.modelName,
            max_completion_tokens: this.modelCompletionOptions.maxCompletionTokens,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: sessionView.unpackToOpenAIMessages(),
            stream: true,
            tools: roundTools,
            prompt_cache_retention: this.modelCompletionOptions.promptCacheRetention,
            tool_choice: this.modelCompletionOptions.toolChoice,
            parallel_tool_calls: this.modelCompletionOptions.parallelToolCalls,
            //@ts-ignore
            extra_body: { "thinking": { "type": "disabled" } },
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
            reasoning_content: "",
            timestamp: Date.now()
        }

        for await (const event of chatStream) {
            if (event.usage) {
                const usage: Marisa.Chat.Completion.CompletionUsage = {
                    prompt_tokens: event?.usage?.prompt_tokens || 0,
                    completion_tokens: event?.usage?.completion_tokens || 0,
                    total_tokens: event?.usage?.total_tokens || 0,
                    completion_tokens_details: event.usage?.completion_tokens_details,
                    prompt_tokens_details: event.usage?.prompt_tokens_details
                }
                sessionView.setUsage(usage)
            }

            const choice = event.choices[0]
            if (!choice) continue

            if (choice.finish_reason) {
                finishReason = choice.finish_reason
            }

            //for most model agent
            //the reasoning content is streaming 

            //@ts-ignore
            if (choice.delta.reasoning_content) {
                //@ts-ignore
                assistantMessage.reasoning_content += choice.delta.reasoning_content
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
        sessionView.pushMessageToCurrentSession(assistantMessage)

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
                        sessionView.pushMessageToCurrentSession(toolCallMessage)
                    } catch (error) {

                        const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                            role: 'tool',
                            content: JSON.stringify({
                                error: 'Failed to execute function arguments parse error'
                            }),
                            tool_call_id: toolCall.id,
                            timestamp: Date.now()
                        }
                        sessionView.pushMessageToCurrentSession(toolCallErrorMessage)
                    }
                }
            }

            return await this.invokeStreamHandler(sessionView, toolGatter, onResponse)
        }

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
}
