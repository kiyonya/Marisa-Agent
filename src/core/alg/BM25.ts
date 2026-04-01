
export default class BM25 {

    private docs: string[][];
    private k1: number;
    private b: number;
    private docLen: number[];
    private avgdl: number;
    private docFreqs: Map<string, number>[];
    private idf: Map<string, number>;

    constructor(docs: string[][], k1: number = 1.5, b: number = 0.75) {
        this.docs = docs;
        this.k1 = k1;
        this.b = b;
        this.docLen = docs.map(doc => doc.length);
        this.avgdl = this.docLen.reduce((sum, len) => sum + len, 0) / docs.length;
        this.docFreqs = [];
        this.idf = new Map();
        this.initialize();
    }

    private initialize(): void {
        const df = new Map<string, number>();
        for (const doc of this.docs) {
            const wordCounter = new Map<string, number>();
            for (const word of doc) {
                wordCounter.set(word, (wordCounter.get(word) || 0) + 1);
            }
            this.docFreqs.push(wordCounter);
            const uniqueWords = new Set(doc);
            for (const word of uniqueWords) {
                df.set(word, (df.get(word) || 0) + 1);
            }
        }

        const totalDocs = this.docs.length;
        for (const [word, freq] of df) {
            const idfValue = Math.log((totalDocs - freq + 0.5) / (freq + 0.5) + 1);
            this.idf.set(word, idfValue);
        }
    }

    public score(docIndex: number, query: string[]): number {
        let score = 0.0;
        const docFreq = this.docFreqs[docIndex];
        const docLength = this.docLen[docIndex];

        for (const word of query) {
            if (docFreq?.has(word)) {
                const freq = docFreq.get(word)!;
                const idf = this.idf.get(word) || 0;
                const numerator = idf * freq * (this.k1 + 1);
                const denominator = freq + this.k1 * (1 - this.b + this.b * (docLength || 0) / this.avgdl);
                score += numerator / denominator;
            }
        }

        return score;
    }

    public scoreAll(query: string[]): number[] {
        const scores: number[] = [];
        for (let i = 0; i < this.docs.length; i++) {
            scores.push(this.score(i, query));
        }
        return scores;
    }

    public getTopK(query: string[], k: number = 10): Array<{ index: number; score: number }> {
        const scores = this.scoreAll(query);
        const indexedScores = scores.map((score, index) => ({ index, score }));
        indexedScores.sort((a, b) => b.score - a.score);
        return indexedScores.slice(0, k);
    }

    public top(query: string[], n: number = 10): Array<{ document: string[]; score: number; index: number }> {
        const scores = this.scoreAll(query);
        const indexedScores = scores.map((score, index) => ({
            index,
            score,
            document: this.docs[index] || []
        }));
        indexedScores.sort((a, b) => b.score - a.score);
        return indexedScores.slice(0, n).filter(i=>i.document.length);
    }
}

// 使用示例（如果需要与jieba分词配合，需要另外处理分词）
// const docs = [
//     ['苹果', '是', '一种', '水果'],
//     ['苹果', '公司', '推出', '新', '产品'],
//     ['我', '喜欢', '吃', '苹果']
// ];
//
// const bm25 = new BM25(docs);
// const query = ['苹果', '水果'];
// const scores = bm25.scoreAll(query);
// console.log(scores);
//
// const topK = bm25.getTopK(query, 2);
// console.log(topK);

