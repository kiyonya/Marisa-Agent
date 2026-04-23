import { MessageStoreQueryResult } from "../impl/result";

export default abstract class MessageStore<Metadata> {
    public abstract insert(uuid: string, content:string,metadata?:Metadata): Promise<void> | void
    public abstract delete(uuid: string): Promise<void> | void
    public abstract search(query: string, limit: number): MessageStoreQueryResult<Metadata>[]
}