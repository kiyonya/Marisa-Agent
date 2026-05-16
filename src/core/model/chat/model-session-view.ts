import OpenAI from "openai";
import { Marisa } from "../../../types/marisa";
import Anthropic from "@anthropic-ai/sdk";

export default class ModelSessionView {

    private currentSession: Marisa.Chat.Completion.CompletionSession
    private historySessions: Marisa.Chat.Completion.CompletionSession[] = []
    private systemPrompt?: string
    private onSessionUpdateCallback?: Marisa.Chat.Completion.OnSessionUpdateCallback

    public get EmptySession():Marisa.Chat.Completion.CompletionSession{
        return {
            messages:[],
            usage:{
                total_tokens:0,
                completion_tokens:0,
                cache_tokens:0,
                prompt_tokens:0
            },
            timestamp:Date.now(),
            sessionId:Date.now()
        }
    }

    get historySession(){
        return this.historySessions
    }

    get session(){
        return this.currentSession
    }

    get sessionNoTemporary(){
        const msg = [...this.currentSession.messages.filter(i => i.temporary !== true)]
        const session: Marisa.Chat.Completion.CompletionSession = {
            ...this.currentSession,
            messages: msg
        }
        return session
    }

    constructor(session?: Marisa.Chat.Completion.CompletionSession) {
        this.currentSession = session || this.EmptySession
    }

    public setHistorySessions(sessions: Marisa.Chat.Completion.CompletionSession[]) {
        this.historySessions.push(...sessions)
    }

    public setSystemPrompt(systemPrompt: string) {
        if (this.systemPrompt) {
            throw new Error("Already have system messages")
        }
        this.systemPrompt = systemPrompt
    }

    public pushMessageToCurrentSession(...messages: Marisa.Chat.Completion.CompletionMessage[]) {
        this.currentSession.messages.push(...messages)
        if (this.onSessionUpdateCallback) {
            this.onSessionUpdateCallback(this.currentSession)
        }
    }

    public sessionUpdateIndicator(onSessionUpdateCallback: Marisa.Chat.Completion.OnSessionUpdateCallback) {
        this.onSessionUpdateCallback = onSessionUpdateCallback
    }

    public setUsage(usage: Marisa.Chat.Completion.CompletionUsage) {
        this.currentSession.usage = usage
    }

    public getSession() {
        return this.currentSession
    }

    /**
     * get session without temporary,when model has interceptor,those interceptors might insert some new message into current session,and it will be marked temporary,like 
     * `<system-remider></system-reminder>`
     * these messages should never be add into context or any memory system
     * @returns 
     */
    public getNoTemporarySession() {
        const msg = [...this.currentSession.messages.filter(i => i.temporary !== true)]
        const session: Marisa.Chat.Completion.CompletionSession = {
            ...this.currentSession,
            messages: msg
        }
        return session
    }

    public getHistorySessions(){
        return [...this.historySessions]
    }

    public destory() {
        this.currentSession.messages = []
        this.onSessionUpdateCallback = undefined
    }

    public unpackToOpenAIMessages(): OpenAI.Chat.ChatCompletionMessageParam[] {
        
        const historyMessages = this.historySessions.map(i=>i.messages).flat()
        const historyPart:OpenAI.Chat.ChatCompletionMessageParam[] = []
        historyPart.push(...this.marisaMessagesToOpenAIMessages(historyMessages))

        const currentPart:OpenAI.Chat.ChatCompletionMessageParam[] = []
        currentPart.push(...this.marisaMessagesToOpenAIMessages(this.currentSession.messages))

        const systemPart:OpenAI.Chat.ChatCompletionSystemMessageParam = {
            role:"system",
            content:this.systemPrompt || ""
        }
        const combinedOpenAIMessageList:OpenAI.Chat.ChatCompletionMessageParam[] = [systemPart,...historyPart,...currentPart]

        return combinedOpenAIMessageList
    }

    private marisaMessagesToOpenAIMessages(messages: Marisa.Chat.Completion.CompletionMessage[]) {
        const openaiMessage: OpenAI.Chat.ChatCompletionMessageParam[] = []
        for (const message of messages) {
            switch (message.role) {
                case 'system':
                    openaiMessage.push({
                        role: 'system',
                        content: message.content
                    })
                    break
                case 'developer':
                    openaiMessage.push({
                        role: 'developer',
                        content: message.content,
                        name: message.name,

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
                        name: message.name,
                        //@ts-ignore
                        reasoning_content: message.reasoning_content
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

    public unpackToAnthropicMessages(): { system: string, messages: Anthropic.Messages.MessageParam[] } {
        const { system, anthropicMessages } = this.marisaMessagesToAnthropicMessages(this.currentSession.messages.sort((a, b) => a.timestamp - b.timestamp))
        return { system, messages: anthropicMessages }
    }

    private marisaMessagesToAnthropicMessages(messages: Marisa.Chat.Completion.CompletionMessage[]) {
        const systemMessages: string[] = []
        const anthropicMessages: Anthropic.Messages.MessageParam[] = []
        for (const message of messages) {
            const role = message.role
            switch (role) {
                case "system":
                    const content: string = message.content
                    systemMessages.push(content)
                    break
                case "assistant":
                    if (message.content) {
                        const assistantMessage: Anthropic.Messages.MessageParam = {
                            role: "assistant",
                            content: message.content
                        }
                        anthropicMessages.push(assistantMessage)
                    }
                    if (message.tool_calls && message.tool_calls.length) {
                        const toolUseMessages: Anthropic.Messages.ToolUseBlockParam[] = []
                        for (const toolCall of message.tool_calls) {
                            if (toolCall.type === 'custom') {
                                const toolUseMessage: Anthropic.Messages.ToolUseBlockParam = {
                                    type: 'tool_use',
                                    id: toolCall.id,
                                    name: toolCall.custom.name,
                                    input: toolCall.custom.input
                                }
                                toolUseMessages.push(toolUseMessage)
                            }
                            else if (toolCall.type === 'function') {
                                const toolUseMessage: Anthropic.Messages.ToolUseBlockParam = {
                                    type: 'tool_use',
                                    id: toolCall.id,
                                    name: toolCall.function.name,
                                    input: toolCall.function.arguments
                                }
                                toolUseMessages.push(toolUseMessage)
                            }
                        }
                        if (toolUseMessages.length) {
                            const assistantExtendsToolUseArrayMessage: Anthropic.Messages.MessageParam = {
                                role: 'assistant',
                                content: toolUseMessages
                            }
                            anthropicMessages.push(assistantExtendsToolUseArrayMessage)
                        }
                    }
                    break
                case "developer":
                    if (message.content) {
                        const developerAssistantMessage: Anthropic.Messages.MessageParam = {
                            role: "assistant",
                            content: message.content
                        }
                        anthropicMessages.push(developerAssistantMessage)
                    }
                    break
                case "tool":
                    const toolResultMessage: Anthropic.Messages.ToolResultBlockParam = {
                        tool_use_id: message.tool_call_id,
                        type: 'tool_result',
                        content: message.content,
                        is_error: message.is_error || false
                    }
                    anthropicMessages.push({
                        role: 'assistant',
                        content: [toolResultMessage]
                    })
                    break
                case "user":
                    const userMessage: Anthropic.Messages.MessageParam = {
                        role: 'user',
                        content: message.content
                    }
                    anthropicMessages.push(userMessage)
                    break
            }
        }
        return { system: systemMessages.join('\n\n'), anthropicMessages }
    }
}