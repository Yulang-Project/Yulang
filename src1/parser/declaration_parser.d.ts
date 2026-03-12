import { Token } from '../token.js';
import { Stmt, LetStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, DeclareFunction, ConstStmt } from '../ast.js';
import { Parser } from './index.js';
export declare class DeclarationParser {
    private parser;
    private typeParser;
    constructor(parser: Parser);
    functionDeclaration(kind: string, isExported: boolean, visibility?: Token, isStatic?: boolean): FunctionDeclaration;
    structDeclaration(): StructDeclaration;
    letDeclaration(isExported: boolean): LetStmt;
    letDeclarationForForLoop(isExported: boolean): LetStmt;
    constDeclaration(isExported: boolean): ConstStmt;
    usingDeclaration(): Stmt;
    importDeclaration(): Stmt;
    classDeclaration(): ClassDeclaration;
    declareFunction(): DeclareFunction;
    private propertyDeclaration;
}
//# sourceMappingURL=declaration_parser.d.ts.map