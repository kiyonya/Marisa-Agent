import ComponentInstaller from "@core/utils/component-installer";
import { Marisa } from "@type/marisa";
import ToolGroup from "@core/tool/tool-group";
import AgentPluginBase from "@core/plugin/agent-plugin-base";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import ChatModelComponent from "@core/model/chat/chat-model-component";


export interface AgentComponentInstallManifest {
    tools?: Marisa.Tool.AnyToolParam[],
    mcps?: Map<string, URL | StdioServerParameters>,
    toolGroups?: ToolGroup[],
    plugins?: AgentPluginBase[],
    modelComponent?: ChatModelComponent<any>[],
    modelSlashCommands?: Map<string, (...args: string[]) => any>
    modelMentionCommands?: Map<string, (...args: string[]) => any>
    modelInterceptors?: { [K in keyof Marisa.Model.ModelInterceptors]?: Interceptor<Marisa.Model.ModelInterceptors[K]>[] },
    modelSystemPromptFragments?:string[]
}

type Interceptor<I> = (prev: I) => I

export default class AgentComponentInstaller extends ComponentInstaller<AgentComponentInstallManifest> {

    private readonly tools = new Map<string, Marisa.Tool.AnyToolParam>()
    private readonly mcps = new Map<string, URL | StdioServerParameters>()
    private readonly toolGroups = new Map<string, ToolGroup>()
    private readonly plugins = new Map<string, AgentPluginBase>()
    private readonly modelComponents: ChatModelComponent<any>[] = []
    private readonly modelSlashCommands = new Map<string, (...args: string[]) => any>()
    private readonly modelMentionCommands = new Map<string, (...args: string[]) => any>()
    private readonly modelInterceptors:
        {
            [K in keyof Marisa.Model.ModelInterceptors]?: Interceptor<Marisa.Model.ModelInterceptors[K]>[]
        } = {}
    private readonly modelSystemPromptFragments:string[] = []

    constructor(workspace: string) {
        super(workspace)
    }

    public registerTool(tool: Marisa.Tool.AnyToolParam): void {
        const name = tool.toolName
        this.tools.set(name, tool)
    }

    public registerMCPServer(serverName: string, io: StdioServerParameters | URL): void {
        this.mcps.set(serverName, io)
    }

    public registerPlugin(pluginName: string, plugin: AgentPluginBase): void {
        this.plugins.set(pluginName, plugin)
    }

    public registerToolGroup(toolGroup: ToolGroup): void {
        const ns = toolGroup.namespace || "an"
        this.toolGroups.set(ns, toolGroup)
    }

    public registerSystemPromptFragment(systemPrompt:string){
        this.modelSystemPromptFragments.push(systemPrompt)
    }

    public registerModelComponent<T extends Record<any, any> = any>(component: ChatModelComponent<T>): void {
        this.modelComponents.push(component)
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


    public override createInstallManifest(): AgentComponentInstallManifest {
        const manifest: AgentComponentInstallManifest = {
            tools: [...this.tools.values()],
            toolGroups: [...this.toolGroups.values()],
            plugins: [...this.plugins.values()],
            mcps: this.mcps,
            modelComponent: this.modelComponents,
            modelSlashCommands:this.modelSlashCommands,
            modelInterceptors:this.modelInterceptors,
            modelMentionCommands:this.modelMentionCommands,
            modelSystemPromptFragments:this.modelSystemPromptFragments
        }
        return manifest
    }

}