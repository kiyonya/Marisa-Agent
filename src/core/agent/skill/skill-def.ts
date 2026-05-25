import XMLPromptTemplate from '@core/prompt/template/xml-prompt-template'
import { Marisa } from '@type/marisa'
import { Skill } from './skill'

export default class SkillDef<N extends string = string> extends Skill {

    public override type: 'def' = 'def'
    public override skillName: N
    public override frontmatter: Marisa.Skill.SkillFrontmatter
    public override cwd: string
    protected content: string

    constructor(skillName: N, frontmatter: Marisa.Skill.SkillFrontmatter<N>, content: string, cwd?: string) {
        super()
        this.skillName = skillName
        this.frontmatter = frontmatter
        this.cwd = cwd || process.cwd()
        this.content = content
    }

    public override async load(): Promise<string> {
        const template = new XMLPromptTemplate({
            skill_name: this.skillName,
            skill_dir: this.cwd,
            about_skill_dir: `当前skill的目录为 ${this.cwd},skill内出现的相对路径以当前目录为基准`,
            content: this.content
        })
        return template.toString()
    }
}