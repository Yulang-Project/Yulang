// src/parser/type_parser.ts

import { Token, TokenType } from '../token.js';
import {
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation, PromiseTypeAnnotation
} from '../ast.js';
import { Parser } from './index.js';

export class TypeParser {
    private parser: Parser;

    constructor(parser: Parser) {
        this.parser = parser;
    }

    public parse(): TypeAnnotation {
        if (this.parser.check(TokenType.LPAREN) && this.isArrowFunctionTypeStart()) {
            return this.arrowFunctionType();
        }

        if (this.parser.match(TokenType.ARRAY)) {
            this.parser.consume(TokenType.LT, "Expect '<' after 'array'.");
            const elementType = this.parse();
            this.parser.consume(TokenType.GT, "Expect '>' after array element type.");
            return new ArrayTypeAnnotation(elementType);
        }

        if (this.parser.match(TokenType.FUN)) {
            this.parser.consume(TokenType.LT, "Expect '<' after 'fun'.");
            const params: TypeAnnotation[] = [];
            if (!this.parser.check(TokenType.GT)) {
                do {
                    params.push(this.parse());
                } while (this.parser.match(TokenType.COMMA));
            }
            this.parser.consume(TokenType.GT, "Expect '>' after function type parameters.");

            this.parser.consume(TokenType.LT, "Expect '<' for function return type.");
            const returnType = this.parse();
            this.parser.consume(TokenType.GT, "Expect '>' after function return type.");
            return new FunctionTypeAnnotation(params, returnType);
        }

        if (this.parser.match(TokenType.PROMISE)) {
            this.parser.consume(TokenType.LT, "Expect '<' after 'Promise'.");
            const inner = this.parse();
            this.parser.consume(TokenType.GT, "Expect '>' after Promise inner type.");
            return new PromiseTypeAnnotation(inner);
        }

        if (this.parser.match(
            TokenType.STRING,
            TokenType.CHAR,
            TokenType.BOOL,
            TokenType.I32,
            TokenType.I64,
            TokenType.F32,
            TokenType.F64,
            TokenType.OBJECT
        )) {
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
            return new BasicTypeAnnotation(nameToken);
        }

        throw this.parser.error(this.parser.peek(), "Expect type name.");
    }

    private isArrowFunctionTypeStart(): boolean {
        let depth = 0;
        for (let i = this.parser.current; i < this.parser.tokens.length; i++) {
            const token = this.parser.tokens[i]!;
            if (token.type === TokenType.LPAREN) depth++;
            if (token.type === TokenType.RPAREN) {
                depth--;
                if (depth === 0) return this.parser.tokens[i + 1]?.type === TokenType.ARROW;
            }
        }
        return false;
    }

    private arrowFunctionType(): FunctionTypeAnnotation {
        this.parser.consume(TokenType.LPAREN, "Expect '(' before function type parameters.");
        const params: TypeAnnotation[] = [];
        if (!this.parser.check(TokenType.RPAREN)) {
            do {
                if (this.parser.check(TokenType.IDENTIFIER) && this.parser.tokens[this.parser.current + 1]?.type === TokenType.COLON) {
                    this.parser.advance();
                    this.parser.consume(TokenType.COLON, "Expect ':' after function type parameter name.");
                }
                params.push(this.parse());
            } while (this.parser.match(TokenType.COMMA));
        }
        this.parser.consume(TokenType.RPAREN, "Expect ')' after function type parameters.");
        this.parser.consume(TokenType.ARROW, "Expect '=>' in function type.");
        const returnType = this.parse();
        return new FunctionTypeAnnotation(params, returnType);
    }
}
