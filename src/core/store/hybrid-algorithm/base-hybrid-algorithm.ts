import { HybridStoreQueryResult } from "../impl/result";

export default abstract class BaseHybridAlgorithm {

    public abstract run<Metadata = any>(vectorResult: HybridStoreQueryResult<Metadata>[], keywordResult: HybridStoreQueryResult<Metadata>[],limit:number,...args:any[]): HybridStoreQueryResult<Metadata>[] | Promise<HybridStoreQueryResult<Metadata>[]>
}