import { ChatCompletionMessageCustomToolCall, ChatCompletionMessageFunctionToolCall } from "openai/resources";
import type { LLMCompletion } from "./completion";
import OpenAI from "openai";
import { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import MCPTool from "../core/tool/MCPTool";
import LocalTool from "../core/tool/LocalTool";
import Toolkit from "../core/tool/Toolkit";

export namespace Marisa {

    export namespace Model {

        export interface ModelCompletionOptions {
            modelName?: string,
            topP?: number
            temperature?: number
            maxCompletionTokens?: number
            promptCacheRetention?: 'in-memory' | '24h' | null
            toolChoice?: | 'none' | 'auto' | 'required'
            parallelToolCalls?: boolean,
            simplifyHistorySession?: boolean,
            enableProgressiveTools?:boolean
        }

        export interface ModelOptions {
            modelContexts?: Marisa.Chat.Completion.CompletionContext,
            modelToolMap?: Map<string, Marisa.Tool.AnyTool>,
            modelContextDumpFile?: string,
            modelRolePrompt?: string,
            modelSkills?: Map<string, Marisa.Skill.ModelSkillMetadata>,
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
                }
                export interface ChatCompletionDeveloperMessage extends Message {
                    content: string
                    role: 'developer';
                    name?: string;
                }
                export interface ChatCompletionUserMessage extends Message {
                    content: string
                    role: 'user';
                    name?: string;
                }
                export interface ChatCompletionAssistantMessageParam extends Message {
                    role: 'assistant';
                    audio?: { id: string } | null;
                    content?: string
                    function_call?: FunctionCall | null;
                    name?: string;
                    refusal?: string | null;
                    tool_calls?: Array<OpenAIChatCompletionMessageToolCall>;
                    reasoning_content?: string
                }
                export interface ChatCompletionToolCallMessage extends Message {
                    content: string
                    role: 'tool';
                    tool_call_id: string;
                }
                export type OpenAIChatCompletionMessageToolCall =
                    | ChatCompletionMessageFunctionToolCall
                    | ChatCompletionMessageCustomToolCall;
                export interface FunctionCall {
                    arguments: string;
                    name: string;
                }
            }

            export type CompletionMessage = Messages.ChatCompletionSystemMessage | Messages.ChatCompletionAssistantMessageParam | Messages.ChatCompletionDeveloperMessage | Messages.ChatCompletionToolCallMessage | Messages.ChatCompletionUserMessage

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
            }

            export interface CompletionTokensDetails {
                accepted_prediction_tokens?: number;
                audio_tokens?: number;
                reasoning_tokens?: number;
                rejected_prediction_tokens?: number;
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
            export type OnStreamResponseCallback = (delta: string, payload: string) => void
            export type CompletionMode = 'context' | 'sessionOnly' | 'sessionIsolation'

            export type CompletionTool = OpenAI.Chat.Completions.ChatCompletionTool
        }

    }

    export namespace Tool {

        export type AnyTool = MCPTool<any> | LocalTool<any>

        export type AnyToolkit = Toolkit<any>

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

        export interface ModelSkillMetadata {
            name: string,
            path: string,
            description: string,
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

        export interface Model  {
            toolCall: [name: string, arguments: Record<string, any>],
            toolCallResult: [name: string, arguments: Record<string, any>, result: any],
            toolCallError: [name: string, arguments: Record<string, any>, error: any],
            sessionEnd: [mode: 'invoke' | 'invokeStream' | 'complete', session: Marisa.Chat.Completion.CompletionSession]
        }

        export interface ModelContextManager {
            sessionPut: [session: Marisa.Chat.Completion.CompletionSession],
            sessionQuery: [query: string, sessions: Marisa.Chat.Completion.CompletionSession[], promptAddition: string, tip: string],
            sessionSave: [file: string],
            consolidated: [session: Marisa.Chat.Completion.CompletionSession],
            consolidateSave: []
        }

        export interface Model extends ModelContextManager {
           
        }
    }

    export namespace Provider {
        export namespace OpenAI {


            export type OpenAIChatModel = string | ('gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-4-turbo-preview' | 'gpt-4-0125-preview' | 'gpt-4-1106-preview' | 'gpt-4-vision-preview' | 'gpt-4' | 'gpt-4-0613' | 'gpt-4-0314' | 'gpt-3.5-turbo' | 'gpt-3.5-turbo-0125' | 'gpt-3.5-turbo-1106' | 'gpt-3.5-turbo-0613' | 'gpt-3.5-turbo-16k' | 'gpt-3.5-turbo-16k-0613' | 'o1-preview' | 'o1-mini' | 'o1-2024-12-17')
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

