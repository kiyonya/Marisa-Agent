import OpenAI from "openai";
import ToolBase from "./tool-base";
import { z } from 'zod'
import { Marisa } from "../../types/marisa";
import Anthropic from "@anthropic-ai/sdk";


type PermissionChecker = () => boolean | Promise<boolean>
type IPermissions = Record<string, PermissionChecker>
type NonVoidToolResult<T> = T extends void ? never : T

export default class LocalTool<ToolParams extends Record<string, any> = {}, ToolResult = NonVoidToolResult<any>, Permissions = IPermissions> extends ToolBase<ToolParams, ToolResult, Permissions> {

    protected override executor: ((params: ToolParams, permission: Permissions) => ToolResult | Promise<ToolResult>) | null = null;
    public override toolName: string = '';
    public override description: string = '';
    private paramsSchema: Record<keyof ToolParams, z.ZodTypeAny> | null = null;
    private zodSchema: z.ZodObject<Record<keyof ToolParams, z.ZodTypeAny>> | null = null;
    private returnsSchema?: z.ZodAny

    public permissions: Permissions = {} as Permissions

    constructor(toolName: string, description: string, executor: (params: ToolParams, permission: Permissions) => ToolResult | Promise<ToolResult>, paramsSchema: Record<keyof ToolParams, z.ZodTypeAny>, returnsSchema?: z.ZodAny) {
        super()
        this.toolName = toolName;
        this.description = description;
        this.executor = executor;
        this.paramsSchema = paramsSchema;
        this.zodSchema = z.object(paramsSchema);
        this.returnsSchema = returnsSchema
    }

    public setPermission(permission: Permissions) {
        this.permissions = permission
    }

    public async execute(params: ToolParams): Promise<ToolResult> {
        if (!this.executor) {
            throw new Error('Executor not initialized');
        }
        if (this.zodSchema) {
            const validatedParams = this.zodSchema.parse(params) as ToolParams;
            return await this.executor(validatedParams, this.permissions);
        }
        return await this.executor(params, this.permissions);
    }

    public override buildAsOpenAI(): Marisa.Chat.Completion.CompletionTool {
        if (!this.paramsSchema) {
            throw new Error('Params schema not initialized');
        }
        const properties: Record<string, any> = {};
        const required: string[] = [];
        Object.entries(this.paramsSchema).forEach(([key, schema]) => {
            if (schema instanceof z.ZodType) {
                const openAIProps = this.zodTypeToOpenAI(schema);
                properties[key] = openAIProps;
                if (!schema.safeParse(undefined).success && !(schema instanceof z.ZodDefault)) {
                    required.push(key);
                }
            }
        });

        return {
            type: 'function',
            function: {
                name: this.toolName,
                description: this.description,
                parameters: {
                    type: 'object',
                    properties,
                    required,
                },
            },
        };
    }

    private zodTypeToOpenAI(zodSchema: z.ZodTypeAny): Record<string, any> {
        const result: Record<string, any> = {};
        if (zodSchema instanceof z.ZodString) {
            result.type = 'string';
            const checks = (zodSchema as any)._def.checks || [];
            checks.forEach((check: any) => {
                if (check.kind === 'min') {
                    result.minLength = check.value;
                } else if (check.kind === 'max') {
                    result.maxLength = check.value;
                }
            });
        } else if (zodSchema instanceof z.ZodNumber) {
            result.type = 'number';
            const checks = (zodSchema as any)._def.checks || [];
            checks.forEach((check: any) => {
                if (check.kind === 'min') {
                    result.minimum = check.value;
                } else if (check.kind === 'max') {
                    result.maximum = check.value;
                }
            });
        } else if (zodSchema instanceof z.ZodBoolean) {
            result.type = 'boolean';
        } else if (zodSchema instanceof z.ZodArray) {
            result.type = 'array';
            result.items = this.zodTypeToOpenAI((zodSchema as z.ZodArray<any>).element);
        } else if (zodSchema instanceof z.ZodEnum) {
            result.type = 'string';
            result.enum = (zodSchema as z.ZodEnum<any>).options;
        } else if (zodSchema instanceof z.ZodObject) {
            result.type = 'object';
            const shape = (zodSchema as z.ZodObject<any>).shape;
            result.properties = {};
            result.required = [];

            Object.entries(shape).forEach(([key, nestedSchema]) => {
                result.properties[key] = this.zodTypeToOpenAI(nestedSchema as z.ZodTypeAny);
                if (!(nestedSchema as z.ZodTypeAny).safeParse(undefined).success) {
                    result.required.push(key);
                }
            });

        } else if (zodSchema instanceof z.ZodOptional || zodSchema instanceof z.ZodDefault) {
            const innerType = (zodSchema as any)._def.innerType;
            return this.zodTypeToOpenAI(innerType);
        } else if (zodSchema instanceof z.ZodUnion) {
            const options = (zodSchema as z.ZodUnion<any>).options;
            if (options.length > 0) {
                return this.zodTypeToOpenAI(options[0]);
            }
        } else {
            result.type = 'string';
        }

        return result;
    }

    public override buildAsAnthropic(): Anthropic.Messages.ToolUnion {
        if (!this.paramsSchema) {
            throw new Error('Params schema not initialized');
        }

        const properties: Record<string, any> = {};
        const required: string[] = [];

        Object.entries(this.paramsSchema).forEach(([key, schema]) => {
            if (schema instanceof z.ZodType) {
                const anthropicProps = this.zodTypeToAnthropic(schema);
                properties[key] = anthropicProps;
                if (!schema.safeParse(undefined).success && !(schema instanceof z.ZodDefault)) {
                    required.push(key);
                }
            }
        });

        return {
            type: 'custom',
            name: this.toolName,
            input_schema: {
                type: 'object',
                properties,
                required,
            },
        };
    }

    private zodTypeToAnthropic(zodSchema: z.ZodTypeAny): Record<string, any> {
        const result: Record<string, any> = {};

        if (zodSchema instanceof z.ZodString) {
            result.type = 'string';
            const checks = (zodSchema as any)._def.checks || [];
            checks.forEach((check: any) => {
                if (check.kind === 'min') {
                    result.minLength = check.value;
                } else if (check.kind === 'max') {
                    result.maxLength = check.value;
                }
            });
        } else if (zodSchema instanceof z.ZodNumber) {
            result.type = 'number';
            const checks = (zodSchema as any)._def.checks || [];
            checks.forEach((check: any) => {
                if (check.kind === 'min') {
                    result.minimum = check.value;
                } else if (check.kind === 'max') {
                    result.maximum = check.value;
                }
            });
        } else if (zodSchema instanceof z.ZodBoolean) {
            result.type = 'boolean';
        } else if (zodSchema instanceof z.ZodArray) {
            result.type = 'array';
            result.items = this.zodTypeToAnthropic((zodSchema as z.ZodArray<any>).element);
        } else if (zodSchema instanceof z.ZodEnum) {
            result.type = 'string';
            result.enum = (zodSchema as z.ZodEnum<any>).options;
        } else if (zodSchema instanceof z.ZodObject) {
            result.type = 'object';
            const shape = (zodSchema as z.ZodObject<any>).shape;
            result.properties = {};
            result.required = [];

            Object.entries(shape).forEach(([key, nestedSchema]) => {
                result.properties[key] = this.zodTypeToAnthropic(nestedSchema as z.ZodTypeAny);
                if (!(nestedSchema as z.ZodTypeAny).safeParse(undefined).success) {
                    result.required.push(key);
                }
            });
            if (result.required.length === 0) {
                delete result.required;
            }
        } else if (zodSchema instanceof z.ZodOptional || zodSchema instanceof z.ZodDefault) {
            const innerType = (zodSchema as any)._def.innerType;
            return this.zodTypeToAnthropic(innerType);
        } else if (zodSchema instanceof z.ZodUnion) {
            const options = (zodSchema as z.ZodUnion<any>).options;
            const nonNullOptions = options.filter((opt: any) =>
                !(opt instanceof z.ZodUndefined) && !(opt instanceof z.ZodNull)
            );
            if (nonNullOptions.length > 0) {
                return this.zodTypeToAnthropic(nonNullOptions[0]);
            }
        } else if (zodSchema instanceof z.ZodLiteral) {
            const literalValue = (zodSchema as z.ZodLiteral<any>).def.values;
            result.type = typeof literalValue === 'string' ? 'string' :
                typeof literalValue === 'number' ? 'number' :
                    typeof literalValue === 'boolean' ? 'boolean' : 'string';
            if (result.type === 'string') {
                result.enum = [literalValue];
            }
        } else {
            result.type = 'string';
        }
        return result;
    }
}