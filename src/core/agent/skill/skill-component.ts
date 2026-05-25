
import AgentComponent from "../impl/agent-component"
import LocalTool from "@core/tool/local-tool"
import z from "zod"
import chalk from "chalk"
import { Marisa } from "@type/marisa"
import SkillDef from "./skill-def"
import SkillFile from "./skill-file"
import fse from 'fs-extra'
import path from "path"
import DynamicTool from "@core/tool/dynamic-tool"

/**
 * create an agent component that can load skill
 */
export default class SkillComponent extends AgentComponent<Marisa.Events.AgentComponent.SkillComponent> {

    public skillMap = new Map<string, SkillFile | SkillDef>()
    protected skillDir?: string
    protected readonly SKILL_TOOL_NAME = "Skill"

    constructor(skillDir?: string) {
        super()
        this.skillDir = skillDir
        this.installFunction = async (installer) => {

            const skillDir = this.skillDir || installer.getWorkspace("skills")
            const skills = await this.readSkillFileFromSkillDir(skillDir)

            for (const skill of skills) {
                const name = skill.skillName
                this.skillMap.set(name, skill)
            }

            const allSkill: ({ type: 'file', name: string, path: string } | { type: 'def', name: string })[] = []

            for (const skill of this.skillMap.values()) {
                if (skill.type === 'file') {
                    allSkill.push({
                        name: skill.skillName,
                        path: skill.skillMarkdownFullPath,
                        type: 'file'
                    })
                }
                else if (skill.type === 'def') {
                    allSkill.push({
                        name: skill.skillName,
                        type: 'def'
                    })
                }
            }

            this.emit('skillRegistered', allSkill)

            const loadSkillTool = new DynamicTool<{ skillName: string, params?: string[] }>(this.SKILL_TOOL_NAME, () => {

                const toolDescription: string = `Execute a skill within the main conversation.\nWhen users ask you to preform tasks,check if any of the available skills below can help you complete the task more efficiently. If so, use this tool to execute the skill and get the result.\nWhen users ask you to run a "slash command" or reference "/<something>" (e.g. "/weather"), they are referring to a skill\n\nExample:\nUser: "What's the weather like today? /weather"\nYou should recognize that the user is asking to execute the "weather" skill, so you can use the tool to run the skill and get the weather information.\n\nHow To Invoke:\n- You need provide the skill name and necessary parameters to invoke the skill.\n\nImportant:\n- when a skill is relevant,you must invoke this tool IMMEDIATELY as your first action.\n- never just announce or mention a skill in your text response without calling this tool.\n- This is a BLOCKING REQUIREMENT:invoke the relevant skill tool BEFORE generating any other response about the task.\n- Only use the skill that list in Available Skills below.\n- if you see a skill already in the current conversation turn, you should not call the skill again, instead, directly generate the response based on the result of the skill.\n\nAvailable skills:\n${[...this.skillMap.entries()].map(([name, skill]) => `- ${name}:${skill.frontmatter.description}`).join("\n")}\n\n`

                return new LocalTool<{ skillName: string, params?: string[] }>(this.SKILL_TOOL_NAME, toolDescription, ({ skillName, params }) => {
                    this.emit('skillLoad', skillName)
                    const skill = this.skillMap.get(skillName)
                    if (skill) {
                        const content = skill.load()
                        this.emit('skillLoadSuccess', skillName)
                        return content
                    }
                    else {
                        this.emit('skillLoadFail', skillName)
                        return "The skill does not exist or cannot be loaded"
                    }
                }, {
                    skillName: z.string().describe("Skill Name"),
                    params: z.array(z.string()).describe("Params if needed")
                })
            })

            installer.registerTool(loadSkillTool)
            installer.registerSlashCommand("skill", () => {
                console.log(chalk.yellow(`Available skills:\n${[...this.skillMap.entries()].map(([name, skill]) => `- ${name}:${skill.frontmatter.description}`).join("\n")}`))
            })
        }
    }

    public addSkill(skill: SkillFile | SkillDef): this {
        const name = skill.skillName
        this.skillMap.set(name, skill)
        return this
    }

    protected async readSkillFileFromSkillDir(skillDir: string) {
        if (!fse.existsSync(skillDir)) { return [] }

        const skillFileInstances: SkillFile[] = []
        const skillItemDirs: string[] = await fse.readdir(skillDir)

        for (const skillItemDir of skillItemDirs) {
            const fullSkillItemDir = path.join(skillDir, skillItemDir)
            const itemFileOrDir = await fse.readdir(fullSkillItemDir)

            for (const item of itemFileOrDir) {
                const fullItemPath = path.join(fullSkillItemDir, item)
                try {
                    const skillFileInstance = await SkillFile.createFromFile(fullItemPath)
                    skillFileInstances.push(skillFileInstance)
                } catch (error) {
                    continue
                }
            }
        }

        return skillFileInstances
    }
}