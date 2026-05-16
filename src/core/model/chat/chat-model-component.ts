
import EventEmitter from "node:events";
import path from "node:path";
import { Marisa } from "@type/marisa";
import ChatModelComponentInstaller from "./chat-model-component-installer";
export default abstract class ChatModelComponent<T extends Record<keyof T, any[]>> extends EventEmitter<T> {

    public workspace: string = path.resolve('./workspace')
    protected injectModelTools: Marisa.Tool.AnyToolParam[] = []
    public installFunction:((installer:ChatModelComponentInstaller,modelInfo:Marisa.Model.ChatModelInfo)=>void) | null = null
    constructor() {
        super()
    }
}