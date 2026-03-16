
import ToolBase from "./base_tool";
import { Marisa } from "../../types/marisa";

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

    public build(): Marisa.Chat.Completion.CompletionTool {
        return {
            type: 'function',
            function: {
                name: this.toolName,
                description: this.description,
                parameters: this.inputSchema
            },
        }
    }
}