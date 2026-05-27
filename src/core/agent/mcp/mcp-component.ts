import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport, StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import AgentComponent from "../impl/agent-component";
import MCPTool from "@core/tool/mcp-tool";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";


export type MCPConnectionParam = StdioServerParameters | URL

export interface MCPComponentOptions {
    toolCallRequestTimeout?: number
}

export default class MCPComponent extends AgentComponent<any> {

    private options?: MCPComponentOptions
    protected mcpServers = new Map<string, MCPConnectionParam>()

    constructor(options?: MCPComponentOptions) {
        super()
        this.options = options

        this.installFunction = async (installer) => {

            const tools = await this.init()
            for (const tool of tools) {
                installer.registerTool(tool)
            }

            installer.registerSlashCommand('mcp', () => {
                let response = 'MCP Servers:\n'
                for (const [namespace, param] of this.mcpServers.entries()) {
                    response += `- ${namespace}: ${param instanceof URL ? param.href : JSON.stringify(param)}\n`
                }
                console.log(response)
            })
        }
    }

    public async init() {
        if (!this.mcpServers.size) { return [] }
        const mcpTools: MCPTool<any, any>[] = []
        for (const [namespace, mcpConnectionParam] of this.mcpServers.entries()) {

            try {
                const transport = mcpConnectionParam instanceof URL ? new StreamableHTTPClientTransport(mcpConnectionParam) : new StdioClientTransport(mcpConnectionParam)
                const client = new Client({
                    name: namespace,
                    version: ''
                })
                await client.connect(transport)

                const listTools = await client.listTools()

                for (const tool of listTools.tools) {

                    const mcpTool = new MCPTool<Record<string, any>, Promise<string>>(this.createToolNameWithNamespace(namespace, tool.name), tool.description || '', async (params) => {
                        const res = await client.request({ method: 'tools/call', params: { name: tool.name, arguments: params } }, CallToolResultSchema, {
                            timeout: this.options?.toolCallRequestTimeout
                        })
                        const content = res?.content
                        const contentString = JSON.stringify(content)
                        return contentString
                    }, tool.inputSchema)
                    mcpTools.push(mcpTool)
                }
            } catch (error) {
                throw new MCPComponent.MCPServerConnectException(`cannot create connection of mcp server "${namespace}" with error ${error}`)
            }
        }
        return mcpTools
    }

    protected createToolNameWithNamespace(namespace: string, toolName: string) {
        return `__mcp_${namespace}_${toolName}`
    }

    public addMCPServer(namespace: string, mcpConnectionParam: MCPConnectionParam) {
        if (this.mcpServers.has(namespace)) {
            throw new Error(`mcp server with namespace "${namespace}" already exists`)
        }
        this.mcpServers.set(namespace, mcpConnectionParam)
        return this
    }

    public deleteMCPServer(namespace: string) {
        this.mcpServers.delete(namespace)
        return this
    }

    public static MCPServerConnectException = class MCPServerConnectException extends Error { }
}