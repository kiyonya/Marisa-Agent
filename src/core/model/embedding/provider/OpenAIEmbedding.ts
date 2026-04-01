import OpenAI from "openai";
import EmbeddingModel from "../EmbeddingModel";
import { Marisa } from "../../../../types/marisa";

export default class OpenAIEmbeddingModel extends EmbeddingModel {
    private client: OpenAI
    constructor(modelName: string, client: OpenAI) {
        super(modelName)
        this.client = client
    }

    public override async embedding(input: string | string[] | number[] | number[][], dimensions: number = 512): Promise<Marisa.Embedding.EmbeddingResponse> {
        const embeddings = await this.client.embeddings.create({
            model: this.modelName,
            input: input,
            dimensions: dimensions,
            encoding_format:'float'
        })
        return embeddings
    }
}