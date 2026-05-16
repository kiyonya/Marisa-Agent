
import AgentComponent from "../impl/agent-component";
import LocalTool from "@core/tool/local-tool";
import DynamicTool from "@core/tool/dynamic-tool";
import crypto from 'crypto'
import z from "zod";
import XMLPromptTemplate from "@core/prompt/template/xml-prompt-template";

export interface TODOItem {
    title: string,
    description: string,
    steps: string[],
    currentStep: number,
    uuid: string,
    status: 'pending' | 'complete' | 'failed'
}


export default class AgentTODO extends AgentComponent<any> {
    private TODO = new Map<string, TODOItem>()
    private readonly CREATE_TODO_TOOL_NAME = 'CreateTODO'
    private readonly UPDATE_TODO_TOOL_NAME = 'UpdateTODO'
    constructor() {
        super()
        this.installFunction = (installer) => {

            installer.registerSystemPromptFragment(`message suround in tag <current-todo></current-todo> is the todos now pending, you need to follow the steps in it to complete the task for user.`)

            installer.registerModelInterceptor('userPromptInput', ({ inputMessages }) => {
                if (this.TODO.size) {
                    //插入临时的todo消息到usermessage
                    for (const [uuid, todo] of this.TODO.entries()) {

                        const todoXML = `<todo uuid="${uuid}" title="${todo.title}" description="${todo.description}" currentStep="${todo.currentStep}" totalSteps="${todo.steps.length}">${todo.steps.map((step, index) => `<step number="${index + 1}" ${index < todo.currentStep ? 'status="completed"' : ''}>${step}</step>`).join('')}</todo>`

                        inputMessages.push({
                            role: 'user',
                            temporary: true,
                            content: `<current-todo>${todoXML}</current-todo>`,
                            timestamp: Date.now()
                        })
                    }
                }
                return { inputMessages }
            })

            installer.registerSlashCommand("todo", (type: string) => {
                if (type === 'list') {
                    let currentTODO = new XMLPromptTemplate({
                        todo: [...this.TODO.values()]
                    }).toString()
                    console.log(currentTODO)
                }
                else if (type === 'clear') {
                    this.TODO.clear()
                }
            })
            const tools = this.createTool()
            for (const tool of tools) {
                installer.registerTool(tool)
            }
        }
    }

    private createTool() {
        const createTODODynamicTool = new DynamicTool<{ title: string, description: string, steps: string[], currentStep?: number }>(this.CREATE_TODO_TOOL_NAME, () => {

            const createToolDescription = `Create a TODO for tracking complex, multi-step tasks.\nWhen to Use\n- Only create a TODO when the task requires more than 10 distinct steps\n- Do NOT create duplicate TODOs (same title/task already exists)\n- Maximum 2 active TODOs allowed - finish existing ones before creating new\n## TODO Structure\n- **title**: A concise summary of the task\n- **description**: What needs to be done and what the user expects as the final result\n- **steps**: Detailed, sequential breakdown of each step to complete the task\n- **currentStep**: Which step you are currently on (see Progress Tracking below)\n## Progress Tracking (currentStep)\n- **0**: Haven't started yet (default)\n- **1**: Step 1 completed\n- **2**: Steps 1 and 2 completed  \n- **N**: Steps 1 through N are all completed\n- **When currentStep equals total steps length**: The TODO is automatically marked as FINISHED\n## Important Rules\n- If a TODO exists in the conversation, you MUST follow its steps\n- Unfinished TODOs will appear in user messages with <todo></todo> tags\n- Each TODO gets a unique ID (uuid) when created - use this for updates\n- You can update progress, mark as finished, or mark as failed using the update tool\n## Current Active TODOs\n${[...this.TODO.entries()].map((v) => `- UUID: ${v[0]} | Title: ${v[1].title} | Total Step ${v[1].steps.length} | Current Step ${v[1].currentStep}`).join('\n') || 'No active TODOs'}`

            const tool = new LocalTool<{ title: string, description: string, steps: string[], currentStep?: number }>(this.CREATE_TODO_TOOL_NAME, createToolDescription,
                ({ title, description, steps, currentStep }) => {

                    const hashUUID = crypto.createHash("md5").update(title).digest('hex')

                    if (this.TODO.has(hashUUID)) {
                        throw new Error(`This TODO already exists! Use the update tool to modify it.\nUUID: ${hashUUID}`)
                    }

                    if (this.TODO.size >= 2) {
                        throw new Error(`Maximum 2 active TODOs reached! Finish or fail existing TODOs first.\n\nCurrent TODOs:\n${[...this.TODO.entries()].map((v) => `- ${v[0]}: ${v[1].title} (Step ${v[1].currentStep}/${v[1].steps.length})`).join('\n')}`)
                    }

                    const cstep = currentStep !== undefined ? currentStep : 0
                    if (cstep < 0 || cstep > steps.length) {
                        throw new Error(`Invalid currentStep: ${cstep}. Must be between 0 and ${steps.length} (total steps)`)
                    }

                    const item: TODOItem = {
                        title: title,
                        uuid: hashUUID,
                        description: description,
                        steps: steps,
                        currentStep: cstep,
                        status: currentStep === steps.length ? 'complete' : 'pending'
                    }

                    this.TODO.set(hashUUID, item)

                    const status = cstep === steps.length ? ' and automatically marked as completed' : ''
                    return `TODO created successfully!\nUUID: ${hashUUID}\nTitle: ${title}\nSteps: ${steps.length}\nStarting step: ${cstep}${status}`
                },
                {
                    title: z.string().describe("A clear, concise title for the task"),
                    description: z.string().describe("Detailed description of what needs to be accomplished"),
                    steps: z.array(z.string()).describe("Ordered list of steps to complete the task"),
                    currentStep: z.number().min(0).optional().default(0).describe("Current progress: 0=not started, N=completed steps 1 through N. When equal to total steps, task is finished")
                }
            )

            return tool
        })

        const updateTODODynamicTool = new DynamicTool<{ uuid: string, currentStep: number }>(this.UPDATE_TODO_TOOL_NAME, () => {

            const description = `\nUpdate the progress of an existing TODO task.\n## How CurrentStep Works\n- **0**: Reset to not started\n- **1**: Mark step 1 as completed\n- **N**: Mark steps 1 through N as all completed\n- **When currentStep equals total steps**: Task is automatically marked as FINISHED and removed fromactive \nlist\n## Important Rules\n- Must complete ALL previous steps before updating to a new step\n- You can only move forward (or reset to 0) - cannot skip steps\n- Provide the correct UUID to update the right TODO\n## Current Active TODOs\n${[...this.TODO.entries()].map((v) => `- UUID: ${v[0]} | Title: ${v[1].title} | Total Step ${v[1].steps.length} | Current Step ${v[1].currentStep}`).join('\n') || 'No active TODOs'}`

            const updateTool = new LocalTool<{ uuid: string, currentStep: number }>(
                this.UPDATE_TODO_TOOL_NAME,
                description,
                ({ uuid, currentStep }) => {
                    const todo = this.TODO.get(uuid)
                    if (!todo) {
                        throw new Error(`TODO with UUID ${uuid} not found. It may have been completed or doesn't exist.`)
                    }

                    const maxSteps = todo.steps.length

                    if (currentStep < 0 || currentStep > maxSteps) {
                        throw new Error(`Invalid step: ${currentStep}. Must be between 0 and ${maxSteps} (total steps)`)
                    }

                    if (currentStep > todo.currentStep + 1 && currentStep !== maxSteps) {
                        throw new Error(`Cannot skip steps! Current step is ${todo.currentStep}. Complete step ${todo.currentStep + 1} first.`)
                    }

                    todo.currentStep = currentStep

                    if (currentStep === maxSteps) {
                        todo.status = 'complete'
                        this.TODO.delete(uuid)
                        return `TODO "${todo.title}" is now COMPLETED! All ${maxSteps} steps finished.`
                    }

                    this.TODO.set(uuid, todo)
                    return `Updated "${todo.title}" to step ${currentStep}`
                },
                {
                    uuid: z.string().describe("The unique ID of the TODO to update"),
                    currentStep: z.number().min(0).describe("New progress: 0-${maxSteps}. When equal to total steps, marks task as completed")
                }
            )

            return updateTool
        })

        return [createTODODynamicTool, updateTODODynamicTool]
    }
}
