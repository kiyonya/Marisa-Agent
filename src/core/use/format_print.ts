import chalk from "chalk"
import { Table } from "console-table-printer"

export default class FormatPrint {

    public static printToolList(tools: { name: string, description: string }[]) {
        const table = new Table({
            title: "已注册工具",
            rows: tools,
            defaultColumnOptions: {
                alignment: 'center',
                color: 'blue',
                maxLen: 30,
                minLen: 20,
            },
        })
        table.printTable()
    }

    public static printSkillList(skills: { name: string, description: string }[]) {
        const table = new Table({
            title: "已注册工具",
            rows: skills,
            defaultColumnOptions: {
                alignment: 'center',
                color: 'blue',
                maxLen: 30,
                minLen: 20,
            },
        })
        table.printTable()
    }

    public static printToolCallResult(callName:string,callArguments:Record<string,any>,callResult:any){
        const toPythonLikeFunction: string[] = []
        for (const [an, av] of Object.entries(callArguments)) {
            toPythonLikeFunction.push(`${an}=${JSON.stringify(av)}`)
        }
        let cvs = chalk.bold.greenBright(`工具调用 => ${callName}(${toPythonLikeFunction.join(',')})`)
        const resultString = JSON.stringify(callArguments, null, 4)
        const head = resultString.split('\n').slice(0, 5).join('\n')
        const cvr = chalk.gray(`调用结果 \n${head}`)
        process.stdout.write(cvs)
        process.stdout.write('\n')
        process.stdout.write(cvr)
        process.stdout.write('\n')
    }
}