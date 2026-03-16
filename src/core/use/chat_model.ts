import OpenAIModel from "../model/openai_model";
import readline from 'readline'
import chalk from "chalk";

export default class CommandLineModelChat {
    private model: OpenAIModel
    private rl: readline.Interface
    constructor(model: OpenAIModel) {
        this.model = model
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })
        this.start()
    }
    public start() {
        const doConversation = async () => {
            this.rl.question('', async (userInput) => {
                const input = userInput.trim();
                if (!input) {
                    console.log('请输入内容\n');
                    doConversation();
                    return;
                }
                try {
                    process.stdout.write('\n')
                    const response = await this.model.invokeStream(input,
                        (delta, payload) => {
                            delta = delta.replaceAll("</think>", "\n")
                            process.stdout.write(chalk.bold.yellow(delta));
                        }
                    );
                    console.log(chalk.blue(`使用token:${response?.usage.total_tokens}`))
                } catch (error) {
                    console.error('错误:', error);
                }
                doConversation();
            });
        };
        doConversation()
    }
}