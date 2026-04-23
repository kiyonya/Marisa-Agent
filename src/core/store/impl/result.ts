export interface StoreQueryResult<Metadata extends any = any> {
    uuid: string,
    metadata?: Metadata,
}

export interface MessageStoreQueryResult<Metadata extends any = any> extends StoreQueryResult<Metadata> {
    score: number,
    rowid: number,
}

export interface VectorStoreQueryResult<Metadata extends any = any> extends StoreQueryResult<Metadata> {
    score: number,
    distance: number
    rowid: number,
}

export interface HybridStoreQueryResult<Metadata extends any = any> extends StoreQueryResult<Metadata> {
    content:string
    score:number,
    distance?:number,
    rowid:number,
}