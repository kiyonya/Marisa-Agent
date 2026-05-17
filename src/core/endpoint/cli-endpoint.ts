import ChatModel from "@core/model/chat/chat-model";
import ModelEndPoint from "./model-endpoint";
import inquirer from "inquirer";
import chalk from "chalk";
import { Marisa } from "@type/marisa";
import CommandProcessor from "@core/model/command/command-processor";
import FormatPrint from "@core/use/format_print";

export interface CliRenderLine {
    type: 'line' | 'tpline',
    buffer: string | Uint8Array<ArrayBufferLike>
}

export default class CliEndPoint extends ModelEndPoint {

    private isRunning: boolean = false
    public renderLines: CliRenderLine[] = []

    constructor(model: ChatModel) {
        super(model)
        this.bindModelEvents(model)
    }

    public override start() {
        this.isRunning = true
        this.setup()
    }

    private async setup() {
        while (this.isRunning) {
            try {
                const { userInput } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'userInput',
                        message: chalk.cyan('你:'),
                        prefix: '',
                        validate: (input: string) => {
                            if (input.trim() === '') {
                                return '请输入内容或输入 /exit 退出';
                            }
                            return true;
                        }
                    }
                ]);
                const input = userInput.trim();
                if (input === '/exit') {
                    this.isRunning = false;
                    break;
                }
                let isSlashCommand = CommandProcessor.IsSlashCommand(input)
                try {

                    let thinkingAnim: null | { stop: (timems?: number) => void } = null
                    let timer: null | { stopAndGetTime: () => number } = null

                    if (!isSlashCommand) {
                        thinkingAnim = this.createThinkingAnimation()
                        timer = this.createSecondCounter()
                    }

                    let reasoningPayload: string | null = null
                    const response = await this.chatModel.invokeStream(input,
                        (delta, payload, _r, rpayload) => {
                            if (thinkingAnim) {
                                const seconds = timer?.stopAndGetTime() || 0
                                thinkingAnim.stop(seconds)
                                thinkingAnim = null
                            }
                            if (rpayload) {
                                reasoningPayload = rpayload
                            }
                            delta = delta.replaceAll("\n\n", "\n")
                            process.stdout.write(`${chalk.cyan.bold(delta)}`)
                        }, () => {
                            if (reasoningPayload) {
                                reasoningPayload = reasoningPayload.replaceAll("\n\n", "\n")
                                this.printSingleLine(chalk.gray.italic(`\n"${reasoningPayload}"`))
                                reasoningPayload = null
                            }
                        }
                    );

                    this.privateBreak()
                    reasoningPayload = null

                    if (thinkingAnim) {
                        thinkingAnim.stop()
                        thinkingAnim = null
                    }

                    if (response !== 'cmd') {
                        this.printSingleLine(chalk.blue.white(this.createUsageText(response.usage)))
                    }
                } catch (error) {
                    //gen error
                }
            } catch (error) {
                if (error instanceof Error && error.name === 'ExitPromptError') {
                    this.isRunning = false;
                    break;
                }
            }
        }
        process.exit(0)
    }

    private bindModelEvents(model: ChatModel) {
        const modelContextManager = model.contextManager
        if (modelContextManager) {
            modelContextManager.on('summarizeStart', () => {
                this.printSingleLine(chalk.bgGray.white(`正在进行记忆总结，你可以继续聊天不受影响`))
            })
            modelContextManager.on('summarizeSuccess', (session, uk, um) => {
                this.printSingleLine(chalk.gray(`我们进行了一场记忆总结 | + ${uk}知识 | + ${um}记忆 | Usage: ${this.createUsageText(session.usage)}`))
            })
            modelContextManager.on('summarizeFail', (error) => {
                this.printSingleLine(chalk.gray(`总结失败 | ${error}`))
                throw error
            })
        }
        model.on('toolCallResult', (callName, callArguments) => {
            const toPythonLikeFunction: string[] = []
            for (const [an, av] of Object.entries(callArguments)) {
                toPythonLikeFunction.push(`${an}=${JSON.stringify(av)}`)
            }
            let cvs = chalk.bold.greenBright(`成功调用:${callName}(${toPythonLikeFunction.join(',')})`)
            this.printSingleLine(cvs)
        })
    }

    private createThinkingAnimation() {
        const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let frameIndex = 0;
        const interval = setInterval(() => {
            process.stdout.write(`\r${chalk.gray(`${spinnerFrames[frameIndex]} Cooking...`)}`);
            frameIndex = (frameIndex + 1) % spinnerFrames.length;
        }, 80);
        return {
            stop: (useTimeS?: number) => {
                clearInterval(interval);
                process.stdout.write(`\r ${chalk.gray(`思考用时${useTimeS}秒`)}\n\n`);
            }
        };
    }

    private createSecondCounter() {
        let seconds: number = 0
        const timer = setInterval(() => {
            seconds++
        }, 1000);
        return {
            stopAndGetTime: () => {
                clearInterval(timer)
                return seconds
            }
        }
    }

    private printSingleLine(text: string) {
        process.stdout.write(`\n${text}\n\r`)
    }

    private privateBreak() {
        process.stdout.write("\n")
    }

    private createUsageText(usage: Marisa.Chat.Completion.CompletionUsage) {
        const item: string[] = []
        if (usage.total_tokens) {
            item.push(chalk.bgBlue.white(`Total ${usage.total_tokens} Tokens`))
        }
        if (usage.prompt_tokens) {
            item.push(chalk.bgYellow.white(`Prompt ${usage.prompt_tokens}`))
        }
        if (usage.completion_tokens) {
            item.push(chalk.bgGreen.white(`Comp ${usage.completion_tokens}`))
        }
        if (usage.prompt_tokens_details?.cached_tokens) {
            item.push(chalk.bgCyan.white(`PCache ${usage.prompt_tokens_details.cached_tokens}`))
        }
        if (usage.completion_tokens_details?.reasoning_tokens) {
            item.push(chalk.bgRed(`Reasoning ${usage.completion_tokens_details.reasoning_tokens} `))
        }
        return item.map(i => ` ${i} `).join("")
    }

    private clearLine(lines: number) {
        if (!lines) { return }
        const MOVE_LEFT = Buffer.from('1b5b3130303044', 'hex').toString();
        const MOVE_UP = Buffer.from('1b5b3141', 'hex').toString();
        const CLEAR_LINE = Buffer.from('1b5b304b', 'hex').toString();
        for (let index = 0; index < lines; index++) {
            process.stdout.write(MOVE_LEFT + CLEAR_LINE + MOVE_UP);
        }
    }
}