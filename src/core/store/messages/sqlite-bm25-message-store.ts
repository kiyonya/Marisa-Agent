
import MessageStore from "./message-store"
import { type MessageStoreQueryResult } from "../impl/result"
import SqliteBM25MessageDatabase from "./sqlite-bm25-message-database"

export default class SqliteBM25MessageStore<Metadata extends any = any> extends MessageStore<Metadata> {
    private db: SqliteBM25MessageDatabase
    constructor(dbPath: string) {
        super()
        this.db = new SqliteBM25MessageDatabase(dbPath)
    }
    public override insert(uuid: string, content: string, metadata?: Metadata): Promise<void> | void {
        try {
            this.db.stmt('insert').run({ $uuid: uuid, $content: content, $metadata: JSON.stringify(metadata) })
        } catch (error) {

        }
    }
    public override delete(uuid: string): Promise<void> | void {
        try {
            this.db.stmt('delete').run({ $uuid: uuid })
        }
        catch (error) {
        }
    }
    public override search(query: string, limit: number): MessageStoreQueryResult<Metadata>[] {
        try {
            const stmt = this.db.stmt('search')
            const rows = stmt.all({ $query: query, $limit: limit }) as { rowid: number, uuid: string, content: string, metadata?: string, score: number }[]

            const results: MessageStoreQueryResult<Metadata>[] = []
            for (const row of rows) {
                const metadata = row.metadata ? JSON.parse(row.metadata) as Metadata : void 0
                const result: MessageStoreQueryResult<Metadata> = {
                    metadata: metadata,
                    score: row.score,
                    uuid: row.uuid,
                    rowid: row.rowid
                }
                results.push(result)
            }
            return results
        } catch (error) {
            return []
        }
    }
}

