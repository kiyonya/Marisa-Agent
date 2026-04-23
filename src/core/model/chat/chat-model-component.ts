import { ensureDirSync } from "fs-extra";
import EventEmitter from "node:events";
import path from "node:path";
import { Marisa } from "../../../types/marisa";
import ChatModel from "./chat-model";

type WorkspaceSubPath = 'contexts' | 'memories' | 'skills' | 'memories/categories' | 'memories/vector' | 'memories/search' | 'memories/hybrid' |  'temp'

export default abstract class ChatModelComponent<T extends Record<keyof T, any[]>> extends EventEmitter<T> {
    protected componentWorkspace: string = path.resolve('./workspace')

    protected injectModelConstantTools:Marisa.Tool.AnyTool[] = []
    protected injectModelTools:Marisa.Tool.AnyTool[] = []

    public myEvents:(keyof T)[] = []
    constructor(es:(keyof T)[]) {
        super()
        this.myEvents = es
    }

    public setWorkspace(workspace: string) {
        this.componentWorkspace = workspace
    }

    public getWorkspace(subpath?: WorkspaceSubPath) {
        let dpath = this.componentWorkspace
        if (!subpath) {
            dpath = this.componentWorkspace
        }
        else {
            dpath = path.join(this.componentWorkspace, subpath)
        }
        ensureDirSync(dpath)
        return dpath
    }

    public inject(chatModel:ChatModel){
        chatModel.defineConstantTools(...this.injectModelConstantTools)
        chatModel.defineTools(...this.injectModelTools)
    }

    protected injectModelConstantTool(...tools:Marisa.Tool.AnyTool[]){
        this.injectModelConstantTools.push(...tools)
        return this
    }

    protected injectModelTool(...tools:Marisa.Tool.AnyTool[]){
        this.injectModelConstantTools.push(...tools)
        return this
    }
}