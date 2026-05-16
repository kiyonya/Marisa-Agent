
import inquirer from "inquirer";

export default abstract class PermissionAsker {
    public abstract askConfirm(message: string, defaultValue?: boolean ): Promise<boolean>
    protected gencid() {
        return crypto.randomUUID()
    }
}

