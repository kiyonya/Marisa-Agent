import z from "zod"
import { Marisa } from "../../types/marisa"
import LocalTool from "../tool/local_tool"
import AgentSkillReader from "./reader"
import fse from 'fs-extra'

export default class AgentSkills {

    private skillDir: string
    private readonly registedSkills = new Map<string, Marisa.Skill.ModelSkillMetadata>()
    private isInit: boolean = false

    constructor(skillDir: string) {
        this.skillDir = skillDir
    }

    public async registerSkills(): Promise<[Map<string, Marisa.Skill.ModelSkillMetadata>,LocalTool<{skillName:string}>]> {
        const skillReader = new AgentSkillReader(this.skillDir)
        const skills: Marisa.Skill.ModelSkillMetadata[] = await skillReader.read()
        for (const skill of skills) {
            this.registedSkills.set(skill.name, skill)
        }
        this.isInit = true
         const loadSkillTool = new LocalTool<{ skillName: string }>('load_skill', '', async ({ skillName }) => {
            return this.loadSkill(skillName)
        }, {
            skillName: z.string()
        })
        return [this.registedSkills,loadSkillTool]
    }

    public async loadSkill(skillName: string) {
        if (!skillName) { return '未提供skill名称' }
        const skill = this.registedSkills.get(skillName)
        if (!skill) {
            throw new Error('找不到skill')
        }
        const skillPath = skill.path
        const skillText = await fse.readFile(skillPath, 'utf-8')
        return skillText
    }

}