import { Marisa } from '@type/marisa'

export abstract class Skill {
    public abstract skillName: string
    public abstract frontmatter: Marisa.Skill.SkillFrontmatter
    public abstract cwd: string
    public abstract type: 'file' | 'def'
    public abstract load(): Promise<string>
}

