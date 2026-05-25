import { ChatCompletionMessageCustomToolCall, ChatCompletionMessageFunctionToolCall } from "openai/resources";
import OpenAI from "openai";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import MCPTool from "../core/tool/mcp-tool";
import LocalTool from "../core/tool/local-tool";
import ToolGroup from "../core/tool/tool-group";
import DynamicTool from "@core/tool/dynamic-tool";

export namespace Marisa {

    export namespace Model {

        export interface ModelInfo {
            modelName: string
        }

        export interface ChatModelInfo extends ModelInfo {
            completionOptions: ModelCompletionOptions
        }

        export interface ModelCompletionOptions {
            modelName?: string,
            topP?: number
            temperature?: number
            maxCompletionTokens?: number
            promptCacheRetention?: 'in-memory' | '24h' | null
            toolChoice?: | 'none' | 'auto' | 'required'
            parallelToolCalls?: boolean,
            simplifyHistorySession?: boolean
        }

        export interface ModelOptions {
            modelContexts?: Marisa.Chat.Completion.CompletionContext,
            modelToolMap?: Map<string, Marisa.Tool.AnyTool>,
            modelContextDumpFile?: string,
            modelRolePrompt?: string,
            modelSkills?: Map<string, Marisa.Skill.SkillFrontmatter>,
            modelSkillLoadTool?: LocalTool<{ skillName: string }>
        }

        export interface LLMCreateOptions extends ModelCompletionOptions {
            llmContexts?: Marisa.Chat.Completion.CompletionContext,
            llmToolMap?: Map<string, Marisa.Tool.AnyTool>,
            llmContextDumpFile?: string,
            llmRolePrompt?: string
        }

        export interface OpenAIModelOptions extends ModelOptions {
            client: OpenAI
        }

        export interface ModelInterceptors {
            userPromptInput: { inputMessages: Marisa.Chat.Completion.CompletionMessage[] },
        }

    }

    export namespace Agent {

        export type ModelType = "openai" | 'none'

        export type AgentCreateOptions = {
            agentName?: string,
            modelOption?: Omit<Model.ModelCompletionOptions, 'modelName'>
        }

        export type AgentCreateOpenAIOptions =
            { client: OpenAI; modelName: string }
            | (Marisa.Platform.OpenAI.ClientOptions & { modelName: string });
    }

    export namespace Chat {

        export namespace Completion {

            export namespace Messages {

                export interface Message {
                    timestamp: number
                }

                export interface ChatCompletionSystemMessage extends Message {
                    content: string;
                    role: 'system';
                    name?: string;
                    temporary?: boolean,

                }
                export interface ChatCompletionDeveloperMessage extends Message {
                    content: string
                    role: 'developer';
                    name?: string;
                    temporary?: boolean
                }
                export interface ChatCompletionUserMessage extends Message {
                    content: string
                    role: 'user';
                    name?: string;
                    temporary?: boolean
                }
                export interface ChatCompletionAssistantMessage extends Message {
                    role: 'assistant';
                    audio?: { id: string } | null;
                    content?: string
                    function_call?: FunctionCall | null;
                    name?: string;
                    refusal?: string | null;
                    tool_calls?: Array<OpenAIChatCompletionMessageToolCall>;
                    reasoning_content?: string,
                    temporary?: boolean,
                    thinking?: string
                }
                export interface ChatCompletionToolCallMessage extends Message {
                    content: string
                    role: 'tool';
                    tool_call_id: string;
                    is_error?: boolean,
                    temporary?: boolean
                }
                export type OpenAIChatCompletionMessageToolCall =
                    | ChatCompletionMessageFunctionToolCall
                    | ChatCompletionMessageCustomToolCall;
                export interface FunctionCall {
                    arguments: string;
                    name: string;
                }
            }

            export type CompletionMessage = Messages.ChatCompletionSystemMessage | Messages.ChatCompletionAssistantMessage | Messages.ChatCompletionDeveloperMessage | Messages.ChatCompletionToolCallMessage | Messages.ChatCompletionUserMessage

            export interface ChatUsageDetail {
                accepted_prediction_tokens?: number;
                audio_tokens?: number;
                reasoning_tokens?: number;
                rejected_prediction_tokens?: number;
            }

            export interface CompletionUsage {
                completion_tokens: number;
                prompt_tokens: number;
                total_tokens: number;
                completion_tokens_details?: CompletionTokensDetails;
                prompt_tokens_details?: PromptTokensDetails;
                cache_tokens?: number
            }

            export interface CompletionTokensDetails {
                accepted_prediction_tokens?: number;
                audio_tokens?: number;
                reasoning_tokens?: number;
                rejected_prediction_tokens?: number;
                anthropic_server_tool_use?: {
                    web_fetch_requests?: number;
                    web_search_requests?: number
                },
                anthropic_read_input_cache?: number
            }

            export interface PromptTokensDetails {
                audio_tokens?: number;
                cached_tokens?: number;
            }

            export interface CompletionSession {
                sessionId: string | number,
                messages: CompletionMessage[],
                usage: CompletionUsage,
                timestamp: number,

            }

            export interface CompletionContext {
                sessions: CompletionSession[]
                id: string | number,
                latestActive?: number
            }

            export type OnSessionUpdateCallback = (session: CompletionSession) => void
            export type OnStreamResponseCallback = (delta: string, payload: string, reasoningContentDelta?: string, reasoningContentPayload?: string) => void
            export type CompletionMode = 'context' | 'sessionOnly' | 'sessionIsolation'

            export type CompletionTool = OpenAI.Chat.Completions.ChatCompletionTool
        }

    }

    export namespace Tool {

        export type AnyTool = MCPTool<any> | LocalTool<any>
        export type AnyToolParam = AnyTool | DynamicTool<any>

        export type AnyToolkit = ToolGroup<any>

        export namespace MCP {
            export interface MCPToolIOSchema {
                [x: string]: unknown;
                type: "object";
                properties?: {
                    [x: string]: object;
                } | undefined;
                required?: string[] | undefined;
            }

            export type MCPServerParams = StdioServerParameters | URL
        }

    }

    export namespace Skill {

        export interface ModelSkills extends Record<string, string> { }

        export interface SkillFrontmatter<SkillName = string> {
            name: SkillName,
            description: string,
            license?: string,
            metadata?: Record<any, any>,
            compatibility?: string,
            "allowed-tools"?: string[]
        }
    }

    export namespace Platform {
        export namespace OpenAI {
            export interface ClientOptions {
                modelName?: string
                apiKey?: string;
                organization?: string | null | undefined;
                project?: string | null | undefined;
                webhookSecret?: string | null | undefined;
                baseURL?: string | null | undefined;
                timeout?: number | undefined;
                maxRetries?: number | undefined;
                defaultHeaders?: Record<string, string> | undefined;
                defaultQuery?: Record<string, string | undefined> | undefined;
                dangerouslyAllowBrowser?: boolean | undefined;
            }
        }
    }

    export namespace Implements {

        export interface IBaseModel {
            id: string
            modelContexts: Marisa.Chat.Completion.CompletionContext
            modelToolMap: Map<string, Marisa.Tool.AnyTool>
            modelBuiltTools: Marisa.Chat.Completion.CompletionTool[]
            modelCompletionParams: Marisa.Model.ModelCompletionOptions
            modelContextDumpFile?: string
        }

        export interface IModel {

            invoke(
                userPrompt: string,
                onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
                mode?: Marisa.Chat.Completion.CompletionMode
            ): Promise<Marisa.Chat.Completion.CompletionSession>;

            invokeStream(
                userPrompt: string,
                onResponse?: Marisa.Chat.Completion.OnStreamResponseCallback,
                onSessionUpdate?: Marisa.Chat.Completion.OnSessionUpdateCallback,
                mode?: Marisa.Chat.Completion.CompletionMode
            ): Promise<Marisa.Chat.Completion.CompletionSession>;

        }
    }

    export namespace Events {
        export interface Agent {
            toolsRegistered: [tools: { name: string, description: string }[]]
            skillsRegistered: [skills: { name: string, description: string }[]],
            contextLoad: [],
            modelCreate: []
        }

        export interface Model {
            toolCall: [name: string, arguments: Record<string, any>],
            toolCallResult: [name: string, arguments: Record<string, any>, result: any],
            toolCallError: [name: string, arguments: Record<string, any>, error: any],
            sessionEnd: [mode: 'invoke' | 'invokeStream' | 'complete', session: Marisa.Chat.Completion.CompletionSession]
        }

        export interface ModelContextManager {
            sessionPut: [session: Marisa.Chat.Completion.CompletionSession],
            sessionQuery: [query: string, sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string, tip: string],
            sessionSave: [file: string],
            consolidated: [sessions: Marisa.Chat.Completion.CompletionSession[]],
            consolidateSave: []

            summarizeSuccess: [completion: Marisa.Chat.Completion.CompletionSession, updateKnowledgeCount?: number, updateMemoryCount?: number]
            summarizeFail: [error?: Error | string]
            summarizeStart: []
        }

        export namespace AgentComponent {

            export interface Basic {
                installSuccess: [],
                installFail: [reason?: unknown]
            }

            export interface SkillComponent {
                skillRegistered: [skills: ({ type:'file',name: string, path: string } | {type:'def',name:string})[]],
                skillLoadSuccess: [skillName: string],
                skillLoadFail: [skillName: string],
                skillLoad: [skillName: string]
            }

            export interface SubAgentComponent {
                subAgentExecFail: [error?: unknown],
                subAgentExecSuccess: [session: Marisa.Chat.Completion.CompletionSession]
                subAgentCreate: [tasks: {
                    name: string,
                    systemPrompt: string,
                    prompt: string
                }[],
                    parallel: boolean,
                    waitExecResult: boolean],
                subAgentAllSettled: [resultMap: Record<string, string | Marisa.Chat.Completion.CompletionSession>]
            }

            export interface TODOComponent {
                todoCreate: [todo: {
                    title: string,
                    description: string,
                    steps: string[],
                    currentStep: number,
                    uuid: string,
                    status: 'pending' | 'complete' | 'failed'
                }],
                todoUpdate: [todo: {
                    title: string,
                    description: string,
                    steps: string[],
                    currentStep: number,
                    uuid: string,
                    status: 'pending' | 'complete' | 'failed'
                }]
            }

        }

        export interface Model extends ModelContextManager {

        }
    }

    export namespace Provider {
        export namespace OpenAI {

            export type KnownOpenAIChatModel = ('gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4-vision-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-0314' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-0613' | 'gpt-3.5-turbo-16k' | 'gpt-3.5-turbo-16k-0613' | 'o1-preview' | 'o1-mini' | 'o1-2024-12-17')

            export type OpenAIChatModel = KnownOpenAIChatModel | (string & {})
        }
        export namespace OpenAICompatible {

            export type DeepSeekModels =
                | 'deepseek-v3'
                | 'deepseek-v4-pro'
                | 'deepseek-v4-flash'
                | 'deepseek-chat'
                | 'deepseek-reasoner';

            export type MiMoModels =
                | 'mimo-v2-pro'
                | 'mimo-v2-omni'
                | 'mimo-v2.5'

            export type ZhipuModels =
                | 'glm-z1-air'
                | 'glm-z1-airx'
                | 'glm-z1-flash'
                | 'glm-z1-32b-0414'
                | 'glm-z1-rumination-32b-0414'
                | 'glm-4-flash'
                | 'glm-4.7-flash';

            export type DoubaoModels =
                | 'doubao-2.0-pro'
                | 'doubao-2.0-lite'
                | 'doubao-2.0-mini'
                | 'doubao-2.0-code'
                | 'doubao-seed-1.6'
                | 'doubao-seed-1.6-flash'
                | 'doubao-seed-1.6-thinking'
                | 'doubao-seed-1.6-non-thinking'
                | 'doubao-1.5-pro-32k'
                | 'doubao-1.5-pro-256k'
                | 'doubao-1.5-lite-32k'
                | 'doubao-1.5-thinking-pro'
                | 'doubao-1.5-vision-pro-32k'
                | 'doubao-pro-v1'
                | 'doubao-pro-32k'
                | 'doubao-pro-32k-241215';

            export type OpenAICompatibleModel = DeepSeekModels | MiMoModels | ZhipuModels | DoubaoModels | (string & {})
        }
    }

    export namespace Embedding {

        export interface EmbeddingVec {
            embedding: Float32Array | Array<number>;
            index: number;
            object: 'embedding';
        }

        export interface EmbeddingUsage {
            completion_tokens?: number,
            prompt_tokens: number,
            total_tokens: number
        }

        export interface EmbeddingResponse {
            model: string,
            data: EmbeddingVec[],
            object: 'list',
            usage: EmbeddingUsage
        }
    }

    export namespace VecStore {
        export interface VecStoreMemoryMetadata {
            doc: string,
            cate: string
        }
    }
}

