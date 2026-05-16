import { Marisa } from '@type/marisa'
import { YAML } from 'bun'
import fse from 'fs-extra'
import path from 'node:path'
import Skill from './skill'


export default class SkillReader {

    public readonly skillFileNames = ["skill.md", "skill.txt"]
    public skillDir: string

    constructor(skillDir: string) {
        this.skillDir = path.resolve(skillDir)
    }

    public async read():Promise<Skill[]> {
        if (!fse.existsSync(this.skillDir)) { return [] }

        const skills:Skill[] = []

        const skillDirs: string[] = await fse.readdir(this.skillDir)
        for (const skillDirName of skillDirs) {
            const fullPath = path.join(this.skillDir, skillDirName)
            const items = await fse.readdir(fullPath)
            for (const item of items) {
                const fullItemPath = path.join(fullPath, item)
                const stat = await fse.stat(fullItemPath)
                if (this.skillFileNames.includes(path.basename(fullItemPath).toLowerCase()) && stat.isFile()) {
                    const skillEntryFile = fullItemPath
                    const fmt = await this.readSkillFrontmatter(skillDirName, skillEntryFile)
                    if(fmt){
                        const name = fmt.name
                        const skill = new Skill(name,skillEntryFile,fmt,fullPath)
                        skills.push(skill)
                    }
                }
            }
        }

        return skills
    }

    public async readSkillFrontmatter(skillDirName: string, skillEntryFile: string):Promise<Marisa.Skill.SkillFrontmatter | null> {
        const frontmatter: Marisa.Skill.SkillFrontmatter = {
            name: skillDirName,
            description: ""
        }
        const skillMdString = await fse.readFile(skillEntryFile, 'utf-8');
        const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
        const match = skillMdString.match(frontmatterRegex);
        if (match && match[1]) {
            const frontmatterStr = match[1];
            const yaml = YAML.parse(frontmatterStr) as Record<string, string>;
            if (yaml['name']) {
                frontmatter.name = yaml.name as string;
            }
            if (yaml['description']) {
                frontmatter.description = yaml.description as string;
            }
            if (yaml['license']) {
                frontmatter.license = yaml.license as string
            }
        }
        if(!frontmatter.name || !frontmatter.description){
            console.warn(`无效的skill ${skillEntryFile}`)
            return null
        }
        return frontmatter
    }

}