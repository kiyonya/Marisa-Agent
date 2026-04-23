import { VectorStoreQueryResult } from "../impl/result";
import { MetadataFilter } from "./metadata-filter";

export interface DBSearchOptions {
    limit?: number;
            recall?: number;
            orderBy?: 'distance' | 'score' | 'rowid';
            order?: 'ASC' | 'DESC';
}

export default abstract class VectorStore<Metadata = Record<string,string>> {

    public dimemsion:number = 512

    public abstract insert(uuid:string,vectors: Float32Array,metadata?:Metadata): Promise<void>

    public abstract batchInsert(items:Array<{uuid:string,vector: Float32Array;metadata?: Metadata;id?: number}>):Promise<void>

    public abstract search(vectors: Float32Array,metadataFilter?:MetadataFilter<Partial<Metadata>>,options?:DBSearchOptions): Promise<VectorStoreQueryResult<Metadata>[]>

}






