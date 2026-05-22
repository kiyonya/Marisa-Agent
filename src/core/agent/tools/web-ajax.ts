import LocalTool from "@core/tool/local-tool";
import z from "zod";
import axios from "axios";
import fs from 'fs'
import path from 'path'

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0'
const ALLOWED_RESPONSE_DATATYPE = ['application/json', 'text/html', 'text/plain']
const MAX_RESPONSE_SIZE = 256 * 1024 // 256KB
const COOKIE_CACHE = new Map<string, string>()

const description = `
WebAjax工具，发送http/https请求
什么时候使用：
- 当用户明确说明需要获取某个接口信息时
- 当你的skill提供对应操作方法时
- 当上一次结果中包含新的url时

禁止事项：
- 禁止请求敏感地址：严禁请求内网地址（如 192.168.*.*、localhost、*.internal）、本地文件协议（file://）、已知恶意域名，仅可请求公网可访问的 HTTP/HTTPS 地址
- 禁止携带可能伤害接口的内容，例如sql注入，xss攻击等

注意事项
- 当请求地址包含set-cookie时，下次同域会自动携带这个cookie以保持请求连续性

请求方法：
- url： 你需要提供明确的url地址，地址必须包括协议 例如https://api.example.com/weather，如果url地址携带参数，你可以拼接到url地址内
- method：请求方法，你需要提供请求的方法 你可以使用 GET POST PUT DELETE
- header：请求头，你可以设置请求头对象，例如user-agent，cookie，content-type，reference等
- body：请求体，当你使用POST 或者 PUT 请求时，你可以携带请求体，请求体必须是字符串形式或者键值对形式，禁止携带Buffer
- timeout：超时时间，默认为5000毫秒
- formdata：表单内容，当你设置了表单内容时，body将会被忽略，你需要提供一个键值对来表示表单元素，键为表单键，值可以为字符串，数字，布尔值。当你需要在表单携带本地文件时，你需要使用 特别的 **<formdata-file>本地文件的绝对路径</formdata-file>**，文件不存在时工具将会报错

返回内容：
- data: 响应体，响应体仅会返回JSON、页面、或者字符串响应体最大长度为256KB，超过的内容会被截断，响应体不会返回媒体文件，图片，数据流，webrtc，sse事件流
- headers：响应头，序列化json键值对
- status：状态码，其中2xx代表ok，3xx代表重定向，4xx请求错误，5xx服务器错误

结果处理
- 当请求超时，你可以选择重试最多一次，如果仍然超时你需要立刻停止并向用户说明情况
- 当响应状态码为400时，检查你的请求体，最多可以重复尝试一次，如果失败请立刻停止并向用户说明情况
- 当状态码为5xx时，不要尝试，说明情况后停止
- 其他错误：例如无网络，用户拒绝，DNS错误，请不要重试，立刻停止
- 当接口里包含其他接口或者地址时，你可以根据当前的响应结果再次发送新请求
`

interface WebAjaxParams {
    url: string,
    method?: "GET" | "POST" | "PUT" | "DELETE",
    headers?: Record<string, string>,
    body?: string | Record<string, string | number | boolean>,
    formdata?: Record<string, string | boolean | number>,
    timeout?: number
}

interface WebAjaxReturns {
    data?: string,
    headers: Record<string, string>,
    status: number
}
const WebAjax = new LocalTool<WebAjaxParams, WebAjaxReturns>("WebAjax", description, async (options) => {
    const url = options.url
    const method = options.method || "GET"
    const headers = options.headers || {}
    const body = options.body || null
    const formdata = options.formdata || null
    const timeout = options.timeout || 5000
    if (!url) {
        throw new Error(`URL must provided`)
    }
    if (method === 'GET' && (formdata || body)) {
        throw new Error(`GET method not allowed body or formdata, you can use POST or PUT method`)
    }
    const fullURL = new URL(url)
    let requestData: FormData | string | null = null
    if (formdata) {
        const fdata = new FormData()
        for (const [key, value] of Object.entries(formdata)) {
            if (typeof value === 'string' && value.startsWith('<formdata-file>') && value.endsWith('</formdata-file>')) {
                const filepath = value.replace('<formdata-file>', '').replace('</formdata-file>', '').trim()
                const isExist = fs.existsSync(filepath)
                if (!isExist) {
                    throw new Error(`file ${filepath} not exist`)
                }
                const filename = getFileName(filepath)
                const blob = await fs.openAsBlob(filename)
                fdata.append(key, blob, filename)
            }
            else {
                fdata.append(key, String(value))
            }
        }
        requestData = fdata
    }
    else if (body) {
        if (typeof body === 'string') {
            requestData = body
        }
        else if (typeof body === 'object') {
            try {
                const s = JSON.stringify(body)
                requestData = s
            } catch (error) {
                throw new Error(`body is not a valid JSON object`)
            }
        }
    }

    if (!headers['cookie'] && COOKIE_CACHE.has(fullURL.host)) {
        headers['cookie'] = COOKIE_CACHE.get(fullURL.host)!
    }

    if (!headers['user-agent']) {
        headers['user-agent'] = DEFAULT_UA
    }

    const request = await axios.request({
        url: fullURL.toString(),
        method,
        headers,
        data: requestData,
        timeout,
        validateStatus(_) {
            return true
        },
    })

    const rdata = request.data
    const rheaders = request.headers
    const contentTypeHeader = (rheaders['content-type'] || '').split(';')[0]?.trim() || 'application/json'
    const rhost = rheaders[':authority'] || rheaders['host'] || fullURL.host

    let dataToReturn: string | undefined = undefined
    if (ALLOWED_RESPONSE_DATATYPE.includes(contentTypeHeader)) {
        if (typeof rdata === 'string') {
            dataToReturn = rdata.slice(0, MAX_RESPONSE_SIZE)
        }
        else if (typeof rdata === 'object') {
            try {
                const s = JSON.stringify(rdata)
                dataToReturn = s.slice(0, MAX_RESPONSE_SIZE)
            } catch (error) {
                dataToReturn = undefined
            }
        }
        else if (typeof rdata === 'number' || typeof rdata === 'boolean') {
            dataToReturn = String(rdata)
        }
    }

    if (rheaders['set-cookie']) {
        const cookies = rheaders['set-cookie']
        if (Array.isArray(cookies)) {
            COOKIE_CACHE.set(rhost, cookies.join(';'))
        }
        else if (typeof cookies === 'string') {
            COOKIE_CACHE.set(rhost, cookies)
        }
    }



    return {
        data: dataToReturn,
        //@ts-ignore
        headers: rheaders.toJSON(),
        status: request.status
    }

}, {
    url: z.string(),
    method: z.enum(["GET", "POST", "PUT", "DELETE"]).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.union([z.string(), z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))]).optional(),
    formdata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    timeout: z.number().optional().default(5000)
})


function getFileName(filepath: string) {
    const ext = path.extname(filepath)
    return path.basename(filepath).replace(ext, '')
}
export default WebAjax