export default class XMLPromptTemplate {
    public object: Record<any, any>;

    constructor(jsonObjectLike: Record<any, any>) {
        this.object = jsonObjectLike;
    }

    public toString(): string {
        return this.convertToXML(this.object, 0);
    }

    private convertToXML(obj: any, indentLevel: number): string {
        if (obj === null || obj === undefined) {
            return '';
        }

        const indent = '  '.repeat(indentLevel); // 2空格缩进
        const nextIndent = '  '.repeat(indentLevel + 1);

        // 处理数组
        if (Array.isArray(obj)) {
            if (obj.length === 0) {
                return '<></>';
            }
            
            let result = '';
            for (const item of obj) {
                const itemStr = this.convertToXML(item, indentLevel + 1);
                result += `${nextIndent}<>\n${itemStr}${nextIndent}</>\n`;
            }
            return result;
        }

        // 处理普通对象
        if (typeof obj === 'object') {
            const keys = Object.keys(obj);
            if (keys.length === 0) {
                return `<${''}></${''}>`;
            }

            let result = '';
            for (const [key, value] of Object.entries(obj)) {
                const valueStr = this.convertToXML(value, indentLevel + 1);
                
                // 判断值是否是多行内容
                if (valueStr.includes('\n')) {
                    result += `${indent}<${key}>\n${valueStr}${indent}</${key}>\n`;
                } else {
                    result += `${indent}<${key}>${valueStr}</${key}>\n`;
                }
            }
            return result;
        }

        // 处理基本类型
        return String(obj);
    }
}