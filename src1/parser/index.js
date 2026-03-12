import { Token, TokenType } from '../token.js';
import { Expr, Stmt, BlockStmt, TypeAnnotation, } from '../ast.js';
import { ExpressionParser } from './expression_parser.js';
import { DeclarationParser } from './declaration_parser.js';
import { StatementParser } from './statement_parser.js';
import { TypeParser } from './type_parser.js';
class ParseError extends Error {
}
export class Parser {
    tokens;
    current = 0;
    hadError = false;
    currentFilePath;
    expressionParser;
    declarationParser;
    statementParser;
    typeParser;
    moduleDeclarations = new Map();
    finder;
    osIdentifier;
    archIdentifier;
    constructor(tokens, finder, osIdentifier, archIdentifier, currentFilePath = "unknown") {
        this.tokens = tokens;
        this.finder = finder;
        this.osIdentifier = osIdentifier;
        this.archIdentifier = archIdentifier;
        this.currentFilePath = currentFilePath;
        this.expressionParser = new ExpressionParser(this);
        this.declarationParser = new DeclarationParser(this);
        this.statementParser = new StatementParser(this);
        this.typeParser = new TypeParser(this);
    }
    parse() {
        const statements = [];
        while (!this.isAtEnd()) {
            const declaration = this.topLevelDeclaration();
            if (declaration !== null) {
                statements.push(declaration);
            }
        }
        return statements;
    }
    topLevelDeclaration() {
        try {
            const isExported = this.match(TokenType.EXPORT);
            if (this.match(TokenType.CLASS))
                return this.declarationParser.classDeclaration();
            if (this.match(TokenType.STRUCT))
                return this.declarationParser.structDeclaration(); // NEW: Handle struct declarations
            if (this.match(TokenType.FUN))
                return this.declarationParser.functionDeclaration("function", isExported);
            if (this.match(TokenType.LET))
                return this.declarationParser.letDeclaration(isExported); // Global let
            if (this.match(TokenType.CONST))
                return this.declarationParser.constDeclaration(isExported); // Global const
            if (isExported) {
                throw this.error(this.peek(), "Expect 'fun', 'class', or 'struct' after 'export'.");
            }
            if (this.match(TokenType.USING))
                return this.declarationParser.usingDeclaration();
            if (this.match(TokenType.IMPORT))
                return this.declarationParser.importDeclaration();
            if (this.match(TokenType.DECLARE)) {
                if (this.match(TokenType.CLASS)) {
                    return this.declarationParser.classDeclaration(); // Re-use classDeclaration for 'declare class'
                }
                if (this.match(TokenType.STRUCT)) {
                    return this.declarationParser.structDeclaration(); // NEW: Handle 'declare struct'
                }
                return this.declarationParser.declareFunction();
            }
            throw this.error(this.peek(), "Expect a top-level declaration (class, fun, let, import, declare, export).");
        }
        catch (error) {
            if (error instanceof ParseError) {
                this.synchronize();
                return null;
            }
            throw error;
        }
    }
    statementOrLocalDeclaration() {
        try {
            if (this.match(TokenType.LET)) {
                return this.declarationParser.letDeclaration(false); // Local let
            }
            const stmt = this.statementParser.statement();
            return stmt;
        }
        catch (error) {
            if (error instanceof ParseError) {
                this.synchronize();
                return null;
            }
            throw error;
        }
    }
    declaration() { throw new Error("Do not call 'parser.declaration()'. Use 'topLevelDeclaration()' or 'statementOrLocalDeclaration()'."); }
    statement() {
        return this.statementParser.statement();
    }
    block() {
        return this.statementParser.block();
    }
    expression() {
        return this.expressionParser.parse();
    }
    typeAnnotation() {
        return this.typeParser.parse();
    }
    match(...types) {
        // console.log(`Matching against: ${types.join(', ')}`);
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }
    consume(type, message) {
        if (this.check(type))
            return this.advance();
        throw this.error(this.peek(), message);
    }
    check(type) {
        if (this.isAtEnd())
            return false;
        return this.peek().type === type;
    }
    advance() {
        if (!this.isAtEnd()) {
            // console.log(`Consuming: ${this.peek().toString()}`);
            this.current++;
        }
        return this.previous();
    }
    isAtEnd() {
        return this.peek().type === TokenType.EOF;
    }
    peek() {
        // console.log(`Peeking at: ${this.tokens[this.current]!.toString()}`);
        return this.tokens[this.current];
    }
    peekNext() {
        if (this.current + 1 >= this.tokens.length)
            return new Token(TokenType.EOF, "", null, this.peek().line, this.peek().column);
        return this.tokens[this.current + 1];
    }
    previous() {
        return this.tokens[this.current - 1];
    }
    error(token, message) {
        if (token.type === TokenType.EOF) {
            console.error(`[line ${token.line}] Error at end: ${message}`);
        }
        else {
            console.error(`[line ${token.line}] Error at '${token.lexeme}': ${message}`);
        }
        this.hadError = true;
        return new ParseError();
    }
    synchronize() {
        this.advance();
        while (!this.isAtEnd()) {
            if (this.previous().type === TokenType.SEMICOLON)
                return;
            switch (this.peek().type) {
                case TokenType.CLASS:
                case TokenType.FUN:
                case TokenType.LET:
                case TokenType.FOR:
                case TokenType.IF:
                case TokenType.WHILE:
                case TokenType.RETURN:
                case TokenType.EXPORT:
                case TokenType.USING:
                case TokenType.IMPORT:
                    return;
            }
            this.advance();
        }
    }
}
//# sourceMappingURL=index.js.map