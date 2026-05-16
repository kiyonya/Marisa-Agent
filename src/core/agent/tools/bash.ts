import LocalTool from "@core/tool/local-tool"
import { spawn } from 'child_process'
import z from "zod"

const description = `
Run Command-Line Instructions
The current user's platform is ${process.platform} with arch:${process.arch}. You can only execute commands on this platform.

Use this tool to run command-line tools on the current platform when you need to execute instructions, such as: tools requested by the user, installing dependencies, running package managers like npm or pip, loading and running code within a skill, obtaining system information, etc.

Importants:
- High-risk operations are prohibited: Strictly forbidden to execute commands that could damage the system, such as "rm -rf /", "mkfs", "iptables --flush", etc. For any operation involving deletion, formatting, or modifying core system configurations, you must obtain secondary confirmation from the user first.
- Interactive commands are prohibited: All commands must include non-interactive parameters (e.g., "apt install -y", "git clone --quiet"). Commands that wait for user input (e.g., parameterless "python", "node", "read", "passwd") are strictly prohibited.
- No retry loops: After a command fails, you may retry only once with targeted parameter modifications. After two consecutive failures, you must stop calling the tool and report the error reason to the user.
- When you need to use sudo: You must explain this to the user and may only execute it with the user's explicit consent.
- You must provide the command-line on user's platform.
- After the command runs, the exit code, stdout, and stderr will be returned. When the exit code is 0, the command executed successfully. When the exit code is not 0, you must explain the error reason to the user based on the stderr information, ask the user if a retry is needed, and provide possible solutions.
- If the command timesout, the tool will throw an error. Immediately terminate the operation and notify the user. Do not attempt to retry.`

const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\//,
    /mkfs/,
    /iptables\s+--flush/,
    /dd\s+if=/,
    />\s*\/dev\/sd/
];
const TIMEOUT = 60 * 1000

const Bash = new LocalTool<{ cmd: string, cwd?: string }>("Bash", description, async ({ cmd, cwd }, permissionAsker) => {

    if (!cmd || typeof cmd !== 'string') {
        throw new Error(`Not String Cmd`)
    }

    if(permissionAsker){
        const permission = await permissionAsker.askConfirm(`你希望运行终端命令 ${cmd} 吗`)
        if(!permission){
            throw new Error("User Rejected To Run This Command")
        }
    }

    if (DANGEROUS_PATTERNS.some(pattern => pattern.test(cmd))) {
        throw new Error(`Dangerous command detected and blocked: ${cmd}`);
    }

    const processAbortController = new AbortController()

    const run = new Promise<{ exitCode: number, stdout: string, stderr: string }>((resolve, _) => {
        const [command, ...args] = cmd.split(' ');
        const p = spawn(command as string, args, {
            cwd: cwd ?? process.cwd(),
        })
        let stdout: string = ""
        let stderr: string = ""
        const removeListeners = () => {
            p.removeAllListeners()
            p.stdin.removeAllListeners()
            p.stdout.removeAllListeners()
            p.stderr.removeAllListeners()
            processAbortController.signal.onabort = null
        }
        processAbortController.signal.onabort = () => {
            p.kill()
            removeListeners()
        }
        p.on('spawn', () => {
            p.stdout.on('data', (chunk: Buffer) => {
                stdout += chunk.toString()
            })
            p.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString()
            })
        })
        p.on('error', (error) => {
            removeListeners()
            resolve({
                exitCode: -1,
                stderr: error.message,
                stdout: stdout
            })
        })
        p.on('exit', (code) => {
            removeListeners()
            resolve({
                exitCode: code ?? -1,
                stderr: stderr,
                stdout: stdout
            })
        })
        p.on('close', (code) => {
            removeListeners()
            resolve({
                exitCode: code ?? -1,
                stderr: stderr,
                stdout: stdout
            })
        })
    })

    let tid: NodeJS.Timeout | null = null
    const timeout = new Promise<never>(() => {
        tid = setTimeout(() => {
            if(tid){
                clearTimeout(tid)
            }
            processAbortController.abort()
            throw new Error('Exec Timeout')
        }, TIMEOUT);
    })
    const result = await Promise.race([run, timeout]).finally(() => clearTimeout(tid!))
    return result
}, {
    cmd: z.string().describe("Command you want to execute"),
    cwd: z.string().optional().default(process.cwd()).describe("The work dir of the command,need absolute path")
})

export default Bash