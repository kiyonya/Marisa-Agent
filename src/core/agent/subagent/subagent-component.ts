import z from "zod";
import ChatModel from "@core/model/chat/chat-model";
import LocalTool from "@core/tool/local-tool";
import { Marisa } from "@type/marisa";
import AgentComponent from "../impl/agent-component";
import { SubAgentDefaultTools } from "../tools/default";

export interface CreateSubAgentOptions {
    tasks: {
        name: string,
        systemPrompt: string,
        prompt: string
    }[],
    parallel: boolean,
    waitExecResult: boolean
}

export default class SubAgentComponent extends AgentComponent<Marisa.Events.AgentComponent.SubAgentComponent> {

    private readonly mainAgentSystemPromptGuide = `## SubAgent Usage Guide
    
You have access to a powerful tool CreateSubAgent that can create specialized sub-agents to perform specific tasks. Sub-agents are independent instances that focus on the tasks you assign and return results to you.

### When to Use SubAgent

It is **strongly recommended** to use CreateSubAgent in the following scenarios:

#### 1. Multi-Goal Tasks
- User requests involve multiple **independent** subtasks (e.g., analyzing three different files, checking the status of multiple code repositories)
- Subtasks have no or only weak dependencies on each other
- Example: *"Read the contents of file A, file B, and file C and summarize them"*

#### 2. Tasks Requiring Focused Context
- Tasks require deep focus, and switching the main context would interfere with efficiency
- Tasks have clear logic and well-defined boundaries that can be completed independently
- Example: *"Find all potential memory leaks in this complex code"*

#### 3. File Read/Write Intensive Tasks
- Tasks require reading or writing multiple files
- Note: **You must provide the absolute path of the file**
- Example: *"Create a new file in D:/example/abc.md and write the following content..."*

#### 4. Tasks That Can Run in Parallel
- Multiple subtasks can run simultaneously without blocking each other
- Setting parallel: true can significantly improve efficiency
- Example: *"Fetch data from these three APIs at the same time"*

#### 5. Tasks Requiring Isolated Execution
- Task execution may produce temporary state, but you don't want it to affect the main session
- The sub-agent's state is destroyed after execution completes
- Example: *"Temporarily try an experimental algorithm and see what the output is"*

#### 6. Tasks That Can Be Clearly Defined and Described
- You can write clear goals, inputs, and output specifications for the task
- You can write effective system prompts and user prompts for the sub-agent

### When NOT to Use SubAgent

- The task is extremely simple and can be completed in one sentence (e.g., calculating 1+1)
- Interaction with the user or real-time confirmation is required (sub-agents cannot converse with users)
- The task depends on intermediate results that are not yet completed in the current conversation (wait for the results before creating a sub-agent)

### Invocation Strategy

#### Wait for Results vs. Don't Wait

- **waitExecResult: true**
  - Use when you need the sub-agent's output results to continue your work
  - The main agent blocks and waits until all sub-agents complete and collects the results
  - Results are returned to you as a Record object

- **waitExecResult: false**
  - Use when you only need to trigger sub-agent execution and don't care about immediate results
  - The main agent immediately returns true and continues execution
  - Sub-agents run in the background

#### Parallel vs. Serial

- **parallel: true**
  - Use when subtasks have no dependencies on each other
  - All sub-agents execute simultaneously for maximum efficiency

- **parallel: false**
  - Use when subtasks have sequential dependencies
  - The next sub-agent starts only after the previous one completes

### Example Invocation
  "tasks": [
    {
      "name": "Analyze log file",
      "systemPrompt": "You are a log analysis expert who focuses only on errors and warnings.",
      "prompt": "Please analyze the /var/log/app.log file, find all ERROR level logs, and categorize them."
    },
    {
      "name": "Check configuration file",
      "systemPrompt": "You are a configuration review expert.",
      "prompt": "Check whether all configuration items in /etc/app/config.json comply with specifications, and mark any missing configuration items."
    }
  ],
  "parallel": true,
  "waitExecResult": true
}`

    private readonly subAgentSystemPrompt = `You are a subagent spawned by the main agent to complete a specific task.Stay focused on the assigned task. Your final response will be reported back to the main agent.`
    private subAgentToolMap = new Map<string, Marisa.Tool.AnyTool>()

    constructor(chatModel?: ChatModel, tools?: Marisa.Tool.AnyTool[]) {
        super()
        const agentTools = tools ? tools : [...SubAgentDefaultTools]
        for (const tool of agentTools) {
            this.subAgentToolMap.set(tool.toolName, tool)
        }
        this.installFunction = (installer) => {
            const model = chatModel || installer.getModel()
            const tool = this.createToolForMainAgent(installer.workspace, model)
            installer.registerTool(tool)
            installer.registerSystemPromptFragment(this.mainAgentSystemPromptGuide)
        }
    }

    private createToolForMainAgent(workspace: string, chatModel: ChatModel) {

        const toolDescription = `Tool for creating sub-agents to handle specific tasks. Accepts a list of tasks with their respective system prompts and user prompts, along with execution options.Returns the results of each sub-agent's execution if waitExecResult is true, otherwise returns true after initiating all sub-agents.\nwhen your task need create or read files,you must tell the sub-agent the path of file or directory in absolute path, and the sub-agent will read or create files in the workspace directory. the workspace directory is ${workspace}.`

        return new LocalTool<CreateSubAgentOptions>('CreateSubAgent', toolDescription, async ({ tasks, parallel, waitExecResult }) => {

            this.emit('subAgentCreate', tasks, parallel, waitExecResult)
            const taskPromiseMap = new Map<string, Promise<Marisa.Chat.Completion.CompletionSession>>()

            for (const task of tasks) {
                const name = task.name || crypto.randomUUID()
                const taskPrompt = task.prompt
                const l1systemPrompt = `
                ${this.subAgentSystemPrompt}\n\n
                ${task.systemPrompt}
                `
                taskPromiseMap.set(name, chatModel.complete(taskPrompt, l1systemPrompt, this.subAgentToolMap))
            }

            const executor = this.taskMapExecutor(taskPromiseMap, parallel, waitExecResult)

            if (waitExecResult) {
                const data = this.map2Record(await executor)
                this.emit('subAgentAllSettled', data)
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
    }

    private async taskMapExecutor(taskPromiseMap: Map<string, Promise<Marisa.Chat.Completion.CompletionSession>>, parallel: boolean, waitExec: boolean) {
        const tasks = [...taskPromiseMap.entries()]
        const results = new Map<string, Marisa.Chat.Completion.CompletionSession | string>()
        if (parallel) {
            await Promise.all(tasks.map(async ([name, promise]) => {
                try {
                    const result = await promise
                    results.set(name, result)
                    this.emit('subAgentExecSuccess', result)
                } catch (error) {
                    this.emit('subAgentExecFail', error)
                    results.set(name, String(error))
                }
            }))
        }
        else {
            for (const [name, promise] of tasks) {
                try {
                    const result = await promise
                    results.set(name, result)
                    this.emit('subAgentExecSuccess', result)
                } catch (error) {
                    this.emit('subAgentExecFail', error)
                    results.set(name, String(error))
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

