import EventEmitter from "events";
import { Marisa } from "../../types/marisa";
import fse from 'fs-extra'
import path from "path";
import LocalTool from "../tool/local_tool";

export default abstract class BaseModel extends EventEmitter<Marisa.Events.Model> {

    protected id: string = ''
    protected modelContexts: Marisa.Chat.Completion.CompletionContext
    protected modelToolMap: Map<string, Marisa.Tool.AnyTool> = new Map()
    protected modelBuiltTools: Marisa.Chat.Completion.CompletionTool[] = []
    protected modelCompletionOptions: Marisa.Model.ModelCompletionOptions
    protected modelContextDumpFile?: string
    protected modelRolePrompt: string = '你是一个智能助手,请用友好、专业的语气与用户交流，提供有价值的信息和帮助。'
    protected modelSkills?: Map<string, Marisa.Skill.ModelSkillMetadata>;
    protected modelSkillLoadTool?: LocalTool<{
        skillName: string;
    }>;

    constructor(modelOptions: Marisa.Model.ModelOptions, modelCompletionOptions: Marisa.Model.ModelCompletionOptions) {
        super()

        const modelName = modelCompletionOptions.modelName || process.env.MODEL_NAME || process.env.OPENAI_MODEL_NAME || undefined
        if (!modelName) {
            throw new Error('No Model Call Name')
        }

        this.modelCompletionOptions = {
            temperature: modelCompletionOptions.temperature,
            maxCompletionTokens: modelCompletionOptions.maxCompletionTokens,
            parallelToolCalls: modelCompletionOptions.parallelToolCalls ?? true,
            topP: modelCompletionOptions.topP,
            toolChoice: modelCompletionOptions.toolChoice,
            promptCacheRetention: modelCompletionOptions.promptCacheRetention,
            modelName: modelName,
            simplifyHistorySession: modelCompletionOptions.simplifyHistorySession ?? true,
        }

        this.modelContexts = modelOptions.modelContexts || this._createEmptyContext()

        if (modelOptions.modelToolMap) {
            this.modelToolMap = modelOptions.modelToolMap
        }

        this.modelSkills = modelOptions.modelSkills
        this.modelSkillLoadTool = modelOptions.modelSkillLoadTool

        for (const [_, tool] of this.modelToolMap.entries()) {
            if (tool) {
                this.modelBuiltTools.push(tool.build())
            }
        }
        
        if (modelOptions.modelRolePrompt) {
            this.modelRolePrompt = modelOptions.modelRolePrompt
        }

        this.modelContextDumpFile = modelOptions.modelContextDumpFile
    }

    protected _dumpContexts() {
        if (this.modelContextDumpFile) {
            if (!fse.existsSync(this.modelContextDumpFile)) {
                const dir = path.dirname(this.modelContextDumpFile)
                fse.ensureDirSync(dir)
            }
            fse.writeFileSync(this.modelContextDumpFile, JSON.stringify(this.modelContexts, null, 4), 'utf-8')
        }
    }

    protected _createEmptyContext(): Marisa.Chat.Completion.CompletionContext {
        const context: Marisa.Chat.Completion.CompletionContext = {
            sessions: [],
            id: Date.now().toString()
        }
        return context
    }

    protected _createEmptySession(): Marisa.Chat.Completion.CompletionSession {
        const session: Marisa.Chat.Completion.CompletionSession = {
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            },
            messages: [],
            sessionId: Date.now()
        }
        return session
    }

    public _buildSystemMessage(): string {
        const now = new Date();
        const dateStr = now.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        const timeStr = now.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
        let systemPrompt = `${this.modelRolePrompt} \n当前日期是 ${dateStr}，当前时间是 ${timeStr}`

        if (this.modelSkills) {
            systemPrompt += '\n##你可以使用的技能有,使用工具load_skill以使用'
            for (const [skillName, skillMeta] of this.modelSkills.entries()) {
                systemPrompt += `\n技能：${skillName}，功能：${skillMeta.description}`
            }
        }

        return systemPrompt
    }

    protected async _callTool(callName: string, callArguments: Record<string, any>): Promise<string> {

        this.emit('toolCall',callName,callArguments)

        const tool = this.modelToolMap.get(callName)
        if (!tool) {
            return JSON.stringify({ error: `Tool ${callName} not found.` });
        }
        try {
            const result: any = await tool.execute(callArguments)
            this.emit('toolCallResult',callName,callArguments,result)

            return JSON.stringify(result)
        } catch (error) {

            this.emit('toolCallError',callName,callArguments,error)

            return JSON.stringify({ error: `Tool call Error ${error}` });
        }
    }

    public configModel(config?: Partial<Marisa.Model.ModelCompletionOptions>) {
        this.modelCompletionOptions = {
            ...this.modelCompletionOptions,
            ...config
        }
    }

    protected _filterSessions(sessionCount: number = 5) {
        const selectedSessions = this.modelContexts.sessions.slice(-(sessionCount * 2))
        let filterSessions: Marisa.Chat.Completion.CompletionSession[] = []

        if (this.modelCompletionOptions.simplifyHistorySession) {
            const latestSession = selectedSessions.pop()
            for (const session of selectedSessions) {
                for (const message of session.messages || []) {
                    if (message.role === 'tool') {
                        message.content = ''
                    }
                    else if (message.role === 'assistant' && message.tool_calls?.length) {
                        for (const call of message.tool_calls) {
                            if (call.type === 'function') {
                                call.function.arguments = '{}'

                            }
                            else if (call.type === 'custom') {
                                call.custom.input = '{}'
                            }
                            else {
                                const _: never = call
                            }
                        }
                    }
                }
                filterSessions.push(session)
            }
            latestSession && filterSessions.push(latestSession)
        }
        else {
            filterSessions = selectedSessions
        }
        return filterSessions
    }
}