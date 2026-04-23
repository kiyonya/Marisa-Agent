import ToolGroup from "../core/tool/tool-group"
import { promisify } from "node:util";
import child_process from 'child_process'
import z from "zod";
import open from 'open'

const execPromise = promisify(child_process.exec)
const BashToolkit = new ToolGroup({
    name: "bash",
    version: "0.0.1"
})

BashToolkit.tool<{}, { cwd: string }>('getcwd', "获取当前工作目录", () => {
    return { cwd: process.cwd() }
}, {})

BashToolkit.tool<{ cmd: string, cwd?: string, shell?: boolean }>(
    "exec_cmd",
    "在终端执行CMD命令行，实时显示执行过程,如果你需要确定执行位置，请传入cwd 默认cwd是当前工作目录",
    async (options) => {

        return new Promise((resolve, reject) => {
            const subprocess: child_process.ChildProcess = child_process.spawn(options.cmd, {
                cwd: options.cwd || process.cwd(),
                shell: options.shell || false,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            subprocess?.stdout?.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                console.log(output);
            });

            subprocess?.stderr?.on('data', (data) => {
                const error = data.toString();
                stderr += error;
                console.error(error);
            });

            subprocess.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`命令执行失败，退出码: ${code}\n${stderr}`));
                }
            });

            subprocess.on('error', (err) => {
                reject(new Error(`执行失败: ${err.message}`));
            });
        });
    },
    {
        cmd: z.string().describe("要执行的终端指令"),
        cwd: z.string().optional().describe("要运行指令的地方"),
        shell: z.boolean().optional().describe("是否启用shell执行")
    }
);

BashToolkit.tool<{ args?: string[], cwd?: string }>('spawn_term', '生成一个独立的终端窗口，允许用户进行下一步的交互操作，你可以通过args的方式执行命令', (options) => {
    return new Promise<boolean>((resolve) => {
        const childProcess = child_process.spawn('cmd.exe', ['/k', ...options.args || []], {
            shell: true,
            windowsHide: false,
            cwd: options.cwd || process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: true
        })
        childProcess.on('spawn', () => {
            resolve(true)
        })
        childProcess.on('error', () => {
            resolve(false)
        })
    })
}, {
    args: z.array(z.string()).optional().describe("要在新终端执行的命令 例如['dir','&&','echo hello']"),
    cwd: z.string().optional().describe("要运行指令的地方")
})

BashToolkit.tool<{ fileOrUrl: string }>('open_file_or_url', '使用用户默认的方式打开文件或者链接，当你需要打开某些文件或者访问网站时，使用这个工具，打开文件需要提供绝对路径', async ({ fileOrUrl }) => {
    await open(fileOrUrl)
    return true
}, { fileOrUrl: z.string() })

export default BashToolkit