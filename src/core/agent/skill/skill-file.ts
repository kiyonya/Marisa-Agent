import XMLPromptTemplate from '@core/prompt/template/xml-prompt-template'
import { Marisa } from '@type/marisa'
import fse from 'fs-extra'
import { Skill } from './skill'
import { YAML } from 'bun'
import path from 'node:path'

export default class SkillFile extends Skill {

    public override type: 'file' = 'file'
    public override skillName: string
    public override frontmatter: Marisa.Skill.SkillFrontmatter
    public override cwd: string
    public skillMarkdownFullPath: string

    constructor(skillName: string, skillMarkdownFullPath: string, frontmatter: Marisa.Skill.SkillFrontmatter, skillDir: string) {
        super()
        this.skillMarkdownFullPath = skillMarkdownFullPath
        this.frontmatter = frontmatter
        this.skillName = skillName
        this.cwd = skillDir
    }

    public override async load(): Promise<string> {
        const skillString = (await fse.readFile(this.skillMarkdownFullPath, 'utf-8')).split('---').pop()?.trim()
        if (skillString) {
            const template = new XMLPromptTemplate({
                skill_name: this.skillName,
                skill_dir: this.cwd,
                about_skill_dir: `当前skill的目录为 ${this.cwd},skill内出现的相对路径以当前目录为基准`,
                content: skillString
            })
            return template.toString()
        }
        else return "The skill does not exist or cannot be loaded"
    }

    public static async createFromFile(skillFile: string): Promise<SkillFile> {
        const isSkill = this.isPathSkillFile(skillFile)
        if(!isSkill){
            throw new Error()
        }
        const dir = path.dirname(skillFile)
        const skillName = path.basename(dir)
        const frontmatter = await this.readFrontmatter(skillName, skillFile)
        if (!frontmatter) {
            throw new Error(`No Font`)
        }
        const skill = new SkillFile(skillName, skillFile, frontmatter, dir)
        return skill
    }

    protected static async readFrontmatter(skillName: string, skillEntryFile: string): Promise<Marisa.Skill.SkillFrontmatter | null> {
        const frontmatter: Marisa.Skill.SkillFrontmatter = {
            name: skillName,
            description: ""
        }
        const skillMdString = await fse.readFile(skillEntryFile, 'utf-8');
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
        const match = skillMdString.match(frontmatterRegex);
        if (match && match[1]) {
            const frontmatterStr = match[1];
            const yaml = YAML.parse(frontmatterStr) as Record<string, string>;
            if (yaml['name']) {
                const yamlName = yaml.name as string
                if (frontmatter.name !== yamlName) {
                    frontmatter.name = yamlName
                    console.warn('Skill Name must same with skilldir name')
                }
            }
            if (yaml['description']) {
                frontmatter.description = yaml.description as string;
            }
            if (yaml['license']) {
                frontmatter.license = yaml.license as string
            }
        }
        if (!frontmatter.name || !frontmatter.description) {
            console.warn(`无效的skill ${skillEntryFile}`)
            return null
        }
        return frontmatter
    }
    protected static isPathSkillFile(filepath: string): boolean {
        if (!fse.existsSync(filepath)) { return false }
        if (!fse.statSync(filepath).isFile()) { return false }
        if (!["skill.md", "skill.txt"].some(i => i === path.basename(filepath).toLowerCase())) {
            return false
        }
        return true
    }
}
