import { Marisa } from "@type/marisa"
import LocalTool from "./local-tool"
import MCPTool from "./mcp-tool"

type PermissionChecker = () => boolean | Promise<boolean>
type IPermissions = Record<string, PermissionChecker>
type NonVoidToolResult<T> = T extends void ? never : T

type GeneratedTool<ToolParams extends Record<string, any> = {}, ToolResult = NonVoidToolResult<any>, Permissions = IPermissions> = LocalTool<ToolParams, ToolResult, Permissions> | MCPTool<ToolParams, ToolResult>

export default class DynamicTool<ToolParams extends Record<string, any> = {}, ToolResult = NonVoidToolResult<any>, Permissions = IPermissions> {
    public toolName: string
    public generator: () => GeneratedTool<ToolParams, ToolResult, Permissions> | Promise<GeneratedTool<ToolParams, ToolResult, Permissions>>
    constructor(toolName: string, generator: () => GeneratedTool<ToolParams, ToolResult, Permissions> | Promise<GeneratedTool<ToolParams, ToolResult, Permissions>>) {
        this.toolName = toolName
        this.generator = generator
    }
    public async generate() {
        if (!this.generator) {
            throw new Error(`Generator not initialized for DynamicTool "${this.toolName}"`);
        }
        const tool = await this.generator()
        if (tool.toolName !== this.toolName) {
            throw new Error(`Generated tool name "${tool.toolName}" does not match expected name "${this.toolName}" when generating DynamicTool "${this.toolName}"`)
        }
        return tool
    }
    public static toDynamicTool<ToolParams extends Record<string, any> = {},ToolResult = NonVoidToolResult<any>,Permissions = IPermissions>(tool: LocalTool<ToolParams, ToolResult, Permissions> | MCPTool<ToolParams, ToolResult>): DynamicTool<ToolParams, ToolResult, Permissions> {
        const name = tool.toolName
        return new this(name, () => tool)
    }
}