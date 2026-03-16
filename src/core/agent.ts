
import { Marisa } from "../types/marisa";
import type BaseModel from "./model/base_model";
import OpenAIModel from "./model/openai_model";
import MCPToolkit from "./mcp/mcp_client";
import Toolkit from "./tool/toolkit";
import EventEmitter from "events";
import fse from 'fs-extra'
import OpenAI from "openai";
import AgentSkills from "./skill/skill";
import LocalTool from "./tool/local_tool";
import path from "path";

export default class Agent extends EventEmitter<Marisa.Events.Agent> {

    private mcpServerParams: Record<string, Marisa.Tool.MCP.MCPServerParams> = {}
    private agentTools: Marisa.Tool.AnyTool[] = []
    private agentToolkits: Toolkit[] = []
    private agentBindSkillDir?: string
    private agentRole?: string
    private agentOptions: Marisa.Agent.AgentCreateOptions
    private agentMemoryFile?: string
    private internalModel: BaseModel | null = null

    constructor(options?: Marisa.Agent.AgentCreateOptions) {
        super()
        this.agentOptions = options || {}
        this.createProjectDir()
    }

    public mcp(serverOptions: Record<string, Marisa.Tool.MCP.MCPServerParams> = {}): this {
        this.mcpServerParams = serverOptions
        return this
    }

    public memory(file: string): this {
        this.agentMemoryFile = file
        return this
    }

    public tool(...tools: Marisa.Tool.AnyTool[]): this {
        this.agentTools = tools
        return this
    }

    public toolkit(...toolkits: Toolkit<any>[]): this {
        this.agentToolkits = toolkits
        return this
    }

    public skill(skillDir: string) {
        this.agentBindSkillDir = skillDir
        return this
    }

    public configModel(config?: Partial<Marisa.Model.ModelCompletionOptions>) {
        this.agentOptions.modelOption = {
            ...this.agentOptions.modelOption,
            ...config
        }
        return this
    }

    public role(rolePrompt: string) {
        this.agentRole = rolePrompt
        return this
    }

    public roleMarkdown(mdFile: string) {
        if (fse.existsSync(mdFile)) {
            const prompt: string = fse.readFileSync(mdFile, 'utf-8')
            this.agentRole = prompt
        }
        return this
    }

    public async create(modelType: 'openai', client: Marisa.Agent.AgentCreateOpenAIOptions): Promise<OpenAIModel>;
    public async create(modelType: Marisa.Agent.ModelType = 'openai', client: Marisa.Agent.AgentCreateOpenAIOptions): Promise<BaseModel> {

        const actualModelType = modelType
        const mcpToolkits: MCPToolkit[] = []
        if (Object.keys(this.mcpServerParams).length) {
            for (const [namespace, param] of Object.entries(this.mcpServerParams)) {
                const mcpToolkit = new MCPToolkit(namespace, param)
                mcpToolkits.push(mcpToolkit)
            }
        }

        const ModelTools: Marisa.Tool.AnyTool[] = [...this.agentTools]
        for (const mcp of mcpToolkits) {
            const tools = await mcp.init()
            ModelTools.push(...tools)
        }

        for (const toolkit of this.agentToolkits) {
            const tools = toolkit.list()
            ModelTools.push(...tools)
        }

        let modelSkillMap:Map<string, Marisa.Skill.ModelSkillMetadata> | undefined = undefined
        let modelSkillLoadTool:LocalTool<{skillName: string}> | undefined = undefined

        if (this.agentBindSkillDir) {
            const agentSkills = new AgentSkills(this.agentBindSkillDir)
            const [_skillMap,_modelSkillLoadFunction] = await agentSkills.registerSkills()
            modelSkillMap = _skillMap
            modelSkillLoadTool = _modelSkillLoadFunction
            ModelTools.push(modelSkillLoadTool)

            const skillEvent = modelSkillMap.values().map(i=>({name:i.name,description:i.description}))
            this.emit('skillsRegistered',Array.from(skillEvent))
        }

        const ModelToolMap = new Map<string, Marisa.Tool.AnyTool>()
        for (const tool of ModelTools) {
            const name = tool.toolName
            if (!name) { continue }
            if (ModelToolMap.has(name)) {
                console.warn(`Duplicate tool name detected: ${name}. The previous tool will be overwritten.`)
            }
            ModelToolMap.set(name, tool)
        }

        const toold = ModelToolMap.values().map(i=>({name:i.toolName,description:i.description}))
        this.emit('toolsRegistered',Array.from(toold))

        let ModelContexts: undefined | Marisa.Chat.Completion.CompletionContext = void 0
        if (this.agentMemoryFile && fse.existsSync(this.agentMemoryFile)) {
            try {
                const memoryStr = await fse.readFile(this.agentMemoryFile, 'utf-8')
                const memory = JSON.parse(memoryStr)
                ModelContexts = memory as Marisa.Chat.Completion.CompletionContext
                this.emit('contextLoad')
            } catch (error) {
            }
        }

        let llmModel: BaseModel | null = null
        if (actualModelType === 'openai') {

            let OpenAIModelName: string | null = null
            let OpenAIModelClient: OpenAI | null = null
            if (client) {
                OpenAIModelName = client.modelName
                if ('client' in client) {
                    OpenAIModelClient = client.client
                }
                else {
                    OpenAIModelClient = new OpenAI(client)
                }
            }
            else {
                throw new Error('Cannot Create Client')
            }

            llmModel = new OpenAIModel({
                modelToolMap: ModelToolMap,
                modelContexts: ModelContexts,
                modelContextDumpFile: this.agentMemoryFile,
                modelRolePrompt: this.agentRole,
                client: OpenAIModelClient,
                modelSkillLoadTool:modelSkillLoadTool,
                modelSkills:modelSkillMap
            }, {
                ...this.agentOptions.modelOption,
                modelName: OpenAIModelName
            })

            this.emit('modelCreate')
        }
        if (!llmModel) {
            throw new Error(`Unsupported model type: ${actualModelType}`)
        }
        this.internalModel = llmModel
        return llmModel
    }

    public getModel() {
        return this.internalModel
    }

    private createProjectDir(){
        const skills = path.join('.marisa/skills')
        const contexts = path.join('.marisa/contexts')
        const roles = path.join('.marisa/roles')
        fse.ensureDirSync(skills)
        fse.ensureDirSync(contexts)
        fse.ensureDirSync(roles)
    }
}