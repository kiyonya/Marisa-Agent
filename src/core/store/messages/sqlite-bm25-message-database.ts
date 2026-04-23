import SqliteDatabase from "../../utils/sqlite-store"

export type MemorySearchDatabaseTables = ['messages', 'messages_fts5', 'messages_fts5_insert', 'messages_fts5_delete']

export type MemorySearchDatabaseStmts = ['insert', 'delete', 'search']

export default class SqliteBM25MessageDatabase extends SqliteDatabase<MemorySearchDatabaseTables, MemorySearchDatabaseStmts> {
    constructor(dbPath: string) {
        super(dbPath, {
            tables: {
                messages: `
                CREATE TABLE IF NOT EXISTS messages(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    uuid TEXT NOT NULL UNIQUE,
                    content TEXT NOT NULL,
                    metadata TEXT
                );`,

                messages_fts5: `
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts5 USING fts5(
                    content,
                    tokenize = 'unicode61'
                );`,

                messages_fts5_insert: `
                CREATE TRIGGER IF NOT EXISTS messages_fts5_insert 
                AFTER INSERT ON messages 
                BEGIN
                    INSERT INTO messages_fts5(rowid, content) 
                    VALUES (NEW.id, NEW.content);
                END;`,

                messages_fts5_delete: `
                CREATE TRIGGER IF NOT EXISTS messages_fts5_delete 
                AFTER DELETE ON messages 
                BEGIN
                    DELETE FROM messages_fts5 WHERE rowid = OLD.id;
                END;`,
            },
            stmts: {
                insert: `
                    INSERT OR IGNORE INTO messages (uuid, content, metadata) 
                    VALUES ($uuid, $content, $metadata)
                `,
                delete: `
                    DELETE FROM messages WHERE uuid = $uuid
                `,
                search: `
                    SELECT 
                        m.id as rowid,
                        m.uuid as uuid,
                        m.content as content,
                        m.metadata as metadata,
                        bm25(messages_fts5) as score  
                    FROM messages m
                    INNER JOIN messages_fts5 ON m.id = messages_fts5.rowid
                    WHERE messages_fts5 MATCH $query
                    ORDER BY score
                    LIMIT $limit
                `
            }
        })
    }
}