import LocalTool from "@core/tool/local-tool";
import fse from 'fs-extra'
import z from "zod";
import path from "node:path";

const description = `Read File Contents\nYou can use this tool to read the contents of one or more text files. This tool can only read text-based files.\nUsage:\n- You can provide multiple file paths, and file reading will be performed simultaneously. You can read up to 10 files at a time.\n- Use this tool when you need to read file contents.\n- You can only read files within the allowed file directory. If a file is not readable or you have insufficient permissions, the tool will throw an error. Do not attempt to repeatedly read files that you already know have insufficient permissions.\n- File size must not exceed 1MB. When a file is too large, the tool will throw an error, and you need to inform the user of the situation. Do not attempt to re-read oversized files.\n- You can choose which text encoding to use for decoding the content. The default encoding is UTF-8.`

export type FileTextEncoding = "utf-8" | 'ascii'

const ReadFile = new LocalTool<{ pathes: string[], encoding?: FileTextEncoding }>("ReadFile", description, async ({ pathes, encoding }, permissionAsker) => {

    if (permissionAsker) {
        const permission = await permissionAsker.askConfirm(`是否允许读取下列文件:\n${pathes.join('\n')}`)
        if (!permission) {
            throw new Error("User Reject Reading File,Dont try it again")
        }
    }

    const fileResults: Record<string, string> = {}
    for (const filepath of pathes) {
        if (!path.isAbsolute(filepath)) {
            throw new Error(`file path "${filepath}" is not an absolute path`)
        }
        const isExist = await fse.exists(filepath)
        if (!isExist) {
            throw new Error(`the file "${filepath}" is not exists`)
        }
        const stat = await fse.stat(filepath)
        if (!stat.isFile()) {
            throw new Error(`"${filepath}" is not a file`)
        }
        const maxSize = 1024 * 1024
        if (stat.size >= maxSize) {
            throw new Error(`the size ${stat.size}bytes of file "${filepath}" is too large,max ${maxSize} bytes`)
        }
        try {
            const str = await fse.readFile(filepath, encoding || 'utf-8')
            fileResults[filepath] = str
        } catch (error) {
            throw new Error(`Read file failed with error: ${error}`)
        }
    }
    return fileResults
}, {
    pathes: z.array(z.string()).describe('absolute path of files'),
    encoding: z.string().optional().default('utf-8').describe("encoding")
})

export default ReadFile