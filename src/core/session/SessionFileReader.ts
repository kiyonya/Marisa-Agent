import fsExtra from "fs-extra/esm"
import { Marisa } from "../../types/marisa"
import { existsSync } from "fs-extra"

export default class SessionFileReader {
    private file:string
    constructor(file:string){
        this.file = file
    }
    public readSync():Marisa.Chat.Completion.CompletionSession[]{
        if(!existsSync(this.file)){
            return []
        }
        return fsExtra.readJSONSync(this.file)
    }
}