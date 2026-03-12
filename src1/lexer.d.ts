import { Token } from './token.js';
export declare class Lexer {
    private source;
    private tokens;
    private start;
    private current;
    private line;
    private column;
    constructor(source: string);
    tokenize(): Token[];
    private isAtEnd;
    private advance;
    private addToken;
    private match;
    private peek;
    private peekNext;
    private isDigit;
    private isAlpha;
    private isAlphaNumeric;
    private isHexDigit;
    private number;
    private hexNumber;
    private string;
    private char;
    private identifierOrKeyword;
    private scanToken;
}
//# sourceMappingURL=lexer.d.ts.map