import { load } from "sqlite-vec"
import SqliteDatabase from "../../utils/sqlite-store"

type Tables = ['common','content_vector','content_fts5']
type Stmts = ['insert_common','insert_vector','delete','query_bm25','query_vector']
type Triggers = ['common_insert','common_delete']

export interface HybridQueryRow {
    rowid:number,
    uuid:string,
    metadata?:string,
    content:string,
    score:number
}

export interface HybridVectorQueryRow extends HybridQueryRow {
    distance:number
}

export default class SqliteHybridStoreDatabase extends SqliteDatabase<Tables,Stmts,Triggers> {
    public vectorDimension: number = 512
    constructor(dbPath: string, vectorDimension: number = 512) {
        super(dbPath, {
            tables: {
                common: `CREATE TABLE IF NOT EXISTS common (
                    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT NOT NULL UNIQUE,
                    content TEXT NOT NULL,
                    metadata TEXT,
                    created_at INTEGER,
                    updated_at INTEGER
                );`,
                //虚拟表有隐rowid 直接插
                content_vector: `CREATE VIRTUAL TABLE IF NOT EXISTS content_vector USING vec0(
                    embedding float[${vectorDimension}]
                );`,
                content_fts5: `CREATE VIRTUAL TABLE IF NOT EXISTS content_fts5 USING fts5(
                    content,
                    tokenize = 'trigram'
                );`,
            },
            triggers: {
                common_insert: `
                CREATE TRIGGER IF NOT EXISTS common_insert
                AFTER INSERT ON common 
                BEGIN
                    INSERT INTO content_fts5(rowid, content) 
                    VALUES (NEW.rowid, NEW.content);
                END;`,
                common_delete: `
                CREATE TRIGGER IF NOT EXISTS common_delete
                AFTER DELETE ON common
                BEGIN
                    DELETE FROM content_fts5 WHERE rowid = OLD.rowid;
                    DELETE FROM content_vector WHERE rowid = OLD.rowid;
                END;`,
            },
            stmts: {
                insert_common: `
                INSERT INTO common (uuid, content, metadata, created_at, updated_at)
                VALUES ($uuid,$content,$metadata,$createdAt,$updatedAt);`,

                insert_vector: `
                INSERT INTO content_vector(rowid,embedding)
                VALUES ($rowid,$f32array);`,

                delete: `
                DELETE FROM common WHERE rowid = $rowid;
                `,

                query_bm25: `
                SELECT 
                    c.rowid as rowid,
                    c.uuid as uuid,
                    c.content as content,
                    c.metadata as metadata,
                    bm25(content_fts5) as score  
                FROM common c
                INNER JOIN content_fts5 ON c.rowid = content_fts5.rowid
                WHERE content_fts5 MATCH $query
                ORDER BY score
                LIMIT $limit
                `,

                query_vector: `
                SELECT 
                    c.rowid as rowid,
                    c.uuid as uuid,
                    c.content as content,
                    c.metadata as metadata,
                    v.distance as score,
                    v.distance
                FROM content_vector v
                INNER JOIN common c ON c.rowid = v.rowid
                WHERE v.embedding MATCH $vector
                ORDER BY v.distance ASC
                LIMIT $limit
                `
            }
        },(db=>load(db)))
    }
}