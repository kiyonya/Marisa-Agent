import ChatModelComponent from "@core/model/chat/chat-model-component"

export type LongtermCategoricalMemoryType = 'user' | 'feedback' | 'reference' | 'experience'

export interface LongtermCategoricalMemoryMetadata {
    name: string,
    type: LongtermCategoricalMemoryType,
    description: string,
    keywords: string[],
    time: number
}

export interface LongtermCategoricalMemory {
    metadata: LongtermCategoricalMemoryMetadata,
    content: string
}

export default abstract class LongtermCategoricalMemoryManager extends ChatModelComponent<{}>{

    constructor(){
        super()
    }

    public abstract getAllMemories():Promise<LongtermCategoricalMemory[]>

    public abstract getAllMemoryMetadata():Promise<LongtermCategoricalMemoryMetadata[]>

    public abstract getAllMemoryMetamap():Promise<Partial<Record<LongtermCategoricalMemoryType,LongtermCategoricalMemoryMetadata[]>>>

    public abstract createOrUpdateMemory(memory:LongtermCategoricalMemory):Promise<void>

    public abstract readMemory(type:LongtermCategoricalMemoryType,name:string):Promise<undefined | LongtermCategoricalMemory>

    public abstract matchMemory(keywords:string[]):Promise<LongtermCategoricalMemory[]>
}