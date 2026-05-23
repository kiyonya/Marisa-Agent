
import Skill from "./skill"
import SkillReader from "./skill-reader"
import AgentComponent from "../impl/agent-component"
import LocalTool from "@core/tool/local-tool"
import z from "zod"
import chalk from "chalk"

/**
 * create an agent component that can load skill
 */
export default class SkillComponent extends AgentComponent {

    public skillMap = new Map<string, Skill>()
    protected skillDir?: string
    /**
     * @param skillDir the folder of skills,default is the **${workspace}/skills**
     */
    constructor(skillDir?: string) {
        super()
        this.skillDir = skillDir
        this.installFunction = async (installer) => {
            const skillDir = this.skillDir || installer.getWorkspace("skills")
            const reader = new SkillReader(skillDir)
            const skills = await reader.read()
            for (const skill of skills) {
                const name = skill.skillName
                this.skillMap.set(name, skill)
            }

            const toolDescription: string = `Execute a skill within the main conversation.\nWhen users ask you to preform tasks,check if any of the available skills below can help you complete the task more efficiently. If so, use this tool to execute the skill and get the result.\nWhen users ask you to run a "slash command" or reference "/<something>" (e.g. "/weather"), they are referring to a skill\n\nExample:\nUser: "What's the weather like today? /weather"\nYou should recognize that the user is asking to execute the "weather" skill, so you can use the tool to run the skill and get the weather information.\n\nHow To Invoke:\n- You need provide the skill name and necessary parameters to invoke the skill.\n\nImportant:\n- when a skill is relevant,you must invoke this tool IMMEDIATELY as your first action.\n- never just announce or mention a skill in your text response without calling this tool.\n- This is a BLOCKING REQUIREMENT:invoke the relevant skill tool BEFORE generating any other response about the task.\n- Only use the skill that list in Available Skills below.\n- if you see a skill already in the current conversation turn, you should not call the skill again, instead, directly generate the response based on the result of the skill.\n\nAvailable skills:\n${[...this.skillMap.entries()].map(([name, skill]) => `- ${name}:${skill.frontmatter.description}`).join("\n")}\n\n`

            const loadSkillTool = new LocalTool<{ skillName: string, params?: string[] }>("skill", toolDescription, ({ skillName, params }) => {
                console.log(chalk.yellow(`Load Skill ${skillName}`))
                const skill = this.skillMap.get(skillName)
                if (skill) {
                    return skill.load()
                }
                else {
                    return "The skill does not exist or cannot be loaded"
                }
            }, {
                skillName: z.string().describe("Skill Name"),
                params: z.array(z.string()).describe("Params if needed")
            })

            installer.registerTool(loadSkillTool)
            installer.registerSlashCommand("skill", () => {
                console.log(chalk.yellow(`Available skills:\n${[...this.skillMap.entries()].map(([name, skill]) => `- ${name}:${skill.frontmatter.description}`).join("\n")}`))
            })
        }
    }
}