import EventEmitter from "node:events";
import { Marisa } from "../../types/marisa";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import MCPToolkit from "../mcp/MCPToolkit";
import path from "node:path";
import { ensureDirSync } from "fs-extra";

export interface PluginInstallResult {
    tools: Marisa.Tool.AnyTool[],
    constantTools: Marisa.Tool.AnyTool[],
    systemPrompts: string[]
}

type WorkspaceSubPath = 'contexts' | 'memories' | 'skills' | 'memories/categories' | 'memories/vector' | 'memories/search' | 'temp'

export default class PluginInstaller extends EventEmitter {

    public static pluginName: string = 'plugin'

    protected registedTools = new Map<string, Marisa.Tool.AnyTool>()
    protected registedConstantTools = new Map<string, Marisa.Tool.AnyTool>()
    protected registedMCPServers = new Map<string, (StdioServerParameters | URL)>()
    protected registedSystemPrompts: string[] = []

    public onInstallSuccess: ((result: PluginInstallResult) => void) | null = null
    public onInstallFailed: ((error: Error) => void) | null = null

    public workspace: string
    constructor(workspace: string) {
        super()
        this.workspace = workspace
    }

    public registerTool(...tools: Marisa.Tool.AnyTool[]) {
        for (const tool of tools) {
            const toolName = tool.toolName
            if (this.registedTools.has(toolName)) {
                console.log('')
                continue
            }
            this.registedTools.set(toolName, tool)
        }
        return this
    }

    public registerSystemPrompt(...prompt: string[]) {
        this.registedSystemPrompts.push(...prompt)
        return this
    }

    public registerMCPServer(mcpServers: Record<string, (StdioServerParameters | URL)>) {
        for (const [name, params] of Object.entries(mcpServers)) {
            if (this.registedMCPServers.has(name)) {
                throw new Error()
            }
            this.registedMCPServers.set(name, params)
        }
    }

    public async install(): Promise<PluginInstallResult> {
        try {
            const injectTools = new Map<string, Marisa.Tool.AnyTool>()
            const injectConstantTools = new Map<string, Marisa.Tool.AnyTool>()
            for (const [name, params] of this.registedMCPServers.entries()) {
                const mcpServerToolkit = new MCPToolkit(name, params)
                const tools = await mcpServerToolkit.init()
                for (const tool of tools) {
                    const toolName = tool.toolName
                    if (injectTools.has(toolName)) {
                        console.warn(`Tool name conflict: ${toolName} already exists, the tool from MCP server ${name} will be ignored.`)
                        continue
                    }
                    injectTools.set(toolName, tool)
                }
            }
            if (this.registedTools.size > 0) {
                for (const [name, tool] of this.registedTools.entries()) {
                    if (injectTools.has(name)) {
                        console.warn(`Tool name conflict: ${name} already exists, the tool registered in plugin will be ignored.`)
                        continue
                    }
                    injectTools.set(name, tool)
                }
            }
            if (this.registedConstantTools.size > 0) {
                for (const [name, tool] of this.registedConstantTools.entries()) {
                    if (injectTools.has(name) || injectConstantTools.has(name)) {
                        console.warn(`Tool name conflict: ${name} already exists, the constant tool registered in plugin will be ignored.`)
                        continue
                    }
                    injectConstantTools.set(name, tool)
                }
            }
            const result: PluginInstallResult = {
                tools: Array.from(injectTools.values()),
                constantTools: Array.from(injectConstantTools.values()),
                systemPrompts: this.registedSystemPrompts
            }
            if (this.onInstallSuccess) {
                this.onInstallSuccess(result)
            }
            return result
        } catch (error) {
            if (this.onInstallFailed) {
                this.onInstallFailed(error as Error)
            }
            throw error
        }
    }

    public getWorkspace(subpath?: WorkspaceSubPath | string) {
        let dpath = this.workspace
        if (!subpath) {
            dpath = this.workspace
        }
        else {
            dpath = path.join(this.workspace, subpath)
        }
        ensureDirSync(dpath)
        return dpath
    }
}

