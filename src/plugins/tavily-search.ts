import AgentPluginBase from "../core/plugin/agent-plugin-base";
import axios from "axios";
import z from "zod";
import LocalTool from "../core/tool/local-tool";

export interface TavilySearchOptions {
    query: string,
    search_depth?: "basic" | "advanced" | "fast" | "ultra-fast",
    chunks_per_source?: number;
    max_results?: number;
    topic?: "general" | "news" | "finance"
    time_range?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    include_answer?: boolean;
    include_raw_content?: boolean;
    include_images?: boolean;
    include_image_descriptions?: boolean;
    include_favicon?: boolean;
    include_domains?: string[];
    exclude_domains?: string[];
    country?: string;
    auto_parameters?: boolean;
    exact_match?: boolean;
    include_usage?: boolean;
    safe_search?: boolean;
}

export interface TavilySearchResult {
    title: string;
    url: string;
    content: string;
    score: number;
    raw_content: string | null;
    favicon: string | null;
    images: {
        url: string;
        description: string;
    }[];
}

export interface TavilySearchResponse {
    query: string;
    answer: string;
    images: {
        url: string;
        description: string;
    }[];
    results: TavilySearchResult[];
    response_time: string;
    usage: {
        credits: number
    };
}

export default class TavilySearchPlugin extends AgentPluginBase {

    public static readonly CountryEnum = z.enum([
        "afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia",
        "australia", "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados",
        "belarus", "belgium", "belize", "benin", "bhutan", "bolivia", "bosnia and herzegovina",
        "botswana", "brazil", "brunei", "bulgaria", "burkina faso", "burundi", "cambodia",
        "cameroon", "canada", "cape verde", "central african republic", "chad", "chile",
        "china", "colombia", "comoros", "congo", "costa rica", "croatia", "cuba", "cyprus",
        "czech republic", "denmark", "djibouti", "dominican republic", "ecuador", "egypt",
        "el salvador", "equatorial guinea", "eritrea", "estonia", "ethiopia", "fiji",
        "finland", "france", "gabon", "gambia", "georgia", "germany", "ghana", "greece",
        "guatemala", "guinea", "haiti", "honduras", "hungary", "iceland", "india",
        "indonesia", "iran", "iraq", "ireland", "israel", "italy", "jamaica", "japan",
        "jordan", "kazakhstan", "kenya", "kuwait", "kyrgyzstan", "latvia", "lebanon",
        "lesotho", "liberia", "libya", "liechtenstein", "lithuania", "luxembourg",
        "madagascar", "malawi", "malaysia", "maldives", "mali", "malta", "mauritania",
        "mauritius", "mexico", "moldova", "monaco", "mongolia", "montenegro", "morocco",
        "mozambique", "myanmar", "namibia", "nepal", "netherlands", "new zealand",
        "nicaragua", "niger", "nigeria", "north korea", "north macedonia", "norway",
        "oman", "pakistan", "panama", "papua new guinea", "paraguay", "peru", "philippines",
        "poland", "portugal", "qatar", "romania", "russia", "rwanda", "saudi arabia",
        "senegal", "serbia", "singapore", "slovakia", "slovenia", "somalia", "south africa",
        "south korea", "south sudan", "spain", "sri lanka", "sudan", "sweden", "switzerland",
        "syria", "taiwan", "tajikistan", "tanzania", "thailand", "togo", "trinidad and tobago",
        "tunisia", "turkey", "turkmenistan", "uganda", "ukraine", "united arab emirates",
        "united kingdom", "united states", "uruguay", "uzbekistan", "venezuela", "vietnam",
        "yemen", "zambia", "zimbabwe"
    ]);

    public static readonly TavilySearchZod = {
        query: z
            .string()
            .min(1, "查询字符串不能为空")
            .describe("必填。要执行的搜索查询，例如 'who is Leo Messi?'"),

        search_depth: z
            .enum(["advanced", "basic", "fast", "ultra-fast"])
            .optional()
            .default("basic")
            .describe(
                "可选，默认 'basic'。控制延迟与相关性的权衡：advanced=最高相关性，延迟较高，返回多个语义相关片段；basic=平衡选项，返回一个 NLP 摘要；fast=较低延迟，保持良好相关性；ultra-fast=最小化延迟。advanced 消耗 2 积分，其他消耗 1 积分"
            ),

        chunks_per_source: z
            .number()
            .int()
            .min(1, "最小值为 1")
            .max(3, "最大值为 3")
            .optional()
            .default(3)
            .describe(
                "可选，默认 3。每个来源返回的相关内容块最大数量（每个块最多 500 字符）。仅在 search_depth 为 advanced 时可用。范围：1-3"
            ),

        max_results: z
            .number()
            .int()
            .min(0, "最小值为 0")
            .max(20, "最大值为 20")
            .optional()
            .default(5)
            .describe("可选，默认 5。返回的最大搜索结果数量。范围：0-20"),

        topic: z
            .enum(["general", "news", "finance"])
            .optional()
            .default("general")
            .describe(
                "可选，默认 'general'。搜索类别：general=通用搜索；news=新闻搜索，适合获取实时更新；finance=金融财经"
            ),

        time_range: z
            .enum(["day", "week", "month", "year", "d", "w", "m", "y"])
            .optional()
            .describe(
                "可选。从当前日期往回的时间范围，基于发布日期或最后更新日期过滤结果。选项：day/d、week/w、month/m、year/y"
            ),

        start_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD")
            .optional()
            .describe("可选。返回指定开始日期之后的结果，基于发布日期或最后更新日期。格式：YYYY-MM-DD，例如 '2025-02-09'"),

        end_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD")
            .optional()
            .describe("可选。返回指定结束日期之前的结果，基于发布日期或最后更新日期。格式：YYYY-MM-DD，例如 '2025-12-29'"),

        include_answer: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                "可选，默认 false。是否包含 LLM 生成的答案。true/basic 返回快速答案，advanced 返回更详细的答案"
            ),

        include_raw_content: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                "可选，默认 false。是否包含每个搜索结果的清理和解析后的 HTML 内容。true/markdown 返回 markdown 格式，text 返回纯文本"
            ),

        include_images: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                "可选，默认 false。是否包含图片。返回顶层的 images 列表和每个结果对象内的 images 数组"
            ),

        include_image_descriptions: z
            .boolean()
            .optional()
            .default(false)
            .describe("可选，默认 false。当 include_images 为 true 时，是否添加每张图片的描述文本"),

        include_favicon: z
            .boolean()
            .optional()
            .default(false)
            .describe("可选，默认 false。是否为每个结果包含 favicon URL"),

        include_domains: z
            .array(z.string())
            .max(300, "最多 300 个域名")
            .optional()
            .describe("可选。指定要包含在搜索结果中的域名列表。最多 300 个域名"),

        exclude_domains: z
            .array(z.string())
            .max(150, "最多 150 个域名")
            .optional()
            .describe("可选。指定要从搜索结果中排除的域名列表。最多 150 个域名"),

        country: TavilySearchPlugin.CountryEnum.optional()
            .describe("可选。提升特定国家/地区的搜索结果。仅在 topic 为 general 时可用"),

        auto_parameters: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                "可选，默认 false。启用后自动根据查询内容和意图配置搜索参数。search_depth 可能自动设为 advanced（消耗 2 积分）。可通过显式设置 search_depth 为 basic 避免额外成本"
            ),

        exact_match: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                "可选，默认 false。仅返回包含查询中精确短语的结果。需要在查询中将目标短语用引号包裹，例如 '\"John Smith\" CEO Acme Corp'"
            ),

        include_usage: z
            .boolean()
            .optional()
            .default(false)
            .describe("可选，默认 false。是否在响应中包含积分使用信息"),

        safe_search: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                "Enterprise only。可选，默认 false。是否过滤成人或不安全内容。不支持 fast 或 ultra-fast 搜索深度"
            )
    }

    private tavilyAPIKEY: string
    constructor(apikey: string) {
        super('tavily_search')
        this.tavilyAPIKEY = apikey

        const searchTool = new LocalTool<TavilySearchOptions, TavilySearchResponse>('search', "使用互联网搜索获取实时信息，当你有不确定的内容时，你可以使用这个工具",
            async (options) => {
                const req = await axios.post<TavilySearchResponse>('https://api.tavily.com/search', {
                    ...options
                }, {
                    headers: {
                        "Content-Type": 'application/json',
                        Authorization: `Bearer ${this.tavilyAPIKEY}`
                    },
                    timeout: 10000
                })
                const data = req.data
                return data
            }, TavilySearchPlugin.TavilySearchZod)


        this.installFunction = (installer)=>{

            installer.getWorkspace('tavily_search_cache')

            installer.registerTool(searchTool)
            installer.onInstallFailed = (error)=>{
                console.log('tavily_search 安装失败')
            }
        }
    }

}
