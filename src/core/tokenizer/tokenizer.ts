
export default abstract class Tokenizer{
    public abstract tokenize(sentence:string):string[] | Promise<string[]>
}