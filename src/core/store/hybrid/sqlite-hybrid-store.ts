
import { HybridStoreQueryResult } from "../impl/result";
import { HybridStore, HybridStoreInsertItem } from "./hybrid-store";
import SqliteHybridStoreDatabase, { HybridQueryRow, HybridVectorQueryRow } from "./sqlite-hybrid-database";

export default class SqliteHybridStore<Metadata extends Record<any, any> = any> extends HybridStore<Metadata> {

    private db: SqliteHybridStoreDatabase
    constructor(dbPath: string, dimension: number = 512) {
        super()
        this.db = new SqliteHybridStoreDatabase(dbPath, dimension)
        this.embeddingDimension = dimension
    }

    public override async insert(insertItem: HybridStoreInsertItem): Promise<void> {
        try {
            const transaction = this.db.getDB().transaction(() => {
                const now = Date.now()
                const common = this.db.stmt('insert_common').run({
                    $uuid: insertItem.uuid,
                    //分词器
                    $content: insertItem.content,
                    $metadata: JSON.stringify(insertItem.metadata) || null,
                    $createdAt: now,
                    $updatedAt: now
                })
                const commonLid = common.lastInsertRowid
                if (insertItem.f32vec && insertItem.f32vec.length) {
                    console.log(insertItem.f32vec)
                    this.db.stmt('insert_vector').run({
                        $rowid: commonLid,
                        $f32array: JSON.stringify(Array.from(insertItem.f32vec))
                    })
                }
            })
            transaction()
        } catch (error) {
            console.error(error)
        }
    }

    public override async batchInsert(insertItems: HybridStoreInsertItem[]): Promise<void> {
        try {
            const transaction = this.db.getDB().transaction(() => {
                for (const insertItem of insertItems) {
                    const now = Date.now()
                    const common = this.db.stmt('insert_common').run({
                        $uuid: insertItem.uuid,
                        $content: insertItem.content,
                        $metadata: JSON.stringify(insertItem.metadata) || null,
                        $createdAt: now,
                        $updatedAt: now
                    })
                    const commonLid = common.lastInsertRowid
                    if (insertItem.f32vec && insertItem.f32vec.length) {
                        this.db.stmt('insert_vector').run({
                            $rowid: commonLid,
                            $f32array: JSON.stringify(Array.from(insertItem.f32vec))
                        })
                    }
                }
            })
            transaction()
        } catch (error) {
            console.error(error)
        }
    }

    public override async delete(uuid: string): Promise<void> {
        try {
            this.db.stmt('delete').run({ $uuid: uuid })
        } catch (error) {
            console.error(error)
        }
    }

    public override async queryKeyword(query: string, limit: number = 20): Promise<HybridStoreQueryResult<Metadata>[]> {
        try {
            const rows = (this.db.stmt('query_bm25').all({
                $query: query,
                $limit: limit
            }) || []) as HybridQueryRow[]
            const results: HybridStoreQueryResult<Metadata>[] = rows.map(i => ({ ...i, metadata: i.metadata ? JSON.parse(i.metadata) as Metadata : undefined }))
            return results
        } catch (error) {
            console.error(error)
            return []
        }
    }

    public override async queryVector(vector: Float32Array, limit: number = 20): Promise<HybridStoreQueryResult<Metadata>[]> {
        try {
            const rows = (this.db.stmt('query_vector').all({
                $vector: JSON.stringify(Array.from(vector)),
                $limit: limit
            }) || []) as HybridVectorQueryRow[]
            const results: HybridStoreQueryResult<Metadata>[] = rows.map(i => ({ ...i, metadata: i.metadata ? JSON.parse(i.metadata) as Metadata : undefined }))
            return results
        } catch (error) {
            return []
        }
    }
}