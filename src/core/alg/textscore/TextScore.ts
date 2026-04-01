interface ScoreText {
    doc: string,
    score: number,
    index: number
}

import jieba from 'nodejieba'
import Stopwords from './Stopwords';

export default class TextScore {

    public static EntropyScore(txt: string): number {
        txt = this.removePunctuation(txt);
        const len = txt.length;
        const words = jieba.cut(txt, true).map(w => w.trim()).filter(w => w.length > 0);
        const totalWords = words.length;
        if (totalWords === 0) return 0;
        const meaningfulWords = words.filter(w => !Stopwords.has(w));
        if (meaningfulWords.length === 0) return 0.1;
        const wordCount = new Map<string, number>();
        for (const word of meaningfulWords) {
            wordCount.set(word, (wordCount.get(word) || 0) + 1);
        }

        const uniqueRatio = wordCount.size / meaningfulWords.length;
        const frequencies = Array.from(wordCount.values());
        const highFreqCount = frequencies.filter(c => c > meaningfulWords.length * 0.1).length;
        const repetitionPenalty = highFreqCount / wordCount.size;

        let HS = 0;
        for (const count of wordCount.values()) {
            const PW = count / meaningfulWords.length;
            HS += -PW * Math.log2(PW);
        }

        const maxEntropy = Math.log2(wordCount.size);
        const normalizedHS = maxEntropy > 0 ? HS / maxEntropy : 0;

        let lengthPenalty = 1;
        if (len < 20) {
            lengthPenalty = 0.5;
        } else if (len > 500) {
            lengthPenalty = 0.7;
        }

        const diversityScore = uniqueRatio * 0.6 + (1 - repetitionPenalty) * 0.4;
        const finalScore = (normalizedHS * 0.5 + diversityScore * 0.5) * lengthPenalty;

        return finalScore;
    }

    private static removePunctuation(str: string): string {
        const punctuationRegex = /[\u3000-\u303F\uFF00-\uFFEF!\"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~]/g;
        return str.replace(punctuationRegex, '');
    }
}