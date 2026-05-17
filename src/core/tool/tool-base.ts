import Anthropic from "@anthropic-ai/sdk";
import { Marisa } from "../../types/marisa";
import PermissionAsker from "@core/permission/permission-requestor";

export type MCPToolInputSchemaLike = Marisa.Tool.MCP.MCPToolIOSchema
export type MCPToolOutputSchemaLike = Marisa.Tool.MCP.MCPToolIOSchema

export default abstract class ToolBase<ToolParams extends Record<string, any> = Record<string, any>, ToolResult = string | Record<any,any> | any[] | Symbol > {
    protected executor: ((params: ToolParams,permission?:PermissionAsker) => ToolResult | Promise<ToolResult>) | null = null;
    public toolName: string = '';
    public description: string = '';

    public abstract buildAsOpenAI(): Marisa.Chat.Completion.CompletionTool 
    public abstract buildAsAnthropic():Anthropic.Messages.ToolUnion
}