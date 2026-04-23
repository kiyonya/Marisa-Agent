import EventEmitter from "node:events";
import { Marisa } from "../../../types/marisa";

export default abstract class EmbeddingModel extends EventEmitter{

    protected modelName:string
    constructor(modelName:string){
        super()
        this.modelName = modelName
    }

    public abstract embedding(input:string | string[] | number[] | number[][],dimensions?:number):Promise<Marisa.Embedding.EmbeddingResponse>
}