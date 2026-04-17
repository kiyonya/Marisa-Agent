import OpenAI from "openai";
import OpenAIAgent from "./agent/provider/OpenAIAgent";

export default class Marisa {

    public static createOpenAIAgent(modelName:string,client?:OpenAI){
        return new OpenAIAgent(modelName,client)
    }

    public static createOpenAIChatModel(){

    }
    public static createOpenAIEmbeddingModel(){

    }
    public static createSqliteVectorStore(){

    }
    public static createBasicContextManager(){

    }
    public static createLLMSummorizationFileContextManager(){

    }
    public static createLLMSummorizationVecContextManager(){

    }
    public static createVecContextManager(){

    }
}

