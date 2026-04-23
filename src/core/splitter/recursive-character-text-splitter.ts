import TextSplitter from "./text-splitter";

interface TextSplitterConfig {
    chunkSize: number;
    chunkOverlap: number;
    separators?: string[];
}

export default class RecursiveCharacterTextSplitter extends TextSplitter {

    private chunkSize: number;
    private chunkOverlap: number;
    private separators: string[];

    constructor(config: TextSplitterConfig) {
        super()
        this.chunkSize = config.chunkSize;
        this.chunkOverlap = config.chunkOverlap;
        this.separators = config.separators || ["\n\n", "\n", " ", ""];
    }

    public override splitText(text: string): string[] {
        if (!text) return [];
        return this.splitTextRecursive(this.CRLFToLF(text), this.separators);
    }

    private splitTextRecursive(text: string, separators: string[]): string[] {
        const finalChunks: string[] = [];
        let separator = separators[separators.length - 1] as string;
        let remainingSeparators: string[] = [];
        for (let i = 0; i < separators.length; i++) {
            const sep = separators[i];
            if (sep === "") {
                separator = sep;
                remainingSeparators = [];
                break;
            }
            if (sep && text.includes(sep)) {
                separator = sep;
                remainingSeparators = separators.slice(i + 1);
                break;
            }
        }

        let splits: string[];
        if (separator === "") {
            splits = text.split("");
        } else {
            splits = this.splitWithSeparator(text, separator);
        }

        const goodSplits: string[] = [];

        for (const s of splits) {
            if (s.length <= this.chunkSize) {
                goodSplits.push(s);
            } else {
                if (goodSplits.length > 0) {
                    const merged = this.mergeSplits(goodSplits);
                    finalChunks.push(...merged);
                    goodSplits.length = 0;
                }
                if (remainingSeparators.length === 0) {
                    finalChunks.push(s);
                } else {
                    const subChunks = this.splitTextRecursive(s, remainingSeparators);
                    finalChunks.push(...subChunks);
                }
            }
        }

        // 处理剩余的 goodSplits
        if (goodSplits.length > 0) {
            const merged = this.mergeSplits(goodSplits);
            finalChunks.push(...merged);
        }

        return finalChunks;
    }

    private splitWithSeparator(text: string, separator: string): string[] {
        const splits: string[] = [];
        let start = 0;
        let index = text.indexOf(separator);

        while (index !== -1) {
            if (start < index) {
                splits.push(text.substring(start, index));
            }
            splits.push(separator);
            start = index + separator.length;
            index = text.indexOf(separator, start);
        }

        if (start < text.length) {
            splits.push(text.substring(start));
        }

        return splits;
    }

    private mergeSplits(splits: string[]): string[] {
        const chunks: string[] = [];
        let currentChunk = "";

        for (let i = 0; i < splits.length; i++) {
            const split = splits[i] as string;
            const potentialLength = currentChunk.length + split.length || 0;

            if (potentialLength <= this.chunkSize) {
                currentChunk += split;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk);
                    currentChunk = this.applyOverlap(splits, i);
                }
                currentChunk += split;
            }
        }

        if (currentChunk) {
            chunks.push(currentChunk);
        }

        return chunks;
    }

    private applyOverlap(splits: string[], currentIndex: number): string {
        let overlapText = "";
        let accumulatedLength = 0;
        for (let i = currentIndex - 1; i >= 0 && accumulatedLength < this.chunkOverlap; i--) {
            const split = splits[i] as string;
            overlapText = split + overlapText;
            accumulatedLength += split.length;
        }
        if (overlapText.length > this.chunkOverlap) {
            overlapText = overlapText.slice(-this.chunkOverlap);
        }

        return overlapText;
    }

    public static forLanguage(language: string, config: Omit<TextSplitterConfig, 'separators'>): RecursiveCharacterTextSplitter {
        const separators = this.getSeparatorsForLanguage(language);
        return new RecursiveCharacterTextSplitter({
            ...config,
            separators
        });
    }

    private static getSeparatorsForLanguage(language: string): string[] {
        const languageMap: Record<string, string[]> = {
            python: ["\nclass ", "\ndef ", "\n\tdef ", "\n\n", "\n", " ", ""],
            javascript: ["\nfunction ", "\nconst ", "\nlet ", "\nvar ", "\nclass ", "\nif ", "\nfor ", "\nwhile ", "\n\n", "\n", " ", ""],
            java: ["\nclass ", "\npublic ", "\nprotected ", "\nprivate ", "\nstatic ", "\nif ", "\nfor ", "\nwhile ", "\n\n", "\n", " ", ""],
            go: ["\nfunc ", "\nvar ", "\nconst ", "\ntype ", "\nif ", "\nfor ", "\nswitch ", "\n\n", "\n", " ", ""],
            rust: ["\nfn ", "\nconst ", "\nlet ", "\nif ", "\nwhile ", "\nfor ", "\nloop ", "\nmatch ", "\n\n", "\n", " ", ""],
            markdown: ["\n#{1,6} ", "```\n", "\n\n", "\n", " ", ""],
            html: ["<body", "<div", "<p", "<br", "<li", "<h1", "<h2", "<h3", "<h4", "<h5", "<h6", "<span", "<table", "\n\n", "\n", " ", ""],
        };

        return languageMap[language.toLowerCase()] || ["\n\n", "\n", " ", ""];
    }
}