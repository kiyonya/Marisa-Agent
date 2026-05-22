import { Marisa } from "@type/marisa";
import ModelSessionView from "./model-session-view";
import ChatModel, { RoundToolGetter } from "./chat-model";
import Anthropic from '@anthropic-ai/sdk'
import * as Convert from './anthropic-convert'

// throw new Error("Anthroupic Now Not Support,Plz Wait Next Version")

interface ChatCompletionAssistantMessageWithStopStatus extends Marisa.Chat.Completion.Messages.ChatCompletionAssistantMessage {
    isStop: boolean
}

export default class AnthropicChatModel extends ChatModel {

    private client: Anthropic
    constructor(modelName: string, workspace: string, client?: Anthropic) {
        super(modelName, workspace)
        this.client = client || new Anthropic()
    }

    protected override async completeHandler(sessionView: ModelSessionView, toolMap?: Map<string, Marisa.Tool.AnyTool>): Promise<void> {

        const roundTools = (toolMap && toolMap.size) ? this.buildIsolationTool(toolMap).map(i => i.buildAsAnthropic()) : []
        const { system, messages } = sessionView.unpackToAnthropicMessages()

        const anthropicMessageCreateParams: Anthropic.Messages.MessageCreateParams = {
            model: this.modelName,
            max_tokens: this.modelCompletionOptions.maxCompletionTokens ?? 4096,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: messages,
            system: system,
            tools: roundTools,
            tool_choice: Convert.convertToolChoice(this.modelCompletionOptions.toolChoice, this.modelCompletionOptions.parallelToolCalls),
            stream: false
        };

        const result = await this.client.messages.create(anthropicMessageCreateParams)

        if (result.content?.length) {

            const assistantMessages: Marisa.Chat.Completion.CompletionMessage[] = []
            const toolUses: Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall[] = []

            for (const content of result.content) {

                const message: Marisa.Chat.Completion.CompletionMessage = {
                    role: 'assistant',
                    timestamp: Date.now(),
                    tool_calls: []
                };

                switch (content.type) {
                    case "text":
                        message.content = content.text
                        break
                    case "thinking":
                        message.thinking = content.thinking
                        message.reasoning_content = content.thinking
                        break
                    case "redacted_thinking":
                        message.thinking = content.data
                        break
                    case "tool_use":
                        const mtooluse = Convert.convertToolUse(content)
                        toolUses.push(mtooluse)
                        if (!message.tool_calls) {
                            message.tool_calls = []
                        }
                        message.tool_calls.push(mtooluse)
                        break
                    case "server_tool_use":
                        const mserverToolUse = Convert.convertServerToolUse(content)
                        toolUses.push(mserverToolUse)
                        if (!message.tool_calls) {
                            message.tool_calls = []
                        }
                        message.tool_calls.push(mserverToolUse)
                        break
                    case "web_search_tool_result":
                    case "web_fetch_tool_result":
                    case "code_execution_tool_result":
                    case "bash_code_execution_tool_result":
                    case "text_editor_code_execution_tool_result":
                    case "tool_search_tool_result":
                    case "container_upload":
                        break
                }

                assistantMessages.push(message)
            }

            if (toolUses.length) {
                for (const toolUse of toolUses) {
                    if (toolUse.type === 'function' && toolMap) {
                        try {
                            const callName = toolUse.function.name
                            const callArguments = JSON.parse(toolUse.function.arguments)

                            this.emit('toolCall', callName, callArguments)

                            const callResult = await this.handleIsolateToolCall(toolMap, callName, callArguments)

                            const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                                tool_call_id: toolUse.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessageToCurrentSession(toolCallMessage)
                        } catch (error) {
                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolUse.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessageToCurrentSession(toolCallErrorMessage)
                        }
                    }
                }
            }
        }

        if (result.usage) {
            const musage = Convert.convertUsage(result.usage)
            sessionView.setUsage(musage)
        }
    }

    protected override async invokeHandler(sessionView: ModelSessionView, toolGatter: RoundToolGetter): Promise<void> {
        const roundTools = (await toolGatter() || []).map(tool => tool.buildAsAnthropic())
        const { system, messages } = sessionView.unpackToAnthropicMessages()

        const anthropicMessageCreateParams: Anthropic.Messages.MessageCreateParams = {
            model: this.modelName,
            max_tokens: this.modelCompletionOptions.maxCompletionTokens ?? 4096,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: messages,
            system: system,
            tools: roundTools,
            tool_choice: Convert.convertToolChoice(this.modelCompletionOptions.toolChoice, this.modelCompletionOptions.parallelToolCalls),
            stream: false
        };

        const result = await this.client.messages.create(anthropicMessageCreateParams)

        if (result.content?.length) {

            const assistantMessages: Marisa.Chat.Completion.CompletionMessage[] = []
            const toolUses: Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall[] = []

            for (const content of result.content) {

                const message: Marisa.Chat.Completion.CompletionMessage = {
                    role: 'assistant',
                    timestamp: Date.now(),
                    tool_calls: []
                };

                switch (content.type) {
                    case "text":
                        message.content = content.text
                        break
                    case "thinking":
                        message.thinking = content.thinking
                        message.reasoning_content = content.thinking
                        break
                    case "redacted_thinking":
                        message.thinking = content.data
                        break
                    case "tool_use":
                        const mtooluse = Convert.convertToolUse(content)
                        toolUses.push(mtooluse)
                        if (!message.tool_calls) {
                            message.tool_calls = []
                        }
                        message.tool_calls.push(mtooluse)
                        break
                    case "server_tool_use":
                        const mserverToolUse = Convert.convertServerToolUse(content)
                        toolUses.push(mserverToolUse)
                        if (!message.tool_calls) {
                            message.tool_calls = []
                        }
                        message.tool_calls.push(mserverToolUse)
                        break
                    case "web_search_tool_result":
                    case "web_fetch_tool_result":
                    case "code_execution_tool_result":
                    case "bash_code_execution_tool_result":
                    case "text_editor_code_execution_tool_result":
                    case "tool_search_tool_result":
                    case "container_upload":
                        break
                }

                assistantMessages.push(message)
            }

            if (toolUses.length) {
                for (const toolUse of toolUses) {
                    if (toolUse.type === 'function') {
                        try {
                            const callName = toolUse.function.name
                            const callArguments = JSON.parse(toolUse.function.arguments)

                            this.emit('toolCall', callName, callArguments)

                            const callResult = await this.handleToolCall(callName, callArguments)

                            const toolCallMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: typeof callResult === 'string' ? callResult : JSON.stringify(callResult),
                                tool_call_id: toolUse.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessageToCurrentSession(toolCallMessage)
                        } catch (error) {
                            const toolCallErrorMessage: Marisa.Chat.Completion.CompletionMessage = {
                                role: 'tool',
                                content: JSON.stringify({
                                    error: 'Failed to execute function arguments parse error'
                                }),
                                tool_call_id: toolUse.id,
                                timestamp: Date.now()
                            }
                            sessionView.pushMessageToCurrentSession(toolCallErrorMessage)
                        }
                    }
                }
            }
        }

        if (result.usage) {
            const musage = Convert.convertUsage(result.usage)
            sessionView.setUsage(musage)
        }
    }

    protected override async invokeStreamHandler(sessionView: ModelSessionView, toolGatter: RoundToolGetter, onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback): Promise<void> {
        const roundTools = (await toolGatter() || []).map(tool => tool.buildAsAnthropic())
        const { system, messages } = sessionView.unpackToAnthropicMessages()

        const anthropicMessageCreateParams: Anthropic.Messages.MessageCreateParams = {
            model: this.modelName,
            max_tokens: this.modelCompletionOptions.maxCompletionTokens ?? 4096,
            temperature: this.modelCompletionOptions.temperature,
            top_p: this.modelCompletionOptions.topP,
            messages: messages,
            system: system,
            tools: roundTools,
            tool_choice: Convert.convertToolChoice(this.modelCompletionOptions.toolChoice, this.modelCompletionOptions.parallelToolCalls),
            stream: true
        };

        const result = await this.client.messages.create(anthropicMessageCreateParams)
        const toolCallsMap: Record<number, Marisa.Chat.Completion.Messages.ChatCompletionToolCallMessage> = {}


        const messageMap = new Map<number, ChatCompletionAssistantMessageWithStopStatus>()

        for await (const event of result) {
            if (event.type === 'content_block_start') {
                const message: ChatCompletionAssistantMessageWithStopStatus = {
                    role: 'assistant',
                    timestamp: Date.now(),
                    tool_calls: [],
                    isStop: false
                };
                const index = event.index
                messageMap.set(index, message)
            }
            else if (event.type === 'content_block_stop') {
                const index = event.index
                const message = messageMap.get(index)
                if (message) {
                    message.isStop = true
                    messageMap.set(index, message)
                }
            }
            else if (event.type === 'content_block_delta') {
                const index = event.index
                const message = messageMap.get(index)
                if (message) {
                    const delta = event.delta
                    switch (delta.type) {
                        case "text_delta":
                            message.content += delta.text
                            break
                        case "input_json_delta":
                            break
                        case "citations_delta":
                            break
                        case "thinking_delta":
                            message.thinking += delta.thinking
                            message.reasoning_content += delta.thinking
                            break
                        case "signature_delta":
                    }
                }
            }
            else if (event.type === 'message_delta') {
                if (event.delta.stop_reason === 'tool_use') {
                    event.delta.stop_sequence
                }

            }

        }

    }
}