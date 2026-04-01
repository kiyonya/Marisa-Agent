import Model from "../model/Model";
import LocalTool from "../tool/LocalTool";

export default class Schedule {
    private model:Model
    
    constructor(model:Model){
        this.model = model
        this.model.defineTools()
    }

    public scheduleTool = new LocalTool()

    public addSchedule() {

    }

    public execSchedule(){

        this.model.invokeStream()
    }
}