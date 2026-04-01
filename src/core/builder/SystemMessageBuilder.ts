import { Marisa } from "../../types/marisa";

export default class SystemMessageBuilder {
    
    protected modelSkills:Marisa.Skill.ModelSkillMetadata[] = []
    protected modelRolePrompt:string = ''
    protected modelSystemPrompt:string = ''

    public installSkills(skills?:Marisa.Skill.ModelSkillMetadata[]){
        this.modelSkills = skills || []
    }

    public installRolePrompt(rolePrompt:string){
        this.modelRolePrompt = rolePrompt
    }

    public installBasicSystemPrompt(systemPrompt:string){
        this.modelSystemPrompt = systemPrompt
    }

    public build():string{
        return this.modelSystemPrompt + '\n\n' + this.modelRolePrompt
    }
}