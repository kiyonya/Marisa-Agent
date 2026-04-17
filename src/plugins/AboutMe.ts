import path from "node:path";
import AgentPluginBase from "../core/plugin/AgentPluginBase";
import fse from 'fs-extra'

interface UserProfile {
    name?: string,
    age?: number,
    gender?: string,
    hobbies?: string[],
    profession?: string,
    [key: string]: any
}

/**
 * @description 这是一个内置插件，用于提供用户的基本信息和介绍，可以帮助Agent在与用户的交互中提供更个性化的回复和建议。安装时会将用户的基本信息写入一个JSON文件中，并注册一个系统提示词，让Agent在与用户的对话中参考这些信息。
 * @description 请不要说一些奇奇怪怪的癖好啊喂！
 */
export class AboutMe extends AgentPluginBase {
    private aboutMe?: UserProfile
    constructor(me?: Partial<UserProfile>) {
        super('about_me_plugin')
        this.aboutMe = me
        this.installFunction = (installer) => {
            let me: UserProfile | null = null
            if (this.aboutMe) {
                me = this.aboutMe
                const profile = path.join(installer.getWorkspace('about_me'), 'profile.json')
                fse.writeFileSync(profile, JSON.stringify(me, null, 4), 'utf-8')
            }
            else {
                const profile = path.join(installer.getWorkspace('about_me'), 'profile.json')
                if (fse.existsSync(profile)) {
                    const profileBuff = fse.readFileSync(profile, 'utf-8')
                    me = JSON.parse(profileBuff)
                }
            }
            if (!me) { return }

            const prompt = `## 用户的基本信息和介绍如下\n${JSON.stringify(me)}\n这些信息可以帮助你在后续聊天中更加了解用户，当你需要的时候请使用为提供更个性化的回复和建议，请不要每次对话都束缚在用户的信息中！当你的记忆和用户的基本信息冲突时，以当前提供的基本信息为准！`

            installer.registerSystemPrompt(prompt)
        }
    }
}