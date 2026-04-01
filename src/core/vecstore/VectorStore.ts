import { MetadataFilter } from "./MetadataFilter";

interface VectorStoreQueryResult<Metadata = Record<string,string>> {
    rowid: number,
    distance: number,
    metadata?:Metadata
}

export interface DBSearchOptions {
    limit?: number;
            recall?: number;
            orderBy?: 'distance' | 'score' | 'rowid';
            order?: 'ASC' | 'DESC';
}

export default abstract class VectorStore<Metadata = Record<string,string>> {

    public abstract insert(vectors: Float32Array,metadata?:Metadata): Promise<void>

    public abstract batchInsert(items:Array<{vector: Float32Array;metadata?: Metadata;id?: number}>):Promise<void>

    public abstract search(vectors: Float32Array,metadataFilter?:MetadataFilter<Partial<Metadata>>,options?:DBSearchOptions): Promise<VectorStoreQueryResult<Metadata>[]>

    public abstract delete(rowid:number):Promise<void>
}






