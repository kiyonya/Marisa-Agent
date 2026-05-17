import ChatModel from "@core/model/chat/chat-model"


export default abstract class ModelEndPoint {
    protected chatModel: ChatModel
    constructor(model: ChatModel) {
        this.chatModel = model
    }

    public abstract start():void
}