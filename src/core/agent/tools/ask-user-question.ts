//this tool only can be used in cli
import LocalTool from "@core/tool/local-tool";
import inquirer from "inquirer";
import z from "zod";
function isCLI() {
    if (typeof process !== 'undefined' && process.stdin && process.stdout) {
        const hasTTY = process.stdin.isTTY || process.stdout.isTTY;
        return hasTTY;
    }
    return false;
}
if (!isCLI()) {
    throw new Error("Tool Ask User Question can only running in cli,if you are in other env,you can override it")
}

const description = `
Ask User Question
Ask the user questions to have them supplement technical details.

When to Use
- Before starting a task, carefully check if there are any unclear aspects. **Strictly prohibited from guessing** — call this tool to ask the user before proceeding with the task.
- When you are in the middle of a task and some details are missing or ambiguous, **do not guess** — immediately use this tool to ask the user for clarification, then strictly follow the user's response.
- During a conversation, you can use this tool to learn user preferences, tendencies, and enhance interactivity.

How to Use
- You need to provide an array of questions, where each item is a key-value pair object containing three required properties: type, name, and message.
- Available type options: input and list
  - input: Allows the user to enter text
  - list: Allows the user to select from options. When you choose **list**, you must additionally include a choices property, which is an array of string values representing the options.
- The result will be returned as a key-value pair object, where the key is the question **name** and the value is the user's answer.
- You **must not** ask the user the same question multiple times in a single call.
- After the user answers your questions, you must continue the task according to their responses.

Usage Examples
- Example 1: Let the user input content
[{
    "type": "input",
    "name": "username",
    "message": "Please enter your username"
}]
- Example 2: Let the user select an option
[{
    "type": "list",
    "name": "favoriteFood",
    "message": "Which of the following foods do you like best?",
    "choices": ["Apple", "Banana", "Strawberry"]
}]
- Example 3:Multi Questions
[
  {
    "type": "list",
    "name": "runtime_env",
    "message": "你的 AI 助手运行在什么环境？",
    "choices": ["浏览器端 (Web SDK/API)", "Node.js 后端服务", "移动端原生环境 (iOS/Android)", "其他"]
  },
  {
    "type": "list",
    "name": "security_level",
    "message": "这些 Cookie 主要涉及哪类敏感数据？",
    "choices": ["仅 SessionID/基础追踪", "包含 Token/鉴权核心信息", "纯业务状态 (如用户偏好)"]
  },
  {
    "type": "input",
    "name": "domain_context",
    "message": "请简述你的同域场景（例如：前端与 API 同子域，还是 AI 中转服务与业务后端同域）"
  }
]
- Example 4 : Return value example
{
    "username": "Tomori Takamatsu",
    "favoriteFood": "Strawberry"
}
`

interface Question<Type = 'input' | 'list'> {
    name: string,
    type: Type,
    message: string,
    choices: Type extends 'input' ? undefined : string[]
}

const AskUserQuestion = new LocalTool<{ questions: Question[] }>("AskUserQuestion", description, async ({ questions }) => {

    for (const question of questions) {
        if (!question.name || !question.message) {
            throw new Error('some question miss name or message')
        }
        if (!['list', 'input'].includes(question.type)) {
            throw new Error(`question "${question.name}" has invalid type "${question.type}"`)
        }
        if (question.type === 'list' && (!question.choices || !question.choices.length)) {
            throw new Error(`question "${question.name}" is a list question but no choice was given`)
        }
    }

    const names = questions.map(q => q.name);
    if (new Set(names).size !== names.length) {
        throw new Error('Duplicate question names detected. Each question name must be unique.');
    }

    const results: Record<string, string> = await inquirer.prompt(questions)
    if (process.stdin.isPaused()) {
        process.stdin.resume();
    }
    return results
}, {
    questions: z.array(z.object({
        name: z.string(),
        message: z.string(),
        type: z.enum(['list', 'input']),
        choices: z.array(z.string()).optional()
    }))
})

export default AskUserQuestion