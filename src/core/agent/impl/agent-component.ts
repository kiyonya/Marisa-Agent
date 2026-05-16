
import { Marisa } from "@type/marisa"
import EventEmitter from "node:events"
import path from "node:path"
import AgentComponentInstaller from "./agent-component-installer"

export interface AgentComponentInitResult {
    tools?: Marisa.Tool.AnyTool[],
    prompts?: string
}

export default abstract class AgentComponent<T extends Record<keyof T, any[]> = any> extends EventEmitter<T> {

    public workspace: string = path.resolve('./workspace')
    protected injectModelTools: Marisa.Tool.AnyToolParam[] = []
    public installFunction: ((installer: AgentComponentInstaller) => void) | null = null
    constructor() {
        super()
    }
}