import Anthropic from "@anthropic-ai/sdk";
import { ToolChoiceAny, ToolChoiceAuto, ToolChoiceNone, ToolChoiceTool } from "@anthropic-ai/sdk/resources";
import { Marisa } from "@type/marisa";

export function convertToolChoice(toolChoice: 'none', parallel?: boolean): ToolChoiceNone
export function convertToolChoice(toolChoice: 'auto', parallel?: boolean): ToolChoiceAuto
export function convertToolChoice(toolChoice: 'any', parallel?: boolean): ToolChoiceAny
export function convertToolChoice(toolChoice: 'required', parallel?: boolean): ToolChoiceTool
export function convertToolChoice(toolChoice: 'required', toolName: string, parallel?: boolean): ToolChoiceTool
export function convertToolChoice(toolChoice?: 'none' | 'auto' | 'any' | 'required', parallel?: boolean): ToolChoiceAuto | ToolChoiceNone | ToolChoiceAny | ToolChoiceTool
export function convertToolChoice(
    toolChoice?: 'none' | 'auto' | 'any' | 'required',
    toolNameOrParallel?: string | boolean,
    parallel?: boolean
): ToolChoiceNone | ToolChoiceAuto | ToolChoiceAny | ToolChoiceTool {
    let actualToolChoice = toolChoice || 'auto'
    let actualToolName: string | undefined
    let actualParallel: boolean = true

    if (typeof toolNameOrParallel === 'string') {
        actualToolName = toolNameOrParallel
        actualParallel = parallel !== undefined ? parallel : true
    } else if (typeof toolNameOrParallel === 'boolean') {
        actualParallel = toolNameOrParallel
        actualToolName = undefined
    }

    switch (actualToolChoice) {
        case "none":
            return { type: 'none' }

        case "auto":
            return {
                type: 'auto',
                disable_parallel_tool_use: !actualParallel
            }

        case "any":
            return {
                type: 'any',
                disable_parallel_tool_use: !actualParallel
            }

        case "required":
            if (!actualToolName) {
                throw new Error('When toolChoice is "required", you must provide a tool name')
            }
            return {
                type: 'tool',
                name: actualToolName,
                disable_parallel_tool_use: !actualParallel
            }

        default:
            return {
                type: 'auto',
                disable_parallel_tool_use: !actualParallel
            }
    }
}


export function convertToolUse(v: Anthropic.Messages.ToolUseBlock): Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall {
    const call: Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall = {
        id: v.id,
        function: {
            arguments: v.input as string,
            name: v.name
        },
        type: 'function'
    }
    return call
}

export function convertServerToolUse(v: Anthropic.Messages.ServerToolUseBlock): Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall {
    const call: Marisa.Chat.Completion.Messages.OpenAIChatCompletionMessageToolCall = {
        id: v.id,
        function: {
            arguments: v.input as string,
            name: v.name
        },
        type: 'function'
    }
    return call
}

export function convertUsage(u:Anthropic.Messages.Usage):Marisa.Chat.Completion.CompletionUsage{
    const usage:Marisa.Chat.Completion.CompletionUsage = {
        completion_tokens:u.output_tokens,
        prompt_tokens:u.input_tokens,
        total_tokens:u.output_tokens + u.input_tokens,
        completion_tokens_details:{
            anthropic_server_tool_use:{
                web_fetch_requests:u.server_tool_use?.web_fetch_requests || undefined,
                web_search_requests:u.server_tool_use?.web_search_requests || undefined
            },
            anthropic_read_input_cache:u.cache_read_input_tokens || undefined
        }
    }
    return usage
}