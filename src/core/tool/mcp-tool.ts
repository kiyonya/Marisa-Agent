
import ToolBase from "./tool-base";
import { Marisa } from "../../types/marisa";
import Anthropic from "@anthropic-ai/sdk";

export type MCPToolInputSchemaLike = Marisa.Tool.MCP.MCPToolIOSchema
export type MCPToolOutputSchemaLike = Marisa.Tool.MCP.MCPToolIOSchema

export default class MCPTool<ToolParams extends Record<string, any> = {}, ToolResult = any> extends ToolBase<ToolParams, ToolResult> {

    protected override executor: (params: ToolParams) => Promise<ToolResult> | ToolResult;
    public override toolName: string
    public override description: string = ''
    public inputSchema: MCPToolInputSchemaLike
    public outputSchema?: MCPToolOutputSchemaLike

    constructor(toolName: string, description: string, executor: (params: ToolParams) => Promise<ToolResult> | ToolResult, inputSchema: MCPToolInputSchemaLike, outputSchema?: MCPToolOutputSchemaLike) {
        super()
        this.toolName = toolName
        this.description = description
        this.executor = executor
        this.inputSchema = inputSchema
        this.outputSchema = outputSchema
    }

    public async execute(params: ToolParams): Promise<ToolResult> {
        if (!this.executor) {
            throw new Error('Executor not initialized');
        }
        return await this.executor(params);
    }

    public override buildAsOpenAI(): Marisa.Chat.Completion.CompletionTool {
        return {
            type: 'function',
            function: {
                name: this.toolName,
                description: this.description,
                parameters: this.inputSchema
            },
        }
    }

    public override buildAsAnthropic():Anthropic.Messages.ToolUnion{
        return {
            name:this.toolName,
            type:"custom",
            input_schema:this.inputSchema,
            description:this.description
        }
    }
}