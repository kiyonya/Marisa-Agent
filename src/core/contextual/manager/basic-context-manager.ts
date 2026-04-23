import { Marisa } from "../../../types/marisa";
import { ModelContextManager } from "./model-context-manager";

export default class BasicContextManager extends ModelContextManager {

    public override async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {

        this.addSession(session)
        await this.saveContext(session)
        if (sessionPutCallback) {
            sessionPutCallback()
        }
    }

    public override async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {
        const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
            content: userPrompt,
            role: 'user',
            timestamp: Date.now()
        }
        const newSession = this.createEmptySession()
        newSession.messages.push(userMessage)
        const beforeSessions = this.filterSessions(5, 3)
        return [this.noSystemInject(beforeSessions), '']
    }
}