import LocalTool from "@core/tool/local-tool"
import path from 'path'
import fse from 'fs-extra'
import z from "zod"

const description = `
Write File
you can use this tool to write or append text-base file.

**Pre-Write Validation**
1. **Overwrite**: Before performing an overwrite, the target file must first be read to verify its content scope. Direct overwriting without reading is strictly prohibited.
2. **Permission/Rejection**: Once the tool returns a "Permission Denied" or "User Rejected" response, immediately terminate the current file-related task flow and report the blocking point to the user. Guessing the cause arbitrarily is forbidden.

**Execution Parameter Specifications**
- **Path**: Must use a complete relative path or absolute path. Ambiguous references are prohibited.
- **Append Write**: Ensure a necessary newline character is added at the end of the content to avoid concatenation of old and new content.
- **Auto-Creation**: If a parent directory in the path does not exist, first attempt to create the directory or report an error. Writing directly to a non-existent path is not allowed.

**Exception Handling**
- **No Retry Loops**: After any error (e.g., disk full, non-writable), only one targeted logical fix attempt is permitted. If the error persists, control must be returned to the user.`

export type FileTextEncoding = "utf-8" | 'ascii'

const WriteFile = new LocalTool<{ filepath: string, data: string, encoding?: FileTextEncoding, flag: "a" | "w" }>('WriteFile', description, async ({ filepath, data, encoding, flag }, permissionAsker) => {

    if (permissionAsker) {
        const permission = await permissionAsker.askConfirm(`你允许编辑文件${filepath}吗`)
        if (!permission) {
            throw new Error(`User Rejected Edit File "${filepath}"`)
        }
    }

    if (typeof data !== 'string') {
        throw new Error("data to write not a string,are you use buffer?")
    }
    const dirname = path.dirname(filepath)
    await fse.ensureDir(dirname)
    if (process.platform === 'linux') {
        await fse.chmod(filepath, 777)
    }
    await fse.writeFile(filepath, String(data), {
        encoding: encoding || 'utf-8',
        flag: flag || 'w'
    })
    return `file "${filepath}" writed.`
}, {
    filepath: z.string(),
    data: z.string(),
    encoding: z.string().optional().default("utf-8"),
    flag: z.enum(['a', 'w']).optional().default('w')
})

export default WriteFile