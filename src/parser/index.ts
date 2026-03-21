import { Token, TokenType } from '../token.js';
import {
    Expr, Stmt, BlockStmt,
    TypeAnnotation,
} from '../ast.js';
import { ExpressionParser } from './expression_parser.js';
import { DeclarationParser } from './declaration_parser.js';
import { StatementParser } from './statement_parser.js';
import { TypeParser } from './type_parser.js';
import type { IFinder } from '../Finder.js'; // NEW: Import IFinder
import { ImportStmt } from '../ast.js';


class ParseError extends Error {
    // 偷懒中...
}

export class Parser {
    public tokens: Token[];
    public current = 0;
    public hadError = false;
    public currentFilePath: string;
    public expressionParser: ExpressionParser;
    public declarationParser: DeclarationParser;
    public statementParser: StatementParser;
    public typeParser: TypeParser;
    public moduleDeclarations: Map<string, Stmt[]> = new Map();
    public namespaceImports: Map<string, Map<string, string>> = new Map();
    public finder: IFinder;
    public osIdentifier: string;
    public archIdentifier: string;


    constructor(tokens: Token[], finder: IFinder, osIdentifier: string, archIdentifier: string, currentFilePath: string = "unknown") { // Modify constructor
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

    public parse(): Stmt[] {
        const statements: Stmt[] = [];
        while (!this.isAtEnd()) {
            const declaration = this.topLevelDeclaration();
            if (declaration !== null) {
                if (declaration instanceof ImportStmt) {
                    const importedDeclarations = this.declarationParser.resolveImportDeclaration(declaration);
                    statements.push(...importedDeclarations);
                    continue;
                }
                statements.push(declaration);
            }
        }
        return statements;
    }

    public topLevelDeclaration(): Stmt | null {
        try {
            const isExported = this.match(TokenType.EXPORT);

            if (this.match(TokenType.CLASS)) {
                const declaration = this.declarationParser.classDeclaration();
                declaration.isExported = isExported;
                return declaration;
            }
            if (this.match(TokenType.STRUCT)) {
                const declaration = this.declarationParser.structDeclaration();
                declaration.isExported = isExported;
                return declaration;
            }
            if (this.match(TokenType.FUN)) return this.declarationParser.functionDeclaration("function", isExported);
            if (this.match(TokenType.LET)) return this.declarationParser.letDeclaration(isExported);
            if (this.match(TokenType.CONST)) return this.declarationParser.constDeclaration(isExported);
            
            if (isExported) {
                // Handle 'export { a, b }' or similar if needed, for now just error
                throw this.error(this.peek(), "Expect 'fun', 'class', 'let', 'const' or 'struct' after 'export'.");
            }

            if (this.match(TokenType.IMPORT)) return this.declarationParser.importDeclaration();
            if (this.match(TokenType.DECLARE)) {
                if (this.match(TokenType.CLASS)) {
                    return this.declarationParser.classDeclaration();
                }
                if (this.match(TokenType.STRUCT)) {
                    return this.declarationParser.structDeclaration();
                }
                return this.declarationParser.declareFunction();
            }

            throw this.error(this.peek(), "Expect a top-level declaration (class, fun, let, const, import, declare, export).");
        } catch (error: any) {
            if (error instanceof ParseError) {
                this.synchronize();
                return null;
            }
            throw error;
        }
    }

    public statementOrLocalDeclaration(): Stmt | null {
        try {
            if (this.match(TokenType.LET)) {
                return this.declarationParser.letDeclaration(false); // Local let
            }
            const stmt = this.statementParser.statement();
            return stmt;
        } catch (error: any) {
            if (error instanceof ParseError) {
                this.synchronize();
                return null;
            }
            throw error;
        }
    }

    public declaration(): Stmt | null { throw new Error("Do not call 'parser.declaration()'. Use 'topLevelDeclaration()' or 'statementOrLocalDeclaration()'."); }

    public statement(): Stmt {
        return this.statementParser.statement();
    }
    
    public block(): BlockStmt {
        return this.statementParser.block();
    }

    public expression(): Expr {
        return this.expressionParser.parse();
    }

    public typeAnnotation(): TypeAnnotation {
        return this.typeParser.parse();
    }

    public match(...types: TokenType[]): boolean {
        // console.log(`Matching against: ${types.join(', ')}`);
        for (const type of types) {
            if (this.check(type)) {
                this.advance();
                return true;
            }
        }
        return false;
    }
    
    public consume(type: TokenType, message: string): Token {
        if (this.check(type)) return this.advance();
        throw this.error(this.peek(), message);
    }

    public check(type: TokenType): boolean {
        if (this.isAtEnd()) return false;
        return this.peek().type === type;
    }

    public advance(): Token {
        if (!this.isAtEnd()) {
            // console.log(`Consuming: ${this.peek().toString()}`);
            this.current++;
        }
        return this.previous();
    }

    public isAtEnd(): boolean {
        return this.peek().type === TokenType.EOF;
    }

    public peek(): Token {
        // console.log(`Peeking at: ${this.tokens[this.current]!.toString()}`);
        return this.tokens[this.current]!;
    }

    public peekNext(): Token { // NEW: peekNext method
        if (this.current + 1 >= this.tokens.length) return new Token(TokenType.EOF, "", null, this.peek().line, this.peek().column);
        return this.tokens[this.current + 1]!;
    }

    public previous(): Token {
        return this.tokens[this.current - 1]!;
    }
    
    public error(token: Token, message: string): ParseError {
        if (token.type === TokenType.EOF) {
            console.error(`[line ${token.line}] Error at end: ${message}`);
        } else {
            console.error(`[line ${token.line}] Error at '${token.lexeme}': ${message}`);
        }
        this.hadError = true;
        return new ParseError();
    }

    private synchronize(): void {
        this.advance();

        while (!this.isAtEnd()) {
            if (this.previous().type === TokenType.SEMICOLON) return;

            switch (this.peek().type) {
                case TokenType.CLASS:
                case TokenType.FUN:
                case TokenType.LET:
                case TokenType.FOR:
                case TokenType.IF:
                case TokenType.WHILE:
                case TokenType.RETURN:
                case TokenType.EXPORT:
                case TokenType.IMPORT:
                    return;
            }

            this.advance();
        }
    }
}
