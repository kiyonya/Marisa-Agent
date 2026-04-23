import { HybridStoreQueryResult } from "../impl/result";

export interface HybridStoreInsertItem<Metadata extends Record<any, any> = any> {
    uuid: string,
    content: string,
    metadata?: Metadata,
    f32vec?: Float32Array
}


export abstract class HybridStore<Metadata extends Record<any, any> = any> {
    public embeddingDimension:number = 512
    public abstract insert(insertItem: HybridStoreInsertItem): Promise<void>
    public abstract batchInsert(insertItems: HybridStoreInsertItem[]): Promise<void>
    public abstract delete(uuid: string): Promise<void>
    public abstract queryKeyword(query: string, limit?: number): Promise<HybridStoreQueryResult<Metadata>[]>
    public abstract queryVector(vector:Float32Array, limit?: number): Promise<HybridStoreQueryResult<Metadata>[]>
}