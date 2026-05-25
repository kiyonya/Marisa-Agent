
import fse from 'fs-extra'
import path from 'node:path'
import SkillFile from './skill-file'

/**
 * @deprecated
 */
export default class SkillReader {

    public readonly skillFileNames = ["skill.md", "skill.txt"]
    public skillDir: string

    constructor(skillDir: string) {
        this.skillDir = path.resolve(skillDir)
    }

    public async read(): Promise<SkillFile[]> {
        if (!fse.existsSync(this.skillDir)) { return [] }
        const skills: SkillFile[] = []
        const skillDirs: string[] = await fse.readdir(this.skillDir)
        for (const skillDirName of skillDirs) {
            const fullPath = path.join(this.skillDir, skillDirName)
            const items = await fse.readdir(fullPath)
            for (const item of items) {
                const fullItemPath = path.join(fullPath, item)
                try {
                    const skill = await SkillFile.createFromFile(fullItemPath)
                    skills.push(skill)
                } catch (error) {
                    continue
                }
            }
        }
        return skills
    }


}