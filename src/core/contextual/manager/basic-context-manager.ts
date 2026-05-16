import { Marisa } from "@type/marisa";
import { ModelContextManager } from "./model-context-manager";

export interface BasicContextManagerOptions {
    hotSessionLength?: number
    keepHotSessionLength?: number
}

export default class BasicContextManager extends ModelContextManager {
    private options?: BasicContextManagerOptions
    constructor(options?: BasicContextManagerOptions) {
        super()
        this.options = options
        this.installFunction = (installer) => {
            installer.registerModelContextPutFunction(this.put.bind(this))
            installer.registerModelContextQueryFunction(this.query.bind(this))
        }
    }

    public async put(session: Marisa.Chat.Completion.CompletionSession, withHistory?: Marisa.Chat.Completion.CompletionSession[], sessionPutCallback?: () => void): Promise<any> {

        this.addSession(session)
        await this.saveContext(session)
        if (sessionPutCallback) {
            sessionPutCallback()
        }
    }

    public async query(userPrompt: string): Promise<[sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string]> {
        const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
            content: userPrompt,
            role: 'user',
            timestamp: Date.now()
        }
        const newSession = this.createEmptySession()
        newSession.messages.push(userMessage)
        const hotSessionLength = this.options?.hotSessionLength ?? 5
        const keepHotSessionLength = this.options?.keepHotSessionLength ?? 3
        const beforeSessions = this.filterSessions(hotSessionLength, keepHotSessionLength)
        return [this.noSystemInject(beforeSessions), '']
    }
}