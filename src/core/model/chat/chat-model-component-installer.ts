import { Marisa } from "@type/marisa"
import ChatModel, { ContextPutFunction, ContextQueryFunction, ModelInterceptors } from "./chat-model"
import { Interceptor, InterceptorChain } from "@core/utils/interceptor"
import CommandProcessor from "../command/command-processor"
import ComponentInstaller from "@core/utils/component-installer"

type WorkspaceSubPath = 'contexts' | 'memories' | 'skills' | 'memories/categories' | 'memories/vector' | 'memories/search' | 'memories/hybrid' | 'temp'

export interface ChatModelInstallManifest {
    tools?: Marisa.Tool.AnyToolParam[]
    context?: {
        putFunction: ContextPutFunction,
        queryFunction: ContextQueryFunction
    }
    modelSlashCommands?: Map<string, (...args: string[]) => any>
    modelMentionCommands?: Map<string, (...args: string[]) => any>
    modelInterceptors?: { [K in keyof Marisa.Model.ModelInterceptors]?: Interceptor<Marisa.Model.ModelInterceptors[K]>[] }
}

export default class ChatModelComponentInstaller extends ComponentInstaller<ChatModelInstallManifest> {

    protected tools = new Map<string, Marisa.Tool.AnyToolParam>()
    protected contextPutFunction: ContextPutFunction | null = null
    protected contextQueryFunction: ContextQueryFunction | null = null
    protected readonly modelSlashCommands = new Map<string, (...args: string[]) => any>()
    protected readonly modelMentionCommands = new Map<string, (...args: string[]) => any>()
    protected readonly modelInterceptors:
        {
            [K in keyof Marisa.Model.ModelInterceptors]?: Interceptor<Marisa.Model.ModelInterceptors[K]>[]
        } = {}

    constructor(workspace: string) {
        super(workspace)
    }

    public registerTool(...tools: Marisa.Tool.AnyToolParam[]) {
        for (const tool of tools) {
            const toolName = tool.toolName
            if (this.tools.has(toolName)) {
                console.log('')
                continue
            }
            this.tools.set(toolName, tool)
        }
        return this
    }

    public registerModelContextPutFunction(put: ContextPutFunction) {
        this.contextPutFunction = put
        return this
    }

    public registerModelContextQueryFunction(query: ContextQueryFunction) {
        this.contextQueryFunction = query
        return this
    }

    public registerModelInterceptor<K extends keyof Marisa.Model.ModelInterceptors>(type: K, interceptor: Interceptor<Marisa.Model.ModelInterceptors[K]>) {
        if (!this.modelInterceptors[type]) {
            this.modelInterceptors[type] = [interceptor]
        }
        else {
            this.modelInterceptors[type].push(interceptor)
        }
    }

    public registerSlashCommand(command: string, callback: (...args: string[]) => any) {
        this.modelSlashCommands.set(command, callback)
    }

    public registerMentionCommand(command: string, callback: (...args: string[]) => any) {
        this.modelMentionCommands.set(command, callback)
    }

    public override createInstallManifest(): ChatModelInstallManifest {
        const manifest: ChatModelInstallManifest = {
            tools: [...this.tools.values()],
            modelSlashCommands: this.modelSlashCommands,
            modelInterceptors: this.modelInterceptors,
            modelMentionCommands: this.modelMentionCommands
        }
        if (this.contextPutFunction && this.contextQueryFunction) {
            manifest.context = {
                putFunction: this.contextPutFunction,
                queryFunction: this.contextQueryFunction
            }
        }
        return manifest
    }
}