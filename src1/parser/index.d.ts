import { Token, TokenType } from '../token.js';
import { Expr, Stmt, BlockStmt, TypeAnnotation } from '../ast.js';
import { ExpressionParser } from './expression_parser.js';
import { DeclarationParser } from './declaration_parser.js';
import { StatementParser } from './statement_parser.js';
import { TypeParser } from './type_parser.js';
import type { IFinder } from '../Finder.js';
declare class ParseError extends Error {
}
export declare class Parser {
    tokens: Token[];
    current: number;
    hadError: boolean;
    currentFilePath: string;
    expressionParser: ExpressionParser;
    declarationParser: DeclarationParser;
    statementParser: StatementParser;
    typeParser: TypeParser;
    moduleDeclarations: Map<string, Stmt[]>;
    finder: IFinder;
    osIdentifier: string;
    archIdentifier: string;
    constructor(tokens: Token[], finder: IFinder, osIdentifier: string, archIdentifier: string, currentFilePath?: string);
    parse(): Stmt[];
    topLevelDeclaration(): Stmt | null;
    statementOrLocalDeclaration(): Stmt | null;
    declaration(): Stmt | null;
    statement(): Stmt;
    block(): BlockStmt;
    expression(): Expr;
    typeAnnotation(): TypeAnnotation;
    match(...types: TokenType[]): boolean;
    consume(type: TokenType, message: string): Token;
    check(type: TokenType): boolean;
    advance(): Token;
    isAtEnd(): boolean;
    peek(): Token;
    peekNext(): Token;
    previous(): Token;
    error(token: Token, message: string): ParseError;
    private synchronize;
}
export {};
//# sourceMappingURL=index.d.ts.map