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
WebAjax Tool – Send HTTP/HTTPS Requests

When to use:
- When the user explicitly requests to retrieve information from an API
- When your skill provides corresponding operational methods
- When the previous result contains a new URL

Prohibited actions:
- **Requesting sensitive addresses is strictly prohibited:** Do not request internal network addresses (e.g., 192.168.*.*, localhost, *.internal), local file protocols (file://), or known malicious domains. Only publicly accessible HTTP/HTTPS addresses are allowed.
- **Do not include content that may harm the interface,** such as SQL injection, XSS attacks, etc.

Note:
- When the response from a request includes \`set-cookie\`, subsequent requests to the same domain will automatically carry that cookie to maintain request continuity.

Request parameters:
- **url:** You must provide a clear URL address, including the protocol (e.g., \`https://api.example.com/weather\`). If the URL contains parameters, you can append them to the URL string.
- **method:** Provide the request method. You can use \`GET\`, \`POST\`, \`PUT\`, \`DELETE\`.
- **header:** You can set request header objects, such as \`user-agent\`, \`cookie\`, \`content-type\`, \`referer\`, etc.
- **body:** For \`POST\` or \`PUT\` requests, you can include a request body. The body must be a string or key-value pairs. Buffers are not allowed.
- **timeout:** Timeout duration in milliseconds (default is 5000 ms).
- **formdata:** When form data is set, the \`body\` will be ignored. You need to provide key-value pairs representing form elements, where the key is the form field name and the value can be a string, number, or boolean. If you need to include a local file in the form data, you must use the special syntax: **\`<formdata-file>Absolute path to local file</formdata-file>\`**. If the file does not exist, the tool will return an error.

Returned content:
- **data:** The response body. Only JSON, HTML pages, or string responses are returned. The maximum response body length is 256KB; longer content will be truncated. The response body will **not** return media files, images, data streams, WebRTC, or SSE event streams.
- **headers:** Response headers as a serialized JSON key-value object.
- **status:** The HTTP status code. \`2xx\` indicates OK, \`3xx\` indicates redirection, \`4xx\` indicates client error, and \`5xx\` indicates server error.

Handling results:
- **Timeout:** You may retry **once at most**. If it times out again, stop immediately and explain the situation to the user.
- **Status code 400 (Bad Request):** Check your request body. You may retry **once at most**. If it fails again, stop immediately and explain the situation to the user.
- **Status code 5xx (Server Error):** Do not retry. Explain the situation and stop.
- **Other errors** (e.g., no network, user denial, DNS error): Do not retry. Stop immediately.
- If the response contains other APIs or URLs, you may send new requests based on the current response result.
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