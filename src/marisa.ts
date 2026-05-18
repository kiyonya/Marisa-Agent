import OpenAI from "openai";
import OpenAIAgent from "./core/agent/openai-agent";
import { Marisa as MarisaType } from "@type/marisa";
import OpenAIChatModel from "@core/model/chat/openai-chat-model";
import OpenAIEmbeddingModel from "@core/model/embedding/openai-embedding-model";
import BasicContextManager, { BasicContextManagerOptions } from "@core/contextual/manager/basic-context-manager";
import LayerMarisaMemorySystem, { MemoryOptions } from "@core/contextual/manager/layer-marisa-memory-system";
import ChatModel from "@core/model/chat/chat-model";
import EmbeddingModel from "@core/model/embedding/embedding-model";
import { HybridStore } from "@core/store/hybrid/hybrid-store";
import LongtermCategoricalMemoryManager from "@core/contextual/longterm/longterm-cmemory-manager";
import SqliteHybridStore from "@core/store/hybrid/sqlite-hybrid-store";
import SqliteVecStore from "@core/store/vector/sqlite-vector-store";
import SqliteBM25MessageStore from "@core/store/messages/sqlite-bm25-message-store";
import { SqliteLongtermCategoricalMemoryManager } from "@core/contextual/longterm/sqlite-longterm-cmemory";
import CliEndPoint from "@core/endpoint/cli-endpoint";
import { AgentCliDefaultTools, SubAgentDefaultTools } from "@core/agent/tools/default";
import Bash from "@core/agent/tools/bash";
import OpenFileOrURL from "@core/agent/tools/openfile-url";
import ReadFile from "@core/agent/tools/readfile";
import WriteFile from "@core/agent/tools/writefile";
import AskUserQuestion from "@core/agent/tools/ask-user-question";
import SteamGamePlugin from "./plugins/steam-game";
import TavilySearchPlugin from "./plugins/tavily-search";
import AgentEmojisPlugin from "./plugins/agent-emoji";
import { AboutMe } from "./plugins/me";
import { ModelContextManager } from "@core/contextual/manager/model-context-manager";
import AgentPluginBase from "@core/plugin/agent-plugin-base";
import ChatModelComponent from "@core/model/chat/chat-model-component";
import AgentComponent from "@core/agent/impl/agent-component";
import ToolBase from "@core/tool/tool-base";
import VectorStore from "@core/store/vector/vector-store";
import MessageStore from "@core/store/messages/message-store";
import PermissionAsker from "@core/permission/permission-requestor";
import TextSplitter from "@core/splitter/text-splitter";
import Tokenizer from "@core/tokenizer/tokenizer";
import LocalTool from "@core/tool/local-tool";
import DynamicTool from "@core/tool/dynamic-tool";
import MCPTool from "@core/tool/mcp-tool";
import ToolGroup from "@core/tool/tool-group";

export default class Marisa {

    public static createAgent() {
        return {
            OpenAI(workspace: string, modelName: MarisaType.Provider.OpenAI.OpenAIChatModel, client?: OpenAI) {
                return new OpenAIAgent(workspace, modelName, client)
            },
            OpenAICompatible(workspace: string, modelName: MarisaType.Provider.OpenAICompatible.OpenAICompatibleModel, client?: OpenAI) {
                return new OpenAIAgent(workspace, modelName, client)
            }
        }
    }

    public static createChatModel() {
        return {
            OpenAI(workspace: string, modelName: MarisaType.Provider.OpenAI.OpenAIChatModel, client?: OpenAI) {
                return new OpenAIChatModel(workspace, modelName, client)
            },
            OpenAICompatible(workspace: string, modelName: MarisaType.Provider.OpenAICompatible.OpenAICompatibleModel, client?: OpenAI) {
                return new OpenAIChatModel(workspace, modelName, client)
            }
        }
    }

    public static createEmbeddingModel() {
        return {
            OpenAI(modelName: string, client?: OpenAI) {
                return new OpenAIEmbeddingModel(modelName, client)
            }
        }
    }

    public static Tool = {
        LocalTool,
        DynamicTool,
        MCPTool,
        ToolGroup
    }

    public static Store = {
        Sqlite: {
            createSqliteHybricStore<Metadata extends Record<any, any>>(dbPath: string, dimension?: number) {
                return new SqliteHybridStore<Metadata>(dbPath, dimension)
            },
            createSqliteVectorStore<Metadata extends Record<any, any>>(dbPath: string, dimension: number) {
                return new SqliteVecStore<Metadata>(dbPath, dimension)
            },
            createSqliteBM25MessageStore<Metadata extends Record<any, any>>(dbPath: string) {
                return new SqliteBM25MessageStore<Metadata>(dbPath)
            },
            createSqliteLongtermStore(dbPath: string) {
                return new SqliteLongtermCategoricalMemoryManager(dbPath)
            }
        }
    }

    public static Memory = {
        createBasicMemory(options?: BasicContextManagerOptions) {
            return new BasicContextManager(options)
        },
        createLayerMarisaMemorySystem(summarizeChatModel?: ChatModel, embeddingModel?: EmbeddingModel, embeddingDimension?: number, longtermCategoricalMemoryStore?: LongtermCategoricalMemoryManager, hybridStore?: HybridStore, options?: MemoryOptions) {
            return new LayerMarisaMemorySystem(summarizeChatModel, embeddingModel, embeddingDimension, longtermCategoricalMemoryStore, hybridStore, options)
        }
    }

    public static EndPoint = {
        CliEndPoint: CliEndPoint
    }

    public static BuiltIn = {
        Tool: {
            AgentCliDefaultTools: AgentCliDefaultTools,
            SubAgentDefaultTools: SubAgentDefaultTools,
            Bash: Bash,
            OpenFileOrURL: OpenFileOrURL,
            ReadFile: ReadFile,
            WriteFile: WriteFile,
            AskUserQuestion: AskUserQuestion
        },
        Plugin: {
            SteamGame: SteamGamePlugin,
            Tavily: TavilySearchPlugin,
            PostEmoji: AgentEmojisPlugin,
            Me: AboutMe
        }
    }

    public static Abstract = {
        ModelContextManager,
        AgentPluginBase,
        ChatModelComponent,
        AgentComponent,
        Tool: ToolBase,
        HybridStore,
        VectorStore,
        MessageStore,
        LongtermCategoricalMemoryManager,
        PermissionAsker,
        TextSplitter,
        Tokenizer
    }
}

