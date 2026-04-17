import path from "node:path";
import AgentPluginBase from "../core/plugin/AgentPluginBase";
import fse from 'fs-extra'
import { z } from 'zod'
import LocalTool from "../core/tool/LocalTool";

type EmojiGroup = string
interface EmojiItem {
    name: string,
    file: string,
    description: string,
    tags?: string[]
}
interface EmojiIndex {
    name: string,
    description: string,
    emojis: EmojiItem[]
}
interface EmojiSendData {
    name: string,
    groupName: string,
    file: string
}

/**
 * @description 这是一个表情包插件，允许Agent根据聊天语境发送表情包。安装时会扫描指定目录下的表情包分组，每个分组包含一个index.json文件，描述该分组的表情包信息。插件会注册一个工具send_emoji，Agent可以调用这个工具来发送表情包。当调用send_emoji工具时，插件会检查表情包是否存在，并通过onSend回调将表情包数据发送出去。安装时，插件还会注册一个系统提示词，向Agent介绍可用的表情包分组和每个表情包的描述信息，帮助Agent选择合适的表情包发送。请确保提供的表情包目录结构正确，并且index.json文件符合规范，以便插件正常工作。
 */
export default class AgentEmojisPlugin extends AgentPluginBase {

    private emojisDir: string | null = null

    private static readonly emojiItemSchema = z.object({
        name: z.string(),
        file: z.string(),
        description: z.string(),
        tags: z.array(z.string()).optional()
    })
    private static readonly emojiIndexSchema = z.object({
        name: z.string(),
        description: z.string(),
        emojis: z.array(AgentEmojisPlugin.emojiItemSchema)
    })

    private onSend?: (data: EmojiSendData) => void

    constructor(emojisDir?: string, onSend?: (data: EmojiSendData) => void) {
        super('agent_emojis')
        if (emojisDir) {
            this.emojisDir = emojisDir
        }
        this.onSend = onSend

        this.installFunction = async (installer) => {

            const emojisDir = this.emojisDir || installer.getWorkspace('emojis')
            if (!fse.existsSync(emojisDir)) {
                return
            }
            const emojis = new Map<EmojiGroup, EmojiIndex>()
            const dirs = await fse.readdir(emojisDir)
            for (const dir of dirs) {
                const fpath = path.join(emojisDir, dir)
                const indexFile = path.join(fpath, 'index.json')
                if (!fse.existsSync(indexFile)) {
                    continue
                }
                const indexBuff = await fse.readFile(indexFile, 'utf-8')
                const index: EmojiIndex | undefined = AgentEmojisPlugin.emojiIndexSchema.safeParse(JSON.parse(indexBuff)).data
                if (!index) { continue }
                const name = index.name
                emojis.set(name, index)
            }

            if(!emojis.size){
                return
            }

            let emjoySystemPrompt = `## 你可以根据聊天语境发送表情包\n你可以使用工具 send_emoji 来发送表情包，调用这个工具时，你需要提供表情包的groupName:表情包分组名称，name:表情包名称每个表情包组有对应的描述，每个表情包也有对应的描述和标签，这些信息可以帮助你选择合适的表情包发送\n### 你可以发送的表情包如下：\n`

            for (const [groupName, index] of emojis.entries()) {
                emjoySystemPrompt += `**表情包分组: ${groupName}**\n`
                emjoySystemPrompt += `${index.description}\n`
                for (const emoji of index.emojis) {
                    emjoySystemPrompt += `- 表情包名称: ${emoji.name}\n`
                    emjoySystemPrompt += `  描述: ${emoji.description}\n`
                    if (emoji.tags) {
                        emjoySystemPrompt += `  标签: ${emoji.tags.join(',')}\n`
                    }
                }
            }

            const sendEmojiTool = new LocalTool<{ groupName: string, name: string }>('send_emoji', '发送表情包', ({ groupName, name }) => {
                const index = emojis.get(groupName)
                if (!index) {
                    return `表情包分组 ${groupName} 不存在`
                }
                const emoji = index.emojis.find(e => e.name === name)
                if (!emoji) {
                    return `表情包 ${name} 在分组 ${groupName} 中不存在`
                }
                const filePath = path.resolve(path.join(emojisDir, groupName, emoji.file))
                if (fse.existsSync(filePath)) {
                    const data = {
                        name: emoji.name,
                        groupName: groupName,
                        file: filePath
                    }
                    if (this.onSend) {
                        this.onSend(data)
                    }
                }
                return "表情包已发送，请继续对话，不要重复发送表情"
            },
                {
                    groupName: z.string().describe('表情包分组名称'),
                    name: z.string().describe('表情包名称')
                }
            )

            installer.registerConstantTool(sendEmojiTool)
            installer.registerSystemPrompt(emjoySystemPrompt)
        }
    }
}