export default abstract class TextSplitter {

    public abstract splitText(txt:string):string[] 

    protected CRLFToLF(text: string): string {
        return text.replace(/\r\n/g, '\n');
    }
}