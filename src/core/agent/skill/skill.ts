import XMLPromptTemplate from '@core/prompt/template/xml-prompt-template'
import { Marisa } from '@type/marisa'
import fse from 'fs-extra'
import path from 'node:path'

export default class Skill{
    public skillMarkdownFullPath:string
    public frontmatter:Marisa.Skill.SkillFrontmatter
    public skillName:string
    public skillDir:string
    constructor(skillName:string,skillMarkdownFullPath:string,frontmatter:Marisa.Skill.SkillFrontmatter,skillDir:string){
        this.skillMarkdownFullPath = skillMarkdownFullPath
        this.frontmatter = frontmatter
        this.skillName = skillName
        this.skillDir = skillDir
    }

    public async load():Promise<string>{
        const skillString = (await fse.readFile(this.skillMarkdownFullPath,'utf-8')).split('---').pop()?.trim()
        if(skillString){
            const template = new XMLPromptTemplate({
                skill_name:this.skillName,
                skill_dir:this.skillDir,
                about_skill_dir:`当前skill的目录为 ${this.skillDir},skill内出现的相对路径以当前目录为基准`,
                content:skillString
            })
            return template.toString()
        }
        else return "The skill does not exist or cannot be loaded"
    }
}
