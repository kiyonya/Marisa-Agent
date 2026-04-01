import { ModelPluginRegister, ModelRegisterMiddleware } from "../plugin/ModelPluginRegister";
import Toolkit from "../tool/Toolkit";
import { promisify } from "node:util";
import child_process from 'child_process'
import z from "zod";

export default class BashPlugin extends ModelPluginRegister {

    private static readonly execPromise = promisify(child_process.exec)

    public override async Install(modelRegisterMiddleware: ModelRegisterMiddleware): Promise<void> {

        const bashToolkit = new Toolkit({
            name: "bash",
            version: "0.0.1"
        })

        bashToolkit.tool<{}, { cwd: string }>('getcwd', "获取当前工作目录", () => {
            return { cwd: process.cwd() }
        }, {})

        bashToolkit.tool<{ cmd: string, cwd?: string }>(
            "exec_cmd",
            "在终端执行CMD命令行",
            async (options) => {
                const { stdout, stderr } = await BashPlugin.execPromise(options.cmd, {
                    cwd: options.cwd
                })
                return stdout
            },
            {
                cmd: z.string().describe("要执行的终端指令"),
                cwd: z.string().optional().describe("要运行指令的地方")
            })

        modelRegisterMiddleware.registerToolkits(bashToolkit)
    }
}