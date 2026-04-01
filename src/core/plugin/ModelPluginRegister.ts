import { Marisa } from "../../types/marisa";
import Model from "../model/Model";
import Toolkit from "../tool/Toolkit";

export abstract class ModelPluginRegister {
    public abstract Install(modelRegisterMiddleware:ModelRegisterMiddleware):Promise<void>
}

export class ModelRegisterMiddleware {
    private BindModel:Model
    constructor(model:Model){
        this.BindModel = model
    }
    public registerTools(...tools:Marisa.Tool.AnyTool[]){
        this.BindModel.defineTools(...tools)
    }
    public registerToolkits(...toolkits:Toolkit[]){
        for(const toolkit of toolkits){
            this.BindModel.defineTools(...toolkit.list())
        }
    }
}