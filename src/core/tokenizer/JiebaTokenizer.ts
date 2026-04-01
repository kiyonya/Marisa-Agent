import Tokenizer from "./Tokenizer";
import jieba from 'nodejieba'

export default class JiebaTokenizer extends Tokenizer {
    constructor(docs:string){
        super(docs)
    }
    public override tokenize(strict:boolean = true,filter:boolean = true): string[] {
        const tokens = jieba.cut(this.docs,strict)
        if(filter){
            return this.basicFilter(tokens)
        }
        return tokens
    }
}