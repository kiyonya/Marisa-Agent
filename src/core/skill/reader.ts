import { Marisa } from "../../types/marisa"
import path from "node:path"
import fse from 'fs-extra'
import { YAML } from "bun"

export default class AgentSkillReader {

    private skillDir: string
    constructor(skillDir: string) {
        this.skillDir = skillDir
    }

    public async read(): Promise<Marisa.Skill.ModelSkillMetadata[]> {
        if (!fse.existsSync(this.skillDir)) { return [] }
        const skillDirs: string[] = fse.readdirSync(this.skillDir).map(i => path.join(this.skillDir, i))
        let skills: Marisa.Skill.ModelSkillMetadata[] = []
        for (const skillDir of skillDirs) {
            const files = fse.readdirSync(skillDir);
            const skillMdFile = files.find(file =>
                file.toLowerCase() === 'skill.md'
            );

            if (!skillMdFile) {
                continue;
            }
            const skillMd = path.join(skillDir, skillMdFile);
            let skillName = path.basename(skillDir);

            let skillEntry: Marisa.Skill.ModelSkillMetadata = {
                name: skillName,
                description: '',
                path: path.resolve(skillMd)
            };
            const skillMdString = await fse.readFile(skillMd, 'utf-8');
            const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
            const match = skillMdString.match(frontmatterRegex);
            if (match && match[1]) {
                const frontmatterStr = match[1];
                const yaml = YAML.parse(frontmatterStr) as Record<string, string>;
                if (yaml['name']) {
                    skillEntry.name = yaml.name as string;
                }
                if (yaml['description']) {
                    skillEntry.description = yaml.description as string;
                }
            }
            skills.push(skillEntry);
        }
        return skills;
    }
}