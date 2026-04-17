import SqliteDatabase from "./sqlite"

interface MemorySearchQueryItem {
    id: number
    role: string
    content: string
    timestamp: number
    score: number
}

type MemorySearchDatabaseTables = ['messages', 'messages_fts5', 'messages_fts5_insert', 'messages_fts5_delete']

type MemorySearchDatabaseStmts = ['insert', 'delete', 'search']

export default class MemorySearchDatabase extends SqliteDatabase<MemorySearchDatabaseTables, MemorySearchDatabaseStmts> {

    constructor(dbPath: string) {
        super(dbPath, {
            tables: {
                messages: `
                CREATE TABLE IF NOT EXISTS messages(
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp INTEGER NOT NULL
                );`,
                messages_fts5: `
                CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts5 USING fts5(
                    role,
                    content,
                    timestamp,
                    tokenize = 'unicode61'
                );`,
                messages_fts5_insert: `
                CREATE TRIGGER IF NOT EXISTS messages_fts5_insert 
                AFTER INSERT ON messages 
                BEGIN
                    INSERT INTO messages_fts5(rowid, role, content, timestamp) 
                    VALUES (NEW.id, NEW.role, NEW.content, NEW.timestamp);
                END;`,
                messages_fts5_delete: `
                CREATE TRIGGER IF NOT EXISTS messages_fts5_delete 
                AFTER DELETE ON messages 
                BEGIN
                    INSERT INTO messages_fts5(messages_fts5, rowid, role, content, timestamp) 
                    VALUES('delete', OLD.id, OLD.role, OLD.content, OLD.timestamp);
                END;`
            },
            stmts: {
                insert: `
                    INSERT INTO messages (role, content, timestamp) 
                    VALUES ($role, $content, $timestamp)
                `,
                delete: `
                    DELETE FROM messages WHERE id = $id
                `,
                search: `
                    SELECT 
                        m.id,
                        m.role,
                        m.content,
                        m.timestamp,
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

    public insert(role: string, content: string, timestamp: number) {
        try {
            this.stmt('insert').run({ $role: role, $content: content, $timestamp: timestamp })
        } catch (error) {

        }
    }

    public delete(rid: number) {
        try {
            this.stmt('delete').run({ $id: rid })
        }
        catch (error) {
        }
    }

    public search(query: string,limit:number = 20): MemorySearchQueryItem[] {
        try {
            const stmt = this.stmt('search')
            const rows = stmt.all({ $query: query,$limit:limit}) as MemorySearchQueryItem[]
            return rows
        } catch (error) {
            return []
        }
    }
}