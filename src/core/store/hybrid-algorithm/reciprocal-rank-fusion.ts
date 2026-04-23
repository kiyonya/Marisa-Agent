import { HybridStoreQueryResult } from "../impl/result";
import BaseHybridAlgorithm from "./base-hybrid-algorithm";

export default class ReciprocalRankFusion extends BaseHybridAlgorithm{

    public K: number = 60;
    public vectorWeight: number = 0.7;
    public keywordWeight: number = 0.3;

    constructor(K: number = 60, vectorWeight: number = 0.7, keywordWeight: number = 0.3) {
        super();
        this.K = K;
        this.vectorWeight = vectorWeight;
        this.keywordWeight = keywordWeight;

        if (this.vectorWeight <= 0 || this.keywordWeight <= 0) {
            throw new Error('Weights must be positive numbers');
        }
    }

    public override run<Metadata = any>(vectorResult: HybridStoreQueryResult<Metadata>[], keywordResult: HybridStoreQueryResult<Metadata>[], limit: number): HybridStoreQueryResult<Metadata>[] | Promise<HybridStoreQueryResult<Metadata>[]> {
        if (!Array.isArray(vectorResult) || !Array.isArray(keywordResult)) {
            throw new Error('vectorResult and keywordResult must be arrays');
        }
        if (typeof limit !== 'number' || limit <= 0) {
            throw new Error('limit must be a positive number');
        }

        const fusionScores = new Map<string, {
            rowid: number;
            score: number;
            metadata?: Metadata;
            uuid: string;
            content?: string;
            vectorRank?: number;
            keywordRank?: number;
            vectorOriginalScore?: number;
            keywordOriginalScore?: number;
        }>();

        vectorResult.forEach((result, index) => {
            const rank = index + 1;
            const rrfScore = (1 / (this.K + rank)) * this.vectorWeight;

            if (fusionScores.has(result.uuid)) {
                const existing = fusionScores.get(result.uuid)!;
                existing.score += rrfScore;
                existing.vectorRank = rank;
                existing.vectorOriginalScore = result.score;
            } else {
                fusionScores.set(result.uuid, {
                    rowid: result.rowid,
                    score: rrfScore,
                    metadata: result.metadata,
                    uuid: result.uuid,
                    content: result.content,
                    vectorRank: rank,
                    vectorOriginalScore: result.score
                });
            }
        });

        keywordResult.forEach((result, index) => {
            const rank = index + 1;
            const rrfScore = (1 / (this.K + rank)) * this.keywordWeight;

            if (fusionScores.has(result.uuid)) {
                const existing = fusionScores.get(result.uuid)!;
                existing.score += rrfScore;
                existing.keywordRank = rank;
                existing.keywordOriginalScore = result.score;
            } else {
                fusionScores.set(result.uuid, {
                    rowid: result.rowid,
                    score: rrfScore,
                    metadata: result.metadata,
                    uuid: result.uuid,
                    content: result.content,
                    keywordRank: rank,
                    keywordOriginalScore: result.score
                });
            }
        });

        const sortedResults = Array.from(fusionScores.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

        return sortedResults.map(result => ({
            rowid: result.rowid,
            uuid: result.uuid,
            metadata: result.metadata,
            content: result.content as string,
            score: result.score,
            distance: void 0,
        }));
    }

    public setWeights(vectorWeight: number, keywordWeight: number): void {
        if (vectorWeight <= 0 || keywordWeight <= 0) {
            throw new Error('Weights must be positive numbers');
        }
        this.vectorWeight = vectorWeight;
        this.keywordWeight = keywordWeight;
    }

    public setK(K: number): void {
        if (K <= 0) {
            throw new Error('K must be a positive number');
        }
        this.K = K;
    }
}