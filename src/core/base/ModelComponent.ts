import { ensureDirSync } from "fs-extra";
import EventEmitter from "node:events";
import path from "node:path";
import { Marisa } from "../../types/marisa";
import Model from "../model/Model";

type WorkspaceSubPath = 'contexts' | 'memories' | 'skills' | 'memories/categories' | 'memories/vector' | 'memories/search' | 'temp'

export default abstract class ModelComponent<T extends Record<keyof T, any[]>> extends EventEmitter<T> {
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

    public inject(chatModel:Model){
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