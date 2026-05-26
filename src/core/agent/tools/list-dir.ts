import LocalTool from "@core/tool/local-tool"
import fs from 'fs'
import path from "path"
import z from "zod"

export type ListDirItem = {
    type: "file",
    path: string,
    size: number
} | {
    type: "directory",
    path: string
}

const description = `
ListDir
List items of directory.
you need provide an absolute path of the directory,and you can also provide a filter to filter items with extname,for example [".txt"] to list all text files.

Important Notes
- You must provide an **absolute path** of the directory (e.g., D:/example/)
- The tool can only list items within the allowed file directory. If a directory is not accessible or you have insufficient permissions, the tool will throw an error. Do not attempt to repeatedly access directories that you already know have insufficient permissions.
- If dirpath is not exist,an error will throw
- filter must an array,and you need to write dot (e.g., [".txt",".pdf",".docx"])
Returns
- The tool returns an array of items in the directory. Each item includes the path, type (file or directory), and size (for files - bytes).
- Only call this tool when necessary. Iterating or traversing folders is strictly prohibited.
`

const ListDir = new LocalTool<{ dirpath: string, filter?: string[] }, ListDirItem[]>("ListDir", description, async ({ dirpath, filter }) => {
    if (!fs.existsSync(dirpath)) {
        throw new Error(`dirpath not exist "${dirpath}"`)
    }
    let dirItems = await fs.promises.readdir(dirpath)

    if (filter && filter.length) {
        dirItems = dirItems.filter(i => filter.includes(path.extname(i)))
    }
    let items = dirItems.map(i => path.join(dirpath, i))
    const result: ListDirItem[] = []
    for (const item of items) {
        const stat = await fs.promises.stat(item)
        if (stat.isFile()) {
            result.push({
                type: 'file',
                path: item,
                size: stat.size
            })
        }
        else if (stat.isDirectory() && !(filter && filter.length)) {
            result.push({
                type: 'directory',
                path: item
            })
        }
    }

    return result
}, {
    dirpath: z.string(),
    filter: z.array(z.string()).optional()
})

export default ListDir