import inquirer from "inquirer";
import PermissionAsker from "./permission-requestor";

export default class InquirerPermissionAsker extends PermissionAsker {
    public override async askConfirm(message: string, defaultValue: boolean = true): Promise<boolean> {
        const cid = this.gencid()
        const confirm = await inquirer.prompt([{
            message: message,
            type: 'confirm',
            default: defaultValue,
            name: cid
        }])
        const isConfirmed = Boolean(confirm[cid])
        if (process.stdin.isPaused()) {
            process.stdin.resume();
        }
        return isConfirmed
    }
}