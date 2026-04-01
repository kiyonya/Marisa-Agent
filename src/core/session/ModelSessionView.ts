import OpenAI from "openai";
import { Marisa } from "../../types/marisa";

export default class ModelSessionView {
    private session: Marisa.Chat.Completion.CompletionSession
    private onSessionUpdateCallback?: Marisa.Chat.Completion.OnSessionUpdateCallback
    constructor(session: Marisa.Chat.Completion.CompletionSession) {
        this.session = session
    }

    public sessionUpdateIndicator(onSessionUpdateCallback: Marisa.Chat.Completion.OnSessionUpdateCallback) {
        this.onSessionUpdateCallback = onSessionUpdateCallback
    }

    public pushMessage(...messages: Marisa.Chat.Completion.CompletionMessage[]) {
        this.session.messages.push(...messages)
        if(this.onSessionUpdateCallback){
            this.onSessionUpdateCallback(this.session)
        }
    }

    public updateUsage(usage:Marisa.Chat.Completion.CompletionUsage){
        this.session.usage = usage
    }

    public getSession() {
        return this.session
    }

    public destory(){
        this.session.messages = []
        this.onSessionUpdateCallback = undefined
    }


    public unpackToOpenAIMessages(): OpenAI.Chat.ChatCompletionMessageParam[] {
        return this.marisaMessagesToOpenAIMessages(this.session.messages.sort((a, b) => a.timestamp - b.timestamp))
    }

    private marisaMessagesToOpenAIMessages(messages: Marisa.Chat.Completion.CompletionMessage[]) {
        const openaiMessage: OpenAI.Chat.ChatCompletionMessageParam[] = []
        for (const message of messages) {
            switch (message.role) {
                case 'system':
                    openaiMessage.push({
                        role:'system',
                        content:message.content
                    })
                    break
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
}