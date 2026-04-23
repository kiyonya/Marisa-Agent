import { Database, Statement } from "bun:sqlite";
import fse from 'fs-extra'
import path from "path";

type SqliteDatabaseOptions<TableList extends Array<string> = [], StmtList extends Array<string> = [], TriggerList extends Array<string> = []> = {
    tables: Record<TableList[number], string>,
    triggers?: Record<TriggerList[number], string>
} & (StmtList extends []
    ? { stmts?: Record<StmtList[number], string> }
    : { stmts: Record<StmtList[number], string> })

export default abstract class SqliteDatabase<TableList extends Array<string> = [], StmtList extends Array<string> = [], TriggerList extends Array<string> = []> {
    private db: Database
    private tables: Record<TableList[number], string>
    private triggers?: Record<TriggerList[number], string>
    private stmtSqls: StmtList extends [] ? Record<string, never> | undefined : Record<StmtList[number], string>;
    private stmts = new Map<StmtList[number], Statement>()
    constructor(pathLike: string, opt: SqliteDatabaseOptions<TableList, StmtList, TriggerList>, onDBCreate?: (db: Database) => void, onDBInited?: (db: Database) => void) {
        const dir = path.dirname(pathLike)
        fse.ensureDirSync(dir)
        this.db = new Database(pathLike)
        if (onDBCreate) {
            onDBCreate(this.db)
        }
        this.tables = opt.tables
        if (opt.stmts) {
            this.stmtSqls = opt.stmts as any;
        } else {
            this.stmtSqls = undefined as any;
        }
        this.triggers = opt.triggers
        this.init()
        if (onDBInited) {
            onDBInited(this.db)
        }
    }
    private init() {
        for (const sql of Object.values(this.tables)) {
            this.db.run(sql as string);
        }
        if (this.triggers) {
            for (const trigger of Object.values(this.triggers)) {
                this.db.run(trigger as string)
            }
        }
        if (this.stmtSqls) {
            for (const [stmtName, stmtsql] of Object.entries(this.stmtSqls)) {
                try {
                    const ns = this.db.prepare(stmtsql as string)
                    this.stmts.set(stmtName, ns)
                } catch (error) {
                }
            }
        }
    }
    public stmt(name: StmtList[number]): Statement {
        const i = this.stmts.get(name)
        if (i) { return i }
        else {
            throw new Error(`Statement ${name} Not Found`)
        }
    }
    public close() {
        this.db.close()
    }
    public location() {
        return this.db.filename
    }
    public getDB() {
        return this.db
    }
    public beginTransaction() {
        this.db.run('BEGIN TRANSACTION;');
    }

    public commitTransaction() {
        this.db.run('COMMIT TRANSACTION;');
    }

    public rollbackTransaction() {
        this.db.run('ROLLBACK TRANSACTION;');
    }
}

