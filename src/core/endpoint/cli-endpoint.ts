import ChatModel from "@core/model/chat/chat-model";
import ModelEndPoint from "./model-endpoint";
import inquirer from "inquirer";
import chalk from "chalk";
import { Marisa } from "@type/marisa";
import CommandProcessor from "@core/model/command/command-processor";

export default class CliEndPoint extends ModelEndPoint {

    private isRunning: boolean = false
    constructor(model: ChatModel) {
        super(model)
        this.bindModelEvents(model)
    }

    public start() {
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
                if (CommandProcessor.IsSlashCommand(input)) {
                    continue
                }
                try {
                    let thinkingAnim: null | { stop: (timems?: number) => void } = this.createThinkingAnimation()
                    const timer = this.createSecondCounter()

                    let printThinkingTextMode: boolean = false
                    const response = await this.chatModel.invokeStream(input,
                        (delta, payload) => {

                            if (thinkingAnim) {
                                const seconds = timer.stopAndGetTime()
                                thinkingAnim.stop(seconds)
                                thinkingAnim = null
                            }

                            if (delta.indexOf('<think>') >= 0) {
                                printThinkingTextMode = true
                            }
                            if (delta.indexOf('</think>') >= 0) {
                                printThinkingTextMode = false
                            }
                            delta = delta.replaceAll("</think>", "\n");
                            process.stdout.write(chalk.bold.yellow(delta));
                        }
                    );
                    if (thinkingAnim) {
                        thinkingAnim.stop()
                        thinkingAnim = null
                    }
                    printThinkingTextMode = false
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
                this.printSingleLine(chalk.gray(`我们进行了一场记忆总结 | + ${uk}知识 | + ${um}记忆\n${this.createUsageText(session.usage)}`))
            })
            modelContextManager.on('summarizeFail', (error) => {
                this.printSingleLine(chalk.gray(`总结失败 | ${error}`))
            })
        }
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
        process.stdout.write(`\n${text}\n`)
    }

    private createUsageText(usage: Marisa.Chat.Completion.CompletionUsage) {
        const item: string[] = []
        if (usage.total_tokens) {
            item.push(`共 ${usage.total_tokens} tokens`)
        }
        if (usage.prompt_tokens) {
            item.push(`提示词 ${usage.prompt_tokens} tokens`)
        }
        if (usage.completion_tokens) {
            item.push(`完成 ${usage.completion_tokens} tokens`)
        }
        if (usage.prompt_tokens_details?.cached_tokens) {
            item.push(`提示词缓存 ${usage.prompt_tokens_details.cached_tokens} tokens`)
        }
        if (usage.completion_tokens_details?.reasoning_tokens) {
            item.push(`Reasoning ${usage.completion_tokens_details.reasoning_tokens} tokens`)
        }
        return item.join('|')
    }
}