// src/parser/type_parser.ts

import { Token, TokenType } from '../token.js';
import {
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation
} from '../ast.js'; // 移除 PointerTypeAnnotation
import { Parser } from './index.js';

export class TypeParser {
    private parser: Parser;

    constructor(parser: Parser) {
        this.parser = parser;
    }

    public parse(): TypeAnnotation {
        // arrays 和指针语法均禁用；只有基础类型、object、标识符（类/结构/模块类型）。
        if (this.parser.match(TokenType.STRING, TokenType.CHAR, TokenType.INT, TokenType.BOOL, TokenType.FLOAT, TokenType.DOUBLE, TokenType.OBJECT)) {
            return new BasicTypeAnnotation(this.parser.previous());
        }
        
        if (this.parser.match(TokenType.IDENTIFIER)) {
            let nameToken = this.parser.previous();
            if (this.parser.match(TokenType.DOT)) {
                const property = this.parser.consume(TokenType.IDENTIFIER, "Expect property name after '.'.");
                nameToken = new Token(
                    TokenType.IDENTIFIER,
                    `${nameToken.lexeme}.${property.lexeme}`,
                    null,
                    nameToken.line,
                    nameToken.column
                );
            }
            if (nameToken.lexeme.includes('*')) {
                throw this.parser.error(nameToken, "Pointer syntax is not supported.");
            }
            return new BasicTypeAnnotation(nameToken);
        }

        throw this.parser.error(this.parser.peek(), "Expect type name (arrays/pointers are not supported).");
    }
}
