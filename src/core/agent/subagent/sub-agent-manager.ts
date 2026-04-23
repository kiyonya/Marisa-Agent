import z from "zod";
import ChatModel from "../../model/chat/chat-model";
import LocalTool from "../../tool/local-tool";
import { Marisa } from "../../../types/marisa";

export interface CreateSubAgentOptions {
    tasks: {
        name: string,
        systemPrompt: string,
        prompt: string
    }[],
    parallel: boolean,
    waitExecResult: boolean
}

export default class SubAgentManager {

    private workspace: string
    private chatModel: ChatModel
    private subAgentSystemPrompt = `
    You are a subagent spawned by the main agent to complete a specific task.
    Stay focused on the assigned task. Your final response will be reported back to the main agent.
    workspace
    `
    private createSubAgentTool: LocalTool<CreateSubAgentOptions> | null = null


    constructor(workspace: string, chatModel: ChatModel) {
        this.workspace = workspace
        this.chatModel = chatModel
    }

    public async init(): Promise<LocalTool<any>> {

        const toolDescription = `Tool for creating sub-agents to handle specific tasks. 
Accepts a list of tasks with their respective system prompts and user prompts, along with execution options.
Returns the results of each sub-agent's execution if waitExecResult is true, otherwise returns true after initiating all sub-agents.

when your task need create or read files,you must tell the sub-agent the path of file or directory in absolute path, and the sub-agent will read or create files in the workspace directory. the workspace directory is ${this.workspace}.
`

        this.createSubAgentTool = new LocalTool<CreateSubAgentOptions>('create_subagent', toolDescription, async ({ tasks, parallel, waitExecResult }) => {

            const taskPromiseMap = new Map<string, Promise<Marisa.Chat.Completion.CompletionSession>>()

            for (const task of tasks) {
                const name = task.name || crypto.randomUUID()
                const taskPrompt = task.prompt
                const l1systemPrompt = `
                ${this.subAgentSystemPrompt}\n\n
                ${task.systemPrompt}
                `
                taskPromiseMap.set(name, this.chatModel.invokeIsolate(taskPrompt, l1systemPrompt))
            }

            const executor = this.taskMapExecutor(taskPromiseMap, parallel, waitExecResult)

            if (waitExecResult) {
                const data = this.map2Record(await executor)
                console.log(JSON.stringify(data, null, 4))
                return data
            }
            else {
                return true
            }
        }, {
            tasks: z.array(z.object({
                name: z.string().describe('子Agent名称,用于标记和收集结果'),
                systemPrompt: z.string().describe('子Agent的系统提示词'),
                prompt: z.string().describe('子Agent的用户提示词')
            })),
            parallel: z.boolean().describe('是否并行执行子Agent'),
            waitExecResult: z.boolean().describe('是否等待子Agent执行完成后再继续执行后续操作')
        })

        return this.createSubAgentTool
    }

    private async taskMapExecutor(taskPromiseMap: Map<string, Promise<Marisa.Chat.Completion.CompletionSession>>, parallel: boolean, waitExec: boolean) {
        const tasks = [...taskPromiseMap.entries()]
        const results = new Map<string, Marisa.Chat.Completion.CompletionSession | string>()
        if (parallel) {
            await Promise.all(tasks.map(async ([name, promise]) => {
                try {
                    const result = await promise
                    results.set(name, result)
                } catch (error) {
                    console.error(name, String(error))
                }
            }))
        }
        else {
            for (const [name, promise] of tasks) {
                try {
                    const result = await promise
                    results.set(name, result)
                } catch (error) {
                    console.error(name, String(error))
                }
            }
        }
        return results
    }

    private map2Record<K, V>(map: Map<K, V>): Record<string, V> {
        const record: Record<string, V> = {}
        for (const [key, value] of map.entries()) {
            record[String(key)] = value
        }
        return record
    }

}