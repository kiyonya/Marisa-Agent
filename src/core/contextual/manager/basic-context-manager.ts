import { Marisa } from "@type/marisa";
import { ModelContextManager } from "./model-context-manager";

export interface BasicContextManagerOptions {
    hotSessionLength?: number
    keepHotSessionLength?: number
}

export default class BasicContextManager extends ModelContextManager {
    private options?: BasicContextManagerOptions
    private addContextFunction?: (session: Marisa.Chat.Completion.CompletionSession) => void
    
    constructor(options?: BasicContextManagerOptions, savedSessions?: Marisa.Chat.Completion.CompletionSession[]) {
        super(savedSessions)
        this.options = options
        
        this.installFunction = (installer) => {
            this.loadContext(installer.getWorkspace('contexts'))
            installer.registerModelContextPutFunction(this.put.bind(this))
            installer.registerModelContextQueryFunction(this.query.bind(this))
            this.addContextFunction = this.createAddContextFunction(installer.getWorkspace('contexts'))
        }
    }

    public async put(
        session: Marisa.Chat.Completion.CompletionSession, 
        _withHistory?: Marisa.Chat.Completion.CompletionSession[], 
        sessionPutCallback?: () => void
    ): Promise<void> {
        this.addContextFunction?.(session)
        
        if (sessionPutCallback) {
            sessionPutCallback()
        }
    }

    public async query(userPrompt: string): Promise<[Marisa.Chat.Completion.CompletionSession[], string]> {
        const userMessage: Marisa.Chat.Completion.Messages.ChatCompletionUserMessage = {
            content: userPrompt,
            role: 'user',
            timestamp: Date.now()
        }
        
        const newSession = this.createEmptySession()
        newSession.messages.push(userMessage)
        
        const hotSessionLength = this.options?.hotSessionLength ?? 5
        const keepHotSessionLength = this.options?.keepHotSessionLength ?? 3
        const historySessions = this.filterSessions(hotSessionLength, keepHotSessionLength)
        return [[...historySessions, newSession], '']
    }
}