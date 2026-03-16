import type OpenAI from "openai";
import type { LLMMemory } from "./memory";

export namespace LLMCompletion {

    export interface ChatCompletionDeveloperMessageParamExtend extends OpenAI.Chat.Completions.ChatCompletionDeveloperMessageParam {
        chatTime: number
    }
    export interface ChatCompletionSystemMessageParamExtend extends OpenAI.Chat.Completions.ChatCompletionSystemMessageParam {
        chatTime: number
    }

    export interface ChatCompletionUserMessageParamExtend extends OpenAI.Chat.Completions.ChatCompletionUserMessageParam {
        chatTime: number
    }
    export interface ChatCompletionAssistantMessageParamExtend extends OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam {
        chatTime: number
    }
    export interface ChatCompletionToolMessageParamExtend extends OpenAI.Chat.Completions.ChatCompletionToolMessageParam {
        chatTime: number
    }

    export type CompletionMessage = ChatCompletionDeveloperMessageParamExtend | ChatCompletionSystemMessageParamExtend | ChatCompletionUserMessageParamExtend | ChatCompletionAssistantMessageParamExtend | ChatCompletionToolMessageParamExtend

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

    export interface Usage {

    }

    export namespace LLMClient {
        export type OnSessionUpdateCallback = (session: LLMMemory.ContextSession) => void
        export type LLMCompletionMode = 'context' | 'sessionOnly' | 'sessionIsolation'
    }
}