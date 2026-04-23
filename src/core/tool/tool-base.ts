import Anthropic from "@anthropic-ai/sdk";
import { Marisa } from "../../types/marisa";

export type MCPToolInputSchemaLike = Marisa.Tool.MCP.MCPToolIOSchema
export type MCPToolOutputSchemaLike = Marisa.Tool.MCP.MCPToolIOSchema
type PermissionChecker = () => boolean | Promise<boolean>
type IPermissions = Record<string,PermissionChecker>

export default abstract class ToolBase<ToolParams extends Record<string, any> = Record<string, any>, ToolResult = any,Permissions = IPermissions> {
    protected executor: ((params: ToolParams,permission:Permissions) => ToolResult | Promise<ToolResult>) | null = null;
    public toolName: string = '';
    public description: string = '';

    public abstract buildAsOpenAI(): Marisa.Chat.Completion.CompletionTool 
    public abstract buildAsAnthropic():Anthropic.Messages.ToolUnion
}