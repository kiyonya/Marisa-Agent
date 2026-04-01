import fs from 'fs'

export default class JSONL<Item = Object> {
    private objl: Item[] = []
    private _parse(jsonlString: string) {
        const lines = jsonlString.split(/\r?\n/)
        for (let line of lines) {
            line = line.trim()
            if (line.length === 0) {
                continue
            }
            try {
                const obj = JSON.parse(line)
                if (typeof obj === 'object' && obj !== null) {
                    this.objl.push(obj)
                }
            } catch (error) {
                console.error(`Failed to parse line: ${line}`)
            }
        }
    }

    public parseFile(filePath: string): this {
        if (!fs.existsSync(filePath)) {
            throw new Error(`No Such File ${filePath}`)
        }
        const buffer = fs.readFileSync(filePath)
        const string = buffer.toString('utf-8')
        this._parse(string)
        return this
    }

    public parse(jsonl: string | Buffer): this {
        if (typeof jsonl === 'string') {
            this._parse(jsonl)
        }
        else if (Buffer.isBuffer(jsonl)) {
            const string = jsonl.toString('utf-8')
            this._parse(string)
        }
        return this
    }

    public add(object: Item): this {
        if (typeof object === 'object' && object !== null) {
            this.objl.push(object)
        }
        return this
    }

    public toString(): string {
        return this.objl.map(obj => JSON.stringify(obj)).join('\n')
    }

    public toArray(): Item[] {
        return [...this.objl]
    }

    public toFile(filePath: string, options?: { 
        encoding?: BufferEncoding; 
        flag?: string;
        newline?: 'lf' | 'crlf';
    }): void {
        const encoding = options?.encoding || 'utf-8'
        const flag = options?.flag || 'w'
        let content = this.toString()
        if (options?.newline === 'crlf') {
            content = content.replace(/\n/g, '\r\n')
        } else if (options?.newline === 'lf') {
            content = content.replace(/\r\n/g, '\n')
        }
        if (content.length > 0 && !content.endsWith('\n')) {
            content += '\n'
        }
        
        fs.writeFileSync(filePath, content, { encoding, flag })
    }

    public toBuffer(options?: { newline?: 'lf' | 'crlf' }): Buffer<ArrayBuffer> {
        let content = this.toString()
        
        if (options?.newline === 'crlf') {
            content = content.replace(/\n/g, '\r\n')
        } else if (options?.newline === 'lf') {
            content = content.replace(/\r\n/g, '\n')
        }
        
        if (content.length > 0 && !content.endsWith('\n')) {
            content += '\n'
        }
        
        return Buffer.from(content, 'utf-8')
    }
    public clear(): this {
        this.objl = []
        return this
    }
    public size(): number {
        return this.objl.length
    }
    public get(index: number):Item | undefined {
        return this.objl[index]
    }
}
