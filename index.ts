
import Agent from "./src/core/agent";
import CommandLineModelChat from "./src/core/use/chat_model";
import fileSystemToolkit from "./src/internal/toolkit/filesystem";
import FormatPrint from "./src/core/use/format_print";
import dotenv from 'dotenv'
process.stdin.resume();

async function useAgent() {

    dotenv.config()

    const agent = new Agent({
        agentName: "Agent",
        modelOption: {
            simplifyHistorySession: false
        }
    })
        .configModel({
            temperature: 0.2,
            maxCompletionTokens: 1024,
            toolChoice: 'auto',
            parallelToolCalls: true,
        })
        .toolkit(fileSystemToolkit)
        // .skill('.marisa/skills')
        // .roleMarkdown('.marisa/roles/mixuer.md')
        // .memory(".marisa/contexts/记忆文件.json")
        .on('skillsRegistered', FormatPrint.printSkillList)
        .on('toolsRegistered', FormatPrint.printToolList)


    const model = await agent.create("openai", {
        modelName: process.env.MODEL_NAME as string,
        apiKey: process.env.API_KEY as string,
        baseURL: process.env.BASE_URL as string
    })

    model.on('toolCallResult', FormatPrint.printToolCallResult)

    new CommandLineModelChat(model)
}

useAgent()