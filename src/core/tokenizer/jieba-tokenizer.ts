import Tokenizer from "./tokenizer";
import jieba, { LoadOptions } from 'nodejieba'

export default class JiebaTokenizer extends Tokenizer {
    private nodejieba = jieba
    private searchMode: boolean = true
    constructor(jiebaOptions?: LoadOptions, searchMode: boolean = true) {
        super()
        if (jiebaOptions) {
            this.nodejieba.load(jiebaOptions)
        }
        this.searchMode = searchMode
    }

    public override tokenize(sentence: string): string[] {
        if (this.searchMode) {
            return this.nodejieba.cutForSearch(sentence)
        }
        else {
            return this.nodejieba.cut(sentence)
        }
    }
}