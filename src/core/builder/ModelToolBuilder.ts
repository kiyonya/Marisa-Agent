import OpenAI from "openai"
import { Marisa } from "../../types/marisa"

export default class ModelToolBuilder {
    protected modelTools: Marisa.Tool.AnyTool[] = []
    protected modelToolkits: Marisa.Tool.AnyToolkit[] = []
    constructor(modelTools: Marisa.Tool.AnyTool[], modelToolkits: Marisa.Tool.AnyToolkit[]) {
        this.modelTools = modelTools
        this.modelToolkits = modelToolkits
    }
    public buildToolMap(): Map<string, Marisa.Tool.AnyTool> {
        const builtTools = new Map<string, Marisa.Tool.AnyTool>()
        const unpackTools: Marisa.Tool.AnyTool[] = [...this.modelTools]
        for (const toolkit of this.modelToolkits) {
            const unpack = toolkit.list()
            unpackTools.push(...unpack)
        }
        for (const tool of unpackTools) {
            const name = tool.toolName
            if (builtTools.has(name)) {
                console.warn()
            }
            builtTools.set(name, tool)
        }
        return builtTools
    }
    public buildAsOpenAI(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        const map = this.buildToolMap()
        const openAILikeToolDeclarations: OpenAI.Chat.Completions.ChatCompletionTool[] = []
        for (const [_, tool] of map.entries()) {
            //这个就是openai的
            const openAILikeToolDeclaration = tool.build()
            openAILikeToolDeclarations.push(openAILikeToolDeclaration)
        }
        return openAILikeToolDeclarations
    }
}