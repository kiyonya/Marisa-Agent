import LocalTool from "@core/tool/local-tool";
import open from "open";
import z from "zod";

const description = `
OpenFileOrURL
Use the default method to open a file or URL address. Use this tool when the user asks you to open a file or when you need to present something to the user after completing a task.

Important Notes
- Prohibited from opening executable files, such as (.bat, .cmd, .exe, etc.)
- Prohibited from opening high-risk URLs, sensitive websites, known malicious domains, etc.
- You must provide the **absolute path** of the file (e.g., D:/example.md) or a **complete URL address** that includes the protocol (e.g., https://example.com)
- If the tool call returns an error, it means the file cannot be opened. You must inform the user to open the file manually and only retry when user let you to do.
- You must ensure the local file exists before attempting to open it.
`

const OpenFileOrURL = new LocalTool<{ fileOrURL: string }>("OpenFileOrURL", description, async ({ fileOrURL }, permissionAsker) => {

    if (!fileOrURL) {
        throw new Error('File Or URL Must Provided')
    }

    if (permissionAsker) {
        const permission = await permissionAsker.askConfirm(`你是否允许打开文件 ${fileOrURL} ?`)
        if (!permission) {
            throw new Error(`User Rejected to open ${fileOrURL}`)
        }
    }
    const process = await open(fileOrURL, { wait: true })
    if (process.pid) {
        return `Open ${fileOrURL} Successfully`
    }
    else {
        throw new Error(`Failed to open ${fileOrURL}`)
    }

}, {
    fileOrURL: z.string()
})

export default OpenFileOrURL