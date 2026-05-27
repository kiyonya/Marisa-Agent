
import { Marisa } from "@type/marisa"
import EventEmitter from "node:events"
import AgentComponentInstaller from "./agent-component-installer"

export interface AgentComponentInitResult {
    tools?: Marisa.Tool.AnyTool[],
    prompts?: string
}
type EventMap<T> = Record<keyof T, any[]>;
export default abstract class AgentComponent<T extends EventMap<T>> extends EventEmitter<T> {

    protected injectModelTools: Marisa.Tool.AnyToolParam[] = []
    public installFunction: ((installer: AgentComponentInstaller) => void | Promise<void>) | null = null
    constructor() {
        super()
    }
}