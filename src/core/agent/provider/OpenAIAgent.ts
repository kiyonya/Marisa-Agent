import OpenAI from "openai";
import Agent from "../Agent";
import Model from "../../model/Model";
import EmbeddingModel from "../../model/embedding/EmbeddingModel";
import OpenAIModel from "../../model/provider/OpenAIModel";
import OpenAIEmbeddingModel from "../../model/embedding/provider/OpenAIEmbedding";

export default class OpenAIAgent extends Agent {
    constructor(chatModelName: string, openaiClient?: OpenAI) {
        const client = openaiClient || new OpenAI()
        super(chatModelName, client)
    }
    protected override createChatModel(client: OpenAI, modelName: string): Model {
        const openaiChatModel = new OpenAIModel(modelName, client)
        return openaiChatModel
    }
    protected override createEmbeddingModel(client: OpenAI, modelName: string, dimonsion: number): EmbeddingModel {
        const openaiEmbedding = new OpenAIEmbeddingModel(modelName, client)
        return openaiEmbedding
    }
}