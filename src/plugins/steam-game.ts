import AgentPluginBase from "@core/plugin/agent-plugin-base";
import path from "node:path";
import fs from 'fs'
import LocalTool from "@core/tool/local-tool";
import z from "zod";
import open from 'open'
import chalk from "chalk";

interface SteamAPP {
    appid: string,
    name: string
}

export default class SteamGamePlugin extends AgentPluginBase {

    constructor(steamAppsPath: string) {
        super('steam-game')
        if (!fs.existsSync(steamAppsPath)) {
            throw new Error(`${steamAppsPath} Not Exists?`)
        }

        this.installFunction = async (installer) => {
            const apps = await this.getApps(steamAppsPath)
            if (!apps.length) { return }

            const appMap = new Map<string, string>()
            for (const app of apps) {
                appMap.set(app.appid, app.name)
            }

            console.log(chalk.blue(`找到 ${appMap.size} 个Steam游戏并注册`))

            const description = `Launch Steam Game\nif user want to play game,you can use this tool to launch game on Steam platform.Important:if there are some relavant message of the game,ignore it,you must ask user first about which game he wants to play!\nyou can only launch games in the Available Games below\n\nImportant:\n- you need provide appid of the game\n- you can only launch one game each time\n- the appid must in the Available Games Below\n\nAvailable Games\n${apps.map(i => `- appid:${i.appid} name:${i.name}`).join('\n')}`

            const tool = new LocalTool<{ appid: string }>('LaunchSteamGame', description, async ({ appid }, permissionAsker) => {

                if (!appMap.has(appid)) {
                    throw new Error(`the appid ${appid} not exists`)
                }
                const appName = appMap.get(appid) as string
                if (permissionAsker) {
                    const permission = await permissionAsker.askConfirm(`你希望现在启动游戏 ${appName} 吗`)
                    if (!permission) {
                        throw new Error('User Rejected To Launch Game')
                    }
                }
                try {
                    open(`steam://run/${appid}`)
                } catch (error) {

                }
                return "Launched"
            }, {
                appid: z.enum([...appMap.keys()])
            })

            installer.registerTool(tool)
            installer.registerSystemPrompt()
        }
    }

    public async getApps(appPath: string): Promise<SteamAPP[]> {
        const items = await fs.promises.readdir(appPath)
        const acfs: string[] = []
        for (const item of items) {
            const fullPath = path.join(appPath, item)
            const stat = await fs.promises.stat(fullPath)
            if (stat.isFile() && item.startsWith('appmanifest') && path.extname(item) === '.acf') {
                acfs.push(fullPath)
            }
        }
        const results = (await Promise.allSettled(acfs.map(this.readACFFile))).filter(i => i.status === 'fulfilled').map(i => i.value)
        return results
    }

    public async readACFFile(acffile: string) {
        const acfString = await fs.promises.readFile(acffile, 'utf-8')
        const appid = acfString.match(/"appid"\s+"([^"]+)"/)?.[1];
        const name = acfString.match(/"name"\s+"([^"]+)"/)?.[1];
        if (!appid || !name) { throw new Error(`Cannot parse ${acffile}`) }
        return { appid, name }
    }
}