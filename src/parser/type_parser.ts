// src/parser/type_parser.ts

import { Token, TokenType } from '../token.js';
import {
    TypeAnnotation, BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation
} from '../ast.js';
import { Parser } from './index.js';

export class TypeParser {
    private parser: Parser;

    constructor(parser: Parser) {
        this.parser = parser;
    }

    public parse(): TypeAnnotation {
        if (this.parser.match(TokenType.POINTER)) {
            this.parser.consume(TokenType.LPAREN, "Expect '(' after 'pointer'.");
            const baseType = this.parse();
            this.parser.consume(TokenType.RPAREN, "Expect ')' after pointer base type.");
            return new PointerTypeAnnotation(baseType);
        }

        if (this.parser.match(TokenType.FUN)) {
            this.parser.consume(TokenType.LPAREN, "Expect '(' after 'fun'.");
            const params: TypeAnnotation[] = [];
            if (!this.parser.check(TokenType.RPAREN)) {
                do {
                    params.push(this.parse());
                } while (this.parser.match(TokenType.COMMA));
            }
            this.parser.consume(TokenType.RPAREN, "Expect ')' after function type parameters.");

            this.parser.consume(TokenType.LPAREN, "Expect '(' for function return type.");
            const returnType = this.parse();
            this.parser.consume(TokenType.RPAREN, "Expect ')' after function return type.");
            return new FunctionTypeAnnotation(params, returnType);
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
        
        if (this.parser.match(TokenType.ARRAY)) { // Add this block
            this.parser.consume(TokenType.LPAREN, "Expect '(' after 'array'.");
            const elementType = this.parse(); // Recursively parse the element type
            this.parser.consume(TokenType.RPAREN, "Expect ')' after array element type.");
            return new ArrayTypeAnnotation(elementType);
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
}
