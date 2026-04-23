import VectorStore, { DBSearchOptions } from "./vector-store";
import { ensureDirSync } from "fs-extra";
import path from 'node:path'
import { MetadataFilter } from "./metadata-filter";
import { Database } from 'bun:sqlite'
import { load } from 'sqlite-vec'
import { VectorStoreQueryResult } from "../impl/result";

export default class SqliteVecStore<Metadata extends Record<string, any> = Record<string, any>> extends VectorStore<Metadata> {
    private dbfile: string;
    private db: Database;
    public dimension: number;
    private tableName: string;
    private metadataTableName: string;

    constructor(dbfile: string, dimensions: number) {
        super();
        dbfile = path.resolve(dbfile)
        this.dbfile = dbfile;
        this.dimension = dimensions;
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
                embedding float[${this.dimension}]
            )
        `);
        this.db.run(`
            CREATE TABLE IF NOT EXISTS ${this.metadataTableName} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT NOT NULL UNIQUE,
                metadata TEXT,
                created_at INTEGER,
                updated_at INTEGER
            )
        `);
    }

    public override async insert(uuid: string, vectors: Float32Array | Float32Array[], metadata?: Metadata | Metadata[]): Promise<void> {
        const vectorsArray = Array.isArray(vectors) ? vectors : [vectors];
        const metadataArray = metadata
            ? (Array.isArray(metadata) ? metadata : [metadata])
            : vectorsArray.map(() => ({} as Metadata));

        if (vectorsArray.length !== metadataArray.length) {
            throw new Error('Vectors and metadata arrays must have the same length');
        }

        const now = Date.now();

        const insertMetadata = this.db.prepare(`
            INSERT INTO ${this.metadataTableName}(uuid,metadata, created_at, updated_at) 
            VALUES ($uuid, $metadata, $createdAt, $updatedAt)
        `);

        const insertVector = this.db.prepare(`
            INSERT INTO ${this.tableName}(rowid, embedding) 
            VALUES ($rowId, vec_f32($f32array))
        `);

        const transaction = this.db.transaction(() => {
            for (let i = 0; i < vectorsArray.length; i++) {
                const vector = vectorsArray[i] as Float32Array;
                const meta = metadataArray[i];

                const result = insertMetadata.run({
                    $uuid: uuid,
                    $metadata: JSON.stringify(meta),
                    $createdAt: (meta as any)?.created_at || now,
                    $updatedAt: now
                });

                const id = result.lastInsertRowid;
                insertVector.run({
                    $rowId: id,
                    $f32array: new Float32Array(vector)
                });
            }
        });

        transaction();
    }

    public override async batchInsert(items: Array<{ uuid: string, vector: Float32Array; metadata?: Metadata }>): Promise<void> {
        if (items.length === 0) return;
        const now = Date.now();
        const uuids = items.map(item => item.uuid);
        const placeholders = uuids.map(() => '?').join(',');
        const existingRecords = this.db.query(`
        SELECT uuid FROM ${this.metadataTableName} 
        WHERE uuid IN (${placeholders})
    `).all(...uuids) as Array<{ uuid: string }>;

        const existingUuids = new Set(existingRecords.map(r => r.uuid));
        const newItems = items.filter(item => !existingUuids.has(item.uuid));

        if (newItems.length === 0) {
            return;
        }

        const maxIdResult = this.db.query(`
        SELECT COALESCE(MAX(id), 0) as max_id 
        FROM ${this.metadataTableName}
    `).get() as { max_id: number };

        let nextId = maxIdResult.max_id + 1;

        const insertMetadata = this.db.prepare(`
        INSERT INTO ${this.metadataTableName}(id, uuid, metadata, created_at, updated_at) 
        VALUES ($rowId, $uuid, $metadata, $createdAt, $updatedAt)
    `);

        const insertVector = this.db.prepare(`
        INSERT INTO ${this.tableName}(rowid, embedding) 
        VALUES ($rowId, vec_f32($f32array))
    `);

        const transaction = this.db.transaction(() => {
            for (const item of newItems) {
                const id = nextId++;
                insertMetadata.run({
                    $rowId: id,
                    $uuid: item.uuid,
                    $metadata: JSON.stringify(item.metadata || {}),
                    $createdAt: (item.metadata as any)?.created_at || now,
                    $updatedAt: now
                });

                insertVector.run({
                    $rowId: id,
                    $f32array: new Float32Array(item.vector)
                });
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
            filterSql = filterResult.sql;
            filterParams = filterResult.params;
        }

        let sql = `
            SELECT 
                v.rowid as id,
                v.distance,
                m.metadata,
                m.uuid as uuid
            FROM ${this.tableName} v
            INNER JOIN ${this.metadataTableName} m ON m.id = v.rowid
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
            uuid: row.uuid,
            distance: row.distance,
            metadata: JSON.parse(row.metadata),
            score: row.score
        }));
    }

    public async getMetadata(id: number): Promise<Metadata | null> {
        const result = this.db
            .prepare(`SELECT metadata FROM ${this.metadataTableName} WHERE id = ?`)
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