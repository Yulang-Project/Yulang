import { Token, TokenType } from '../token.js';
import {
    Stmt, LetStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, DeclareFunction, ImportStmt, ConstStmt,
    Parameter, TypeAnnotation, Expr, ExpressionStmt, LiteralExpr, AsExpr, ObjectLiteralExpr, AddressOfExpr
} from '../ast.js';
import { Parser } from './index.js';
import { TypeParser } from './type_parser.js';
import * as fs from 'fs';
import * as path from 'path';
import { Lexer } from '../lexer.js';

export class DeclarationParser {
    private parser: Parser;
    private typeParser: TypeParser;

    constructor(parser: Parser) {
        this.parser = parser;
        this.typeParser = new TypeParser(parser);
    }

    public functionDeclaration(kind: string, isExported: boolean, visibility: Token = new Token(TokenType.PUBLIC, 'public', null, 0, 0), isStatic: boolean = false): FunctionDeclaration { // Add visibility parameter
        const name = this.parser.consume(TokenType.IDENTIFIER, `Expect ${kind} name.`);

        this.parser.consume(TokenType.LPAREN, `Expect '(' after ${kind} name.`);
        const parameters: Parameter[] = [];
        if (!this.parser.check(TokenType.RPAREN)) {
            do {
                if (parameters.length >= 255) {
                    this.parser.error(this.parser.peek(), "Cannot have more than 255 parameters.");
                }
                const paramName = this.parser.consume(TokenType.IDENTIFIER, "Expect parameter name.");
                let paramType: TypeAnnotation | null = null;
                if (this.parser.match(TokenType.COLON)) {
                    paramType = this.typeParser.parse();
                }
                parameters.push(new Parameter(paramName, paramType));
            } while (this.parser.match(TokenType.COMMA));
        }
        this.parser.consume(TokenType.RPAREN, "Expect ')' after parameters.");

        let returnType: TypeAnnotation | null = null;
        if (this.parser.match(TokenType.COLON)) {
            returnType = this.typeParser.parse();
        }

        this.parser.consume(TokenType.LBRACE, `Expect '{' before ${kind} body.`);
        const body = this.parser.block();

        return new FunctionDeclaration(name, parameters, returnType, body, isExported, visibility, null, isStatic);
    }

    public structDeclaration(): StructDeclaration { // NEW: structDeclaration
        let name: Token;
        if (this.parser.match(TokenType.IDENTIFIER, TokenType.STRING)) {
            name = this.parser.previous();
        } else {
            throw this.parser.error(this.parser.peek(), "Expect struct name.");
        }

        this.parser.consume(TokenType.LBRACE, "Expect '{' before struct body.");

        const properties: PropertyDeclaration[] = [];

        while (!this.parser.check(TokenType.RBRACE) && !this.parser.isAtEnd()) {
            // Struct properties are implicitly public.
            const visibility = new Token(TokenType.PUBLIC, 'public', null, this.parser.peek().line, this.parser.peek().column);
            properties.push(this.propertyDeclaration(visibility));
        }
        this.parser.consume(TokenType.RBRACE, "Expect '}' after struct body.");
        return new StructDeclaration(name, properties);
    }
    public letDeclaration(isExported: boolean): LetStmt {
        const letStmt = this.letDeclarationForForLoop(isExported);
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after variable declaration.");
        return letStmt;
    }

    public letDeclarationForForLoop(isExported: boolean): LetStmt {
        const name = this.parser.consume(TokenType.IDENTIFIER, "Expect variable name.");

        let type: TypeAnnotation | null = null;
        if (this.parser.match(TokenType.COLON)) {
            type = this.typeParser.parse();
        }

        let initializer: Expr | null = null;
        if (this.parser.match(TokenType.EQ)) {
            initializer = this.parser.expression();
        }
        // No semicolon consumption here
        return new LetStmt(name, type, initializer, isExported);
    }

    public constDeclaration(isExported: boolean): ConstStmt { // NEW: constDeclaration
        const name = this.parser.consume(TokenType.IDENTIFIER, "Expect constant name.");

        let type: TypeAnnotation | null = null;
        if (this.parser.match(TokenType.COLON)) {
            type = this.typeParser.parse();
        }

        let initializer: Expr | null = null;
        this.parser.consume(TokenType.EQ, "Expect '=' after constant name."); // const requires an initializer
        initializer = this.parser.expression();

        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after constant declaration.");
        return new ConstStmt(name, type, initializer, isExported);
    }

    public usingDeclaration(): Stmt {
        throw this.parser.error(this.parser.peek(), "using is no longer supported. Use import instead.");
    }

    public importDeclaration(): Stmt {
        // Syntax: import { ... } from "path";
        // OR: import * as alias from "path";
        // OR: import "path";
        
        let namespaceAlias: Token | null = null;
        let namedImports: Token[] = [];

        if (this.parser.match(TokenType.LBRACE)) {
            // import { a, b } from "path";
            if (!this.parser.check(TokenType.RBRACE)) {
                do {
                    namedImports.push(this.parser.consume(TokenType.IDENTIFIER, "Expect imported name."));
                } while (this.parser.match(TokenType.COMMA));
            }
            this.parser.consume(TokenType.RBRACE, "Expect '}' after imports.");
            this.parser.consume(TokenType.FROM, "Expect 'from' after import list.");
        } else if (this.parser.match(TokenType.STAR)) {
            // import * as alias from "path";
            this.parser.consume(TokenType.AS, "Expect 'as' after '*'.");
            namespaceAlias = this.parser.consume(TokenType.IDENTIFIER, "Expect alias after 'as'.");
            this.parser.consume(TokenType.FROM, "Expect 'from' after alias.");
        }

        const pathToken = this.parser.consume(TokenType.STRING_LITERAL, "Expect string literal for import path.");
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after import declaration.");

        return new ImportStmt(
            pathToken,
            namespaceAlias,
            namedImports.length > 0 ? namedImports : null
        );
    }

    public resolveImportDeclaration(importStmt: ImportStmt): Stmt[] {
        const modulePath = importStmt.sourcePath.literal as string;
        const fullModulePath = this.resolveImportPath(modulePath);
        const moduleDeclarations = this.loadModuleDeclarations(fullModulePath);

        const exportedMap = new Map<string, Stmt>();
        for (const declaration of moduleDeclarations) {
            const exportName = this.getExportedDeclarationName(declaration);
            if (exportName) {
                exportedMap.set(exportName, declaration);
            }
        }

        if (importStmt.namespaceAlias) {
            this.parser.namespaceImports.set(importStmt.namespaceAlias.lexeme, new Map(
                Array.from(exportedMap.keys()).map((name) => [name, name])
            ));
            return Array.from(exportedMap.values());
        }

        if (importStmt.namedImports && importStmt.namedImports.length > 0) {
            const declarations: Stmt[] = [];
            for (const importedNameToken of importStmt.namedImports) {
                const importedName = importedNameToken.lexeme;
                const declaration = exportedMap.get(importedName);
                if (!declaration) {
                    throw new Error(
                        `Module '${modulePath}' does not export '${importedName}'. (${this.parser.currentFilePath})`
                    );
                }
                declarations.push(declaration);
            }
            return declarations;
        }

        return Array.from(exportedMap.values());
    }

    private resolveImportPath(modulePath: string): string {
        const ensureYuExt = (filePath: string): string => {
            return filePath.endsWith('.yu') ? filePath : `${filePath}.yu`;
        };

        if (modulePath.startsWith('./') || modulePath.startsWith('../')) {
            const currentFileDir = path.dirname(this.parser.currentFilePath);
            return path.resolve(currentFileDir, ensureYuExt(modulePath));
        }

        if (modulePath.startsWith('/')) {
            return path.resolve(ensureYuExt(modulePath));
        }

        return this.parser.finder.getStdLibModulePath(
            this.parser.osIdentifier,
            this.parser.archIdentifier,
            modulePath
        );
    }

    private loadModuleDeclarations(fullModulePath: string): Stmt[] {
        if (this.parser.moduleDeclarations.has(fullModulePath)) {
            return this.parser.moduleDeclarations.get(fullModulePath)!;
        }

        if (!fs.existsSync(fullModulePath)) {
            throw new Error(`Imported module not found: ${fullModulePath}`);
        }

        this.parser.moduleDeclarations.set(fullModulePath, []);

        const source = fs.readFileSync(fullModulePath, 'utf8');
        const lexer = new Lexer(source);
        const tokens = lexer.tokenize();
        const moduleParser = new Parser(
            tokens,
            this.parser.finder,
            this.parser.osIdentifier,
            this.parser.archIdentifier,
            fullModulePath
        );

        moduleParser.moduleDeclarations = this.parser.moduleDeclarations;
        moduleParser.namespaceImports = this.parser.namespaceImports;

        const declarations = moduleParser.parse();
        this.parser.moduleDeclarations.set(fullModulePath, declarations);
        return declarations;
    }

    private getExportedDeclarationName(statement: Stmt): string | null {
        if (statement instanceof FunctionDeclaration && statement.isExported) return statement.name.lexeme;
        if (statement instanceof LetStmt && statement.isExported) return statement.name.lexeme;
        if (statement instanceof ConstStmt && statement.isExported) return statement.name.lexeme;
        if (statement instanceof ClassDeclaration && statement.isExported) return statement.name.lexeme;
        if (statement instanceof StructDeclaration && statement.isExported) return statement.name.lexeme;
        return null;
    }



    public classDeclaration(): ClassDeclaration {
        let name: Token;
        if (this.parser.match(TokenType.IDENTIFIER)) {
            name = this.parser.previous();
        } else {
            throw this.parser.error(this.parser.peek(), "Expect class name.");
        }

        let superclass: any = null;
        if (this.parser.match(TokenType.EXTENDS)) {
            const superclassName = this.parser.consume(TokenType.IDENTIFIER, "Expect superclass name.");
            superclass = { name: superclassName }; // Simplified IdentifierExpr
        }

        this.parser.consume(TokenType.LBRACE, "Expect '{' before class body.");

        const properties: PropertyDeclaration[] = [];
        const methods: FunctionDeclaration[] = [];

        while (!this.parser.check(TokenType.RBRACE) && !this.parser.isAtEnd()) {
            let visibility: Token | null = null;
            let isStatic = false;
            if (this.parser.match(TokenType.PUBLIC, TokenType.PRIVATE)) {
                visibility = this.parser.previous();
            } else {
                visibility = new Token(TokenType.PUBLIC, 'public', null, this.parser.peek().line, this.parser.peek().column);
            }
            if (this.parser.match(TokenType.STATIC)) {
                isStatic = true;
            }

            if (this.parser.match(TokenType.FUN)) {
                if (this.parser.previous().lexeme === 'fun') {
                    throw this.parser.error(this.parser.previous(), "Use 'function' instead of 'fun' inside classes.");
                }
                methods.push(this.functionDeclaration("function", false, visibility, isStatic));
            } else {
                properties.push(this.propertyDeclaration(visibility));
            }
        }
        this.parser.consume(TokenType.RBRACE, "Expect '}' after class body.");
        return new ClassDeclaration(name, superclass, properties, methods);
    }

    public declareFunction(): DeclareFunction {
        this.parser.consume(TokenType.FUN, "Expect 'fun' after 'declare'.");
        const name = this.parser.consume(TokenType.IDENTIFIER, "Expect function name.");

        this.parser.consume(TokenType.LPAREN, "Expect '(' after function name.");
        const parameters: Parameter[] = [];
        if (!this.parser.check(TokenType.RPAREN)) {
            do {
                if (parameters.length >= 255) {
                    this.parser.error(this.parser.peek(), "Cannot have more than 255 parameters.");
                }
                const paramName = this.parser.consume(TokenType.IDENTIFIER, "Expect parameter name.");
                let paramType: TypeAnnotation | null = null;
                if (this.parser.match(TokenType.COLON)) {
                    paramType = this.typeParser.parse();
                }
                parameters.push(new Parameter(paramName, paramType));
            } while (this.parser.match(TokenType.COMMA));
        }
        this.parser.consume(TokenType.RPAREN, "Expect ')' after parameters.");

        let returnType: TypeAnnotation | null = null;
        if (this.parser.match(TokenType.COLON)) {
            returnType = this.typeParser.parse();
        }

        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after declared function signature.");

        return new DeclareFunction(name, parameters, returnType);
    }
    private propertyDeclaration(visibility: Token): PropertyDeclaration { // Accept visibility
        // visibility is already passed, so no need to parse it again here.

        const name = this.parser.consume(TokenType.IDENTIFIER, "Expect property name.");
        let type: TypeAnnotation | null = null;
        if (this.parser.match(TokenType.COLON)) {
            type = this.typeParser.parse();
        }

        let initializer: Expr | null = null;
        if (this.parser.match(TokenType.EQ)) {
            initializer = this.parser.expression();
        }

        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after property declaration.");
        return new PropertyDeclaration(visibility, name, type, initializer); // Pass visibility
    }
}
