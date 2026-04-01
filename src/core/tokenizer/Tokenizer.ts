export default abstract class Tokenizer {
    public docs: string = ''
    private static readonly PUNCTUATION_SET = new Set([
        '，', '。', '、', '；', '：', '？', '！', '…', '—', '～',
        '.', ',', ';', ':', '?', '!', '"', '\'', '(', ')', '[', ']',
        '{', '}', '<', '>', '《', '》', '【', '】', '（', '）', '“', '”',
        '‘', '’', '·', '~', '@', '#', '$', '%', '^', '&', '*', '-',
        '+', '=', '|', '\\', '/', '　', ' ', '\t', '\n', '\r'
    ]);
    private static readonly WORD_REGEX = /[\p{L}\p{N}]+/gu;
    
    constructor(docs: string) {
        this.docs = docs
    }
    public abstract tokenize(): string[]

    protected static isPunctuation(token: string): boolean {
        if (token.length === 0) return false;
        if (token.length === 1) {
            return Tokenizer.PUNCTUATION_SET.has(token);
        }
        return !Tokenizer.WORD_REGEX.test(token);
    }
    protected static isWhitespace(token: string): boolean {
        return /^\s+$/.test(token);
    }

    protected basicFilter(tokens:string[]){
        return tokens.filter(i=>!Tokenizer.isPunctuation(i) && !Tokenizer.isWhitespace(i))
    }
}