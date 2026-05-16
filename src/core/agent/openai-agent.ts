import OpenAI from "openai";
import Agent from "./agent";
import ChatModel from "../model/chat/chat-model";
import EmbeddingModel from "../model/embedding/embedding-model";
import OpenAIChatModel from "../model/chat/openai-chat-model";
import OpenAIEmbeddingModel from "../model/embedding/openai-embedding-model";

export default class OpenAIAgent extends Agent {
    constructor(workspace:string,chatModelName: string, openaiClient?: OpenAI) {
        const client = openaiClient || new OpenAI()
        super(workspace,chatModelName, client)
    }
    protected override createChatModel(client: OpenAI, modelName: string): ChatModel {
        const openaiChatModel = new OpenAIChatModel(this.workspace,modelName, client)
        return openaiChatModel
    }
    protected override createEmbeddingModel(client: OpenAI, modelName: string, dimonsion: number): EmbeddingModel {
        const openaiEmbedding = new OpenAIEmbeddingModel(modelName, client)
        return openaiEmbedding
    }
}