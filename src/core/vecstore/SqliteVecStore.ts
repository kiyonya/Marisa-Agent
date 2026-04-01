import VectorStore, { DBSearchOptions } from "./VectorStore";
import { ensureDirSync } from "fs-extra";
import path from 'node:path'
import { MetadataFilter } from "./MetadataFilter";
import { Database } from 'bun:sqlite'
import { load } from 'sqlite-vec'

export interface VectorStoreQueryResult<Metadata> {
    rowid: number;
    distance: number;
    metadata: Metadata;
    score?: number;
}

export default class SqliteVecStore<Metadata extends Record<string, any> = Record<string, any>> extends VectorStore<Metadata> {
    private dbfile: string;
    private db: Database;
    private vecDimensions: number;
    private tableName: string;
    private metadataTableName: string;

    constructor(dbfile: string, dimensions: number, metadata?: keyof Metadata) {
        super();
        dbfile = path.resolve(dbfile)
        this.dbfile = dbfile;
        this.vecDimensions = dimensions;
        this.tableName = 'vec_items';
        this.metadataTableName = 'items_metadata';

        const dir = path.dirname(dbfile);
        ensureDirSync(dir);
        this.db = new Database(dbfile);

        this.db.run('PRAGMA journal_mode = WAL');
        this.db.run('PRAGMA synchronous = NORMAL');
        this.db.run('PRAGMA cache_size = -20000'); 
        this.db.run('PRAGMA temp_store = MEMORY');

        load(this.db);
        this.createTables();
    }

    private createTables() {
        this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        embedding float[${this.vecDimensions}]
      )
    `);

        this.db.run(`
      CREATE TABLE IF NOT EXISTS ${this.metadataTableName} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rowid INTEGER UNIQUE,
        metadata TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

        this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_metadata_rowid 
      ON ${this.metadataTableName}(rowid)
    `);
    }

    public override async insert(vectors: Float32Array | Float32Array[], metadata?: Metadata | Metadata[]): Promise<void> {
        const vectorsArray = Array.isArray(vectors) ? vectors : [vectors];
        const metadataArray = metadata
            ? (Array.isArray(metadata) ? metadata : [metadata])
            : vectorsArray.map(() => ({} as Metadata));

        if (vectorsArray.length !== metadataArray.length) {
            throw new Error('Vectors and metadata arrays must have the same length');
        }

        const insertVector = this.db.prepare(`
      INSERT INTO ${this.tableName}(rowid, embedding) 
      VALUES (?, vec_f32(?))
    `);

        const insertMetadata = this.db.prepare(`
      INSERT INTO ${this.metadataTableName}(rowid, metadata, created_at, updated_at) 
      VALUES (?, ?, ?, ?)
      ON CONFLICT(rowid) DO UPDATE SET
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

        const maxRowId = this.db.query(`
      SELECT COALESCE(MAX(rowid), 0) as max_id 
      FROM ${this.metadataTableName}
    `).get() as { max_id: number };

        let currentId = maxRowId.max_id + 1;
        const transaction = this.db.transaction(() => {
            for (let i = 0; i < vectorsArray.length; i++) {
                const vector = vectorsArray[i] as Float32Array;
                const meta = metadataArray[i];
                const now = Date.now();
                insertVector.run(currentId, new Float32Array(vector));
                insertMetadata.run(
                    currentId,
                    JSON.stringify(meta),
                    (meta as any)?.created_at || now,
                    now
                );
                currentId++;
            }
        });

        transaction();
    }

    public override async batchInsert(items: Array<{ vector: Float32Array; metadata?: Metadata; id?: number }>): Promise<void> {
        const insertVector = this.db.prepare(`
      INSERT INTO ${this.tableName}(rowid, embedding) 
      VALUES (?, vec_f32(?))
    `);

        const insertMetadata = this.db.prepare(`
      INSERT INTO ${this.metadataTableName}(rowid, metadata, created_at, updated_at) 
      VALUES (?, ?, ?, ?)
      ON CONFLICT(rowid) DO UPDATE SET
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `);

        const maxRowId = this.db.query(`
      SELECT COALESCE(MAX(rowid), 0) as max_id 
      FROM ${this.metadataTableName}
    `).get() as { max_id: number };

        let currentId = maxRowId.max_id + 1;
        const now = Date.now();

        const transaction = this.db.transaction(() => {
            for (const item of items) {
                const id = item.id !== undefined ? item.id : currentId++;

                insertVector.run(id, new Float32Array(item.vector));
                insertMetadata.run(
                    id,
                    JSON.stringify(item.metadata || {}),
                    (item.metadata as any)?.created_at || now,
                    now
                );
            }
        });
        transaction();
    }

    public override async search(
        vector: Float32Array,
        metadataFilter?: MetadataFilter<Partial<Metadata>>,
        options?: DBSearchOptions
    ): Promise<VectorStoreQueryResult<Metadata>[]> {
        const {
            limit = 10,
            recall = 100,
            orderBy = 'distance',
            order = 'ASC'
        } = options || {};
        let filterSql = '';
        let filterParams: any[] = [];

        if (metadataFilter) {
            const filterResult = this.sqlFilterToJsonExtract(metadataFilter.toSqlFilter());
            console.log(filterResult)
            filterSql = filterResult.sql;
            filterParams = filterResult.params;
        }
        let sql = `
      SELECT 
        v.rowid as id,
        v.distance,
        m.metadata
      FROM ${this.tableName} v
      INNER JOIN ${this.metadataTableName} m ON m.rowid = v.rowid
    `;
        const params: any[] = [];

        if (filterSql) {
            sql += ` WHERE ${filterSql}`;
            params.push(...filterParams);
            sql += ` AND v.embedding MATCH ? AND v.k = ?`;
        } else {
            sql += ` WHERE v.embedding MATCH ? AND v.k = ?`;
        }

        params.push(new Float32Array(vector), recall);

        sql += ` ORDER BY v.${orderBy} ${order}`;
        sql += ` LIMIT ?`;

        params.push(limit);
        const results = this.db.prepare(sql).all(...params);
        return results.map((row: any) => ({
            rowid: Number(row.id),
            distance: row.distance,
            metadata: JSON.parse(row.metadata),
            score: row.score
        }));
    }

    public override async delete(rowid: number): Promise<void> {
        const transaction = this.db.transaction(() => {
            this.db.run(`DELETE FROM ${this.tableName} WHERE rowid = ?`, [rowid]);
            this.db.run(`DELETE FROM ${this.metadataTableName} WHERE rowid = ?`, [rowid]);
        });
        transaction();
    }

    public async getMetadata(id: number): Promise<Metadata | null> {
        const result = this.db
            .prepare(`SELECT metadata FROM ${this.metadataTableName} WHERE rowid = ?`)
            .get(id) as { metadata: string } | undefined;

        if (!result) return null;
        return JSON.parse(result.metadata);
    }

    public async count(): Promise<number> {
        const result = this.db
            .prepare(`SELECT COUNT(*) as count FROM ${this.metadataTableName}`)
            .get() as { count: number };
        return result.count;
    }

    public close(): void {
        this.db.close();
    }

    public async clear(): Promise<void> {
        this.db.transaction(() => {
            this.db.run(`DROP TABLE IF EXISTS ${this.tableName}`);
            this.db.run(`DROP TABLE IF EXISTS ${this.metadataTableName}`);
            this.createTables();
        })();
    }

    private sqlFilterToJsonExtract(filterResult: { sql: string; params: any[] }): { sql: string; params: any[] } {
        if (!filterResult.sql) return { sql: '', params: [] };
        const jsonifiedSql = filterResult.sql.replace(
            /\b(\w+)\b(?=\s*(?:=|>=|<=|>|<|!=|IN|LIKE|BETWEEN))/g,
            (match, field) => {
                const keywords = ['AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL'];
                if (keywords.includes(field.toUpperCase())) return match;
                return `json_extract(m.metadata, '$.${field}')`;
            }
        );
        return {
            sql: jsonifiedSql,
            params: filterResult.params
        };
    }
} 