import SqliteDatabase from "@core/utils/sqlite-store";
import LongtermCategoricalMemoryManager, { LongtermCategoricalMemory, LongtermCategoricalMemoryMetadata, LongtermCategoricalMemoryType } from "./longterm-cmemory-manager";

type Tables = ['memory', 'keywords']
type Stmts = ['insert', 'update', 'match', 'get_memory', 'get_all_memory', 'get_all_metadata', 'get_metadata', 'get_rowid']
type Triggers = ['memory_insert', 'memory_update']

interface MemoryTableRow {
    rowid: number,
    name: string,
    type: LongtermCategoricalMemoryType,
    keywords: string,
    description: string,
    content: string,
    created_at: number,
    updated_at: number
}

interface MemoryTableMetadataRow {
    rowid: number,
    type: LongtermCategoricalMemoryType,
    name: string,
    keywords: string,
    description: string,
    time: number
}

export class SqliteLongtermCategoricalMemoryDatabase extends SqliteDatabase<Tables, Stmts, Triggers> {

    constructor(dbPath: string) {
        super(dbPath, {
            tables: {
                memory: `CREATE TABLE IF NOT EXISTS memory (
                    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL,
                    description TEXT NOT NULL,
                    keywords TEXT,
                    content TEXT,
                    created_at INTEGER,
                    updated_at INTEGER,
                    UNIQUE(type, name)
                );`,
                keywords: `CREATE VIRTUAL TABLE IF NOT EXISTS keywords_fts5 USING fts5 (
                    keywords,
                    tokenize = 'trigram'
                );`
            },
            triggers: {
                memory_insert: `
                CREATE TRIGGER IF NOT EXISTS memory_insert
                AFTER INSERT ON memory
                BEGIN
                    INSERT INTO keywords_fts5(rowid, keywords) 
                    VALUES (NEW.rowid, NEW.keywords);
                END;`,
                memory_update: `
                CREATE TRIGGER IF NOT EXISTS memory_update
                AFTER UPDATE ON memory
                BEGIN
                    DELETE FROM keywords_fts5 WHERE rowid = NEW.rowid;
                    INSERT INTO keywords_fts5(rowid, keywords) 
                    VALUES (NEW.rowid, NEW.keywords);
                END;`
            },
            stmts: {
                insert: `
                INSERT INTO memory (name, type, description, keywords, content,created_at, updated_at)
                VALUES ($name, $type, $description, $keywords, $content, $createdAt, $updatedAt)`,
                update: `
                UPDATE memory 
                SET name = $name, 
                    type = $type, 
                    description = $description, 
                    keywords = $keywords, 
                    content = $content,
                    updated_at = $updatedAt
                WHERE rowid = $rowid`,
                match: `
                SELECT 
                    m.rowid as rowid,
                    m.name as name,
                    m.type as type,
                    m.description as description,
                    m.keywords as keywords,
                    m.content as content,
                    m.created_at as created_at,
                    m.updated_at as updated_at,
                    bm25(keywords_fts5) as score  
                FROM memory m
                INNER JOIN keywords_fts5 ON m.rowid = keywords_fts5.rowid
                WHERE keywords_fts5 MATCH $query
                ORDER BY score ASC
                LIMIT $limit`,
                get_memory: `
                SELECT 
                    m.rowid as rowid,
                    m.name as name,
                    m.type as type,
                    m.description as description,
                    m.keywords as keywords,
                    m.content as content,
                    m.created_at as created_at,
                    m.updated_at as updated_at
                FROM memory m
                WHERE type = $type AND name = $name`,
                get_all_memory: `
                SELECT 
                    m.rowid as rowid,
                    m.name as name,
                    m.type as type,
                    m.description as description,
                    m.keywords as keywords,
                    m.content as content,
                    m.created_at as created_at,
                    m.updated_at as updated_at
                FROM memory m
                `,
                get_all_metadata: `
                SELECT 
                    m.rowid as rowid,
                    m.name as name,
                    m.type as type,
                    m.description as description,
                    m.keywords as keywords,
                    m.updated_at as time
                FROM memory m`,
                get_metadata: `
                SELECT 
                    m.rowid as rowid,
                    m.name as name,
                    m.type as type,
                    m.description as description,
                    m.keywords as keywords,
                    m.updated_at as time
                FROM memory m
                WHERE type = $type AND name = $name`,
                get_rowid: `
                SELECT rowid FROM memory WHERE type = $type AND name = $name`
            }
        })
    }

    public async insertOrUpdateMemory(memory: LongtermCategoricalMemory): Promise<void> {
        const transaction = this.getDB().transaction(() => {
            const metadata = memory.metadata
            const content = memory.content
            const { name, type, description, keywords, time } = metadata
            const hasRowid = this.stmt('get_rowid').get({ $type: type, $name: name }) as {rowid:number | null} | null
            if (!hasRowid || !hasRowid.rowid) {
                //create
                this.stmt('insert').run({
                    $name: name,
                    $type: type,
                    $description: description,
                    $keywords: keywords.join(' '),
                    $content: content,
                    $createdAt: time || Date.now(),
                    $updatedAt: time || Date.now()
                })
            }
            else {
                //update
                let rowid:number = hasRowid.rowid
                if(typeof rowid !== 'number'){
                    throw new Error(`RowId Must Number`)
                }
                this.stmt('update').run({
                    $rowid: rowid,
                    $name: name,
                    $type: type,
                    $description: description,
                    $keywords: keywords.join(' '),
                    $content: content,
                    $updatedAt: time || Date.now()
                })
            }
        })
        transaction()
    }

    public async getMemory(type: LongtermCategoricalMemoryType, name: string): Promise<null | LongtermCategoricalMemory> {
        const memory = this.stmt('get_memory').get({
            $type: this.stringEscape(type),
            $name: this.stringEscape(name)
        }) as MemoryTableRow | null
        if (!memory) { return null }
        const memoryFormat: LongtermCategoricalMemory = {
            metadata: {
                name: memory.name,
                type: memory.type,
                description: memory.description,
                time: memory.updated_at,
                keywords: memory.keywords.split(' ') || []
            },
            content: memory.content
        }
        return memoryFormat
    }

    public async getAllMemory(): Promise<LongtermCategoricalMemory[]> {
        const memories = this.stmt('get_all_memory').all() as MemoryTableRow[]
        if (!memories) { return [] }
        const memoriesFormatArray: LongtermCategoricalMemory[] = []
        for (const memory of memories) {
            const memoryFormat: LongtermCategoricalMemory = {
                metadata: {
                    name: memory.name,
                    type: memory.type,
                    description: memory.description,
                    time: memory.updated_at,
                    keywords: memory.keywords.split(' ') || []
                },
                content: memory.content
            }
            memoriesFormatArray.push(memoryFormat)
        }
        return memoriesFormatArray
    }

    public async getMetadata(type: LongtermCategoricalMemoryType, name: string): Promise<LongtermCategoricalMemoryMetadata | null> {
        const metadata = this.stmt('get_metadata').get({
            $type: this.stringEscape(type),
            $name: this.stringEscape(name)
        }) as MemoryTableMetadataRow | null
        if (!metadata) { return null }
        const metadataFormat: LongtermCategoricalMemoryMetadata = {
            name: metadata.name,
            type: metadata.type,
            description: metadata.description,
            time: metadata.time,
            keywords: metadata.keywords.split(' ') || []
        }
        return metadataFormat
    }

    public async getAllMetadata(): Promise<LongtermCategoricalMemoryMetadata[]> {
        const metadatas = this.stmt('get_all_metadata').all() as MemoryTableMetadataRow[] | null
        if (!metadatas) { return [] }
        const metadataFormatArray: LongtermCategoricalMemoryMetadata[] = []
        for (const metadata of metadatas) {
            const metadataFormat: LongtermCategoricalMemoryMetadata = {
                name: metadata.name,
                type: metadata.type,
                description: metadata.description,
                time: metadata.time,
                keywords: metadata.keywords.split(' ') || []
            }
            metadataFormatArray.push(metadataFormat)
        }
        return metadataFormatArray
    }

    public async match(keywords: string[], limit: number = 10): Promise<LongtermCategoricalMemory[]> {
        const queryString = keywords.join(' ')
        const memories = this.stmt('match').all({
            $query: this.stringEscape(queryString),
            $limit: limit
        }) as MemoryTableRow[] | null
        if (!memories) { return [] }
        const memoriesFormatArray: LongtermCategoricalMemory[] = []
        for (const memory of memories) {
            const memoryFormat: LongtermCategoricalMemory = {
                metadata: {
                    name: memory.name,
                    type: memory.type,
                    description: memory.description,
                    time: memory.updated_at,
                    keywords: memory.keywords.split(' ') || []
                },
                content: memory.content
            }
            memoriesFormatArray.push(memoryFormat)
        }
        return memoriesFormatArray
    }

    private stringEscape(string: string): string {
        if (string.match(/[\s"*():<>-]/)) {
            return `"${string.replace(/"/g, '""')}"`;
        }
        return string;
    }
}

export class SqliteLongtermCategoricalMemoryManager extends LongtermCategoricalMemoryManager {

    private db: SqliteLongtermCategoricalMemoryDatabase
    constructor(dbPath: string) {
        super()
        this.db = new SqliteLongtermCategoricalMemoryDatabase(dbPath)
    }

    public override async getAllMemories(): Promise<LongtermCategoricalMemory[]> {
        const memories = await this.db.getAllMemory()
        return memories
    }

    public override async getAllMemoryMetadata(): Promise<LongtermCategoricalMemoryMetadata[]> {
        const metadatas = await this.db.getAllMetadata()
        return metadatas
    }

    public override async getAllMemoryMetamap(): Promise<Partial<Record<LongtermCategoricalMemoryType, LongtermCategoricalMemoryMetadata[]>>> {
        const metadatas = await this.db.getAllMetadata()
        const result: Partial<Record<LongtermCategoricalMemoryType, LongtermCategoricalMemoryMetadata[]>> = {}
        for (const metadata of metadatas) {
            const type = metadata.type
            if (!result[type]) {
                result[type] = [metadata]
            }
            else {
                result[type].push(metadata)
            }
        }
        return result
    }

    public override async createOrUpdateMemory(memory: LongtermCategoricalMemory): Promise<void> {
        await this.db.insertOrUpdateMemory(memory)
    }

    public override async readMemory(type: LongtermCategoricalMemoryType, name: string): Promise<undefined | LongtermCategoricalMemory> {
        const memory = await this.db.getMemory(type, name)
        return memory ? memory : undefined
    }

    public override async matchMemory(keywords: string[]): Promise<LongtermCategoricalMemory[]> {
        const matches = await this.db.match(keywords, 10)
        return matches
    }
}