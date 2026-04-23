export type FilterOperator = '==' | '>=' | '<=' | '>' | '<' | '!=' | 'between' | 'in' | 'contains' | 'like';

export type FilterItem =
    | [FilterOperator, any]
    | [FilterOperator, any, any]
    | [FilterOperator, any[]];

export type FilterValue = FilterItem | FilterItem[];

export type FilterCondition<T> =
    | { [K in keyof T]?: FilterValue }
    | { $or: FilterCondition<T>[] }      // OR 组合
    | { $and: FilterCondition<T>[] };    // AND 组合

export class MetadataFilter<T = Record<string, any>> {
    private conditions: FilterCondition<T>;

    constructor(conditions: FilterCondition<T>) {
        this.conditions = conditions;
    }

    toSqlFilter(): { sql: string; params: any[] } {
        return this.parseCondition(this.conditions);
    }

    private parseCondition(condition: FilterCondition<T>): { sql: string; params: any[] } {
        if (Array.isArray(condition)) {
            return this.parseGroupOr(condition);
        } else if (typeof condition === 'object' && condition !== null) {
            return this.parseGroupObject(condition);
        }
        return { sql: '', params: [] };
    }

    private parseGroupOr(conditions: FilterCondition<T>[]): { sql: string; params: any[] } {
        const results = conditions.map(cond => this.parseCondition(cond));
        const validResults = results.filter(r => r.sql);

        if (validResults.length === 0) return { sql: '', params: [] };
        if (validResults.length === 1) return validResults[0] as { sql: string; params: any[] };

        const sql = validResults.map(r => `(${r.sql})`).join(' OR ');
        const params = validResults.flatMap(r => r.params);

        return { sql, params };
    }

    private parseGroupObject(obj: any): { sql: string; params: any[] } {
        const conditions: string[] = [];
        const params: any[] = [];

        for (const [key, value] of Object.entries(obj)) {
            if (key === '$or' && Array.isArray(value)) {
                const result = this.parseGroupOr(value);
                if (result.sql) {
                    conditions.push(`(${result.sql})`);
                    params.push(...result.params);
                }
            }
            else if (key === '$and' && Array.isArray(value)) {
                const results = value.map(cond => this.parseCondition(cond));
                const validResults = results.filter(r => r.sql);
                if (validResults.length > 0) {
                    const andSql = validResults.map(r => `(${r.sql})`).join(' AND ');
                    conditions.push(`(${andSql})`);
                    params.push(...validResults.flatMap(r => r.params));
                }
            }
            else {
                
                const result = this.parseField(key, value as FilterValue);
                if (result.sql) {
                    conditions.push(result.sql);
                    params.push(...result.params);
                }
            }
        }

        if (conditions.length === 0) return { sql: '', params: [] };
        if (conditions.length === 1) return { sql: conditions[0] as string, params };

        return {
            sql: conditions.join(' AND '),
            params
        };
    }

    private parseField(field: string, filterValue: FilterValue): { sql: string; params: any[] } {
        // 如果是数组，表示 OR 组合
        if (Array.isArray(filterValue) && !this._isFilterItem(filterValue)) {
            const results = filterValue.map(item => this.parseField(field, item));
            const validResults = results.filter(r => r.sql);

            if (validResults.length === 0) return { sql: '', params: [] };
            if (validResults.length === 1) return validResults[0] as { sql: string; params: any[] };

            return {
                sql: `(${validResults.map(r => r.sql).join(' OR ')})`,
                params: validResults.flatMap(r => r.params)
            };
        }

        const filterItem = filterValue as FilterItem;
        return this._parseFilterItem(field, filterItem);
    }

    private _isFilterItem(value: any): boolean {
        return Array.isArray(value) &&
            value.length >= 2 &&
            typeof value[0] === 'string' &&
            ['==', '>=', '<=', '>', '<', '!=', 'between', 'in', 'contains', 'like'].includes(value[0]);
    }

    private _parseFilterItem(field: string, item: FilterItem): { sql: string; params: any[] } {
        const [operator, ...values] = item;

        switch (operator) {
            case '==':
                return { sql: `${field} = ?`, params: [values[0]] };

            case '!=':
                return { sql: `${field} != ?`, params: [values[0]] };

            case '>':
                return { sql: `${field} > ?`, params: [values[0]] };

            case '>=':
                return { sql: `${field} >= ?`, params: [values[0]] };

            case '<':
                return { sql: `${field} < ?`, params: [values[0]] };

            case '<=':
                return { sql: `${field} <= ?`, params: [values[0]] };

            case 'between':
                if (values.length === 2) {
                    return { sql: `${field} BETWEEN ? AND ?`, params: [values[0], values[1]] };
                }
                throw new Error(`Invalid between operator for field ${field}`);

            case 'in':
                if (Array.isArray(values[0])) {
                    const placeholders = values[0].map(() => '?').join(',');
                    return { sql: `${field} IN (${placeholders})`, params: values[0] };
                }
                throw new Error(`Invalid in operator for field ${field}`);

            case 'contains':
            case 'like':
                return { sql: `${field} LIKE ?`, params: [`%${values[0]}%`] };

            default:
                throw new Error(`Unsupported operator: ${operator}`);
        }
    }

    public and(...filters: MetadataFilter<T>[]): MetadataFilter<T> {
        const conditions: FilterCondition<T>[] = [this.conditions];
        for (const filter of filters) {
            conditions.push(filter.conditions);
        }
        return new MetadataFilter<T>({ $and: conditions });
    }

    public or(...filters: MetadataFilter<T>[]): MetadataFilter<T> {
        const conditions: FilterCondition<T>[] = [this.conditions];
        for (const filter of filters) {
            conditions.push(filter.conditions);
        }
        return new MetadataFilter<T>({ $or: conditions });
    }
}