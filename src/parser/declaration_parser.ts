import { Token, TokenType } from '../token.js';
import {
    Stmt, LetStmt, FunctionDeclaration, ClassDeclaration, StructDeclaration, PropertyDeclaration, DeclareFunction, ImportStmt, ConstStmt,
    Parameter, TypeAnnotation, Expr, ExpressionStmt, LiteralExpr, AsExpr, ObjectLiteralExpr, AddressOfExpr,
    BinaryExpr, UnaryExpr, IdentifierExpr, GroupingExpr, CallExpr, GetExpr, IndexExpr, AssignExpr, ThisExpr, AwaitExpr,
    NewExpr, DeleteExpr, DereferenceExpr, FunctionLiteralExpr, ArrayLiteralExpr, BlockStmt, IfStmt, WhileStmt, ReturnStmt,
    BasicTypeAnnotation, ArrayTypeAnnotation, PointerTypeAnnotation, FunctionTypeAnnotation, PromiseTypeAnnotation
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
            const prefix = this.getModuleSymbolPrefix(modulePath);
            const exportedNames = new Set(exportedMap.keys());
            this.parser.namespaceImports.set(importStmt.namespaceAlias.lexeme, new Map(
                Array.from(exportedMap.keys()).map((name) => [name, `${prefix}_${name}`])
            ));
            return [
                ...this.cloneImportedDeclarations(this.collectDependencyDeclarations(moduleDeclarations)),
                ...this.cloneImportedDeclarations(Array.from(exportedMap.values()), prefix, exportedNames)
            ];
        }

        if (importStmt.namedImports && importStmt.namedImports.length > 0) {
            const declarations: Stmt[] = [];
            const declarationSet = new Set<Stmt>();
            for (const dependency of this.collectDependencyDeclarations(moduleDeclarations)) {
                declarations.push(dependency);
                declarationSet.add(dependency);
            }
            for (const importedNameToken of importStmt.namedImports) {
                const importedName = importedNameToken.lexeme;
                const declaration = exportedMap.get(importedName);
                if (!declaration) {
                    throw new Error(
                        `Module '${modulePath}' does not export '${importedName}'. (${this.parser.currentFilePath})`
                    );
                }
                if (!declarationSet.has(declaration)) {
                    declarations.push(declaration);
                    declarationSet.add(declaration);
                }
            }
            return this.cloneImportedDeclarations(declarations);
        }

        return this.cloneImportedDeclarations(Array.from(exportedMap.values()));
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

    public getDeclarationName(statement: Stmt): string | null {
        if (statement instanceof FunctionDeclaration) return statement.name.lexeme;
        if (statement instanceof LetStmt) return statement.name.lexeme;
        if (statement instanceof ConstStmt) return statement.name.lexeme;
        if (statement instanceof ClassDeclaration) return statement.name.lexeme;
        if (statement instanceof StructDeclaration) return statement.name.lexeme;
        return null;
    }

    private collectDependencyDeclarations(statements: Stmt[]): Stmt[] {
        const dependencies: Stmt[] = [];
        const exported = new Set<Stmt>();
        for (const statement of statements) {
            if (this.getExportedDeclarationName(statement)) {
                exported.add(statement);
            }
        }
        for (const statement of statements) {
            if (!exported.has(statement)) {
                dependencies.push(statement);
            }
        }
        return dependencies;
    }

    private getModuleSymbolPrefix(modulePath: string): string {
        return modulePath.replace(/[^A-Za-z0-9_]/g, '_');
    }

    private cloneImportedDeclarations(statements: Stmt[], renamePrefix: string | null = null, renamedNames: Set<string> = new Set()): Stmt[] {
        return statements.map((statement) => {
            const cloned = Object.assign(Object.create(Object.getPrototypeOf(statement)), statement) as Stmt;
            if (renamePrefix && cloned instanceof FunctionDeclaration) {
                cloned.name = new Token(
                    cloned.name.type,
                    `${renamePrefix}_${cloned.name.lexeme}`,
                    cloned.name.literal,
                    cloned.name.line,
                    cloned.name.column
                );
                cloned.parameters = cloned.parameters.map(param => this.cloneParameter(param, renamePrefix, renamedNames));
                cloned.returnType = cloned.returnType ? this.cloneTypeAnnotation(cloned.returnType, renamePrefix, renamedNames) : null;
                cloned.body = this.cloneBlockStmt(cloned.body, renamePrefix, renamedNames);
            }
            if (renamePrefix && cloned instanceof ClassDeclaration) {
                cloned.name = new Token(
                    cloned.name.type,
                    `${renamePrefix}_${cloned.name.lexeme}`,
                    cloned.name.literal,
                    cloned.name.line,
                    cloned.name.column
                );
                cloned.superclass = cloned.superclass
                    ? new IdentifierExpr(this.rewriteToken(cloned.superclass.name, renamePrefix, renamedNames))
                    : null;
                cloned.properties = cloned.properties.map(prop => new PropertyDeclaration(
                    prop.visibility,
                    prop.name,
                    prop.type ? this.cloneTypeAnnotation(prop.type, renamePrefix, renamedNames) : null,
                    prop.initializer ? this.rewriteExpr(prop.initializer, renamePrefix, renamedNames) : null
                ));
                cloned.methods = cloned.methods.map(method => new FunctionDeclaration(
                    method.name,
                    method.parameters.map(param => this.cloneParameter(param, renamePrefix, renamedNames)),
                    method.returnType ? this.cloneTypeAnnotation(method.returnType, renamePrefix, renamedNames) : null,
                    this.cloneBlockStmt(method.body, renamePrefix, renamedNames),
                    method.isExported,
                    method.visibility,
                    method.capturedVariables,
                    method.isStatic
                ));
            }
            if (renamePrefix && cloned instanceof StructDeclaration) {
                cloned.name = new Token(
                    cloned.name.type,
                    `${renamePrefix}_${cloned.name.lexeme}`,
                    cloned.name.literal,
                    cloned.name.line,
                    cloned.name.column
                );
                cloned.properties = cloned.properties.map(prop => new PropertyDeclaration(
                    prop.visibility,
                    prop.name,
                    prop.type ? this.cloneTypeAnnotation(prop.type, renamePrefix, renamedNames) : null,
                    prop.initializer ? this.rewriteExpr(prop.initializer, renamePrefix, renamedNames) : null
                ));
            }
            if (renamePrefix && cloned instanceof LetStmt) {
                cloned.name = new Token(
                    cloned.name.type,
                    `${renamePrefix}_${cloned.name.lexeme}`,
                    cloned.name.literal,
                    cloned.name.line,
                    cloned.name.column
                );
                cloned.type = cloned.type ? this.cloneTypeAnnotation(cloned.type, renamePrefix, renamedNames) : null;
                cloned.initializer = cloned.initializer ? this.rewriteExpr(cloned.initializer, renamePrefix, renamedNames) : null;
            }
            if (renamePrefix && cloned instanceof ConstStmt) {
                cloned.name = new Token(
                    cloned.name.type,
                    `${renamePrefix}_${cloned.name.lexeme}`,
                    cloned.name.literal,
                    cloned.name.line,
                    cloned.name.column
                );
                cloned.type = cloned.type ? this.cloneTypeAnnotation(cloned.type, renamePrefix, renamedNames) : null;
                cloned.initializer = cloned.initializer ? this.rewriteExpr(cloned.initializer, renamePrefix, renamedNames) : null;
            }
            if (cloned instanceof FunctionDeclaration
                || cloned instanceof LetStmt
                || cloned instanceof ConstStmt
                || cloned instanceof ClassDeclaration
                || cloned instanceof StructDeclaration) {
                cloned.isExported = false;
            }
            return cloned;
        });
    }

    private cloneParameter(parameter: Parameter, renamePrefix: string, renamedNames: Set<string>): Parameter {
        return new Parameter(
            parameter.name,
            parameter.type ? this.cloneTypeAnnotation(parameter.type, renamePrefix, renamedNames) : null
        );
    }

    private rewriteToken(token: Token, renamePrefix: string, renamedNames: Set<string>): Token {
        if (!renamedNames.has(token.lexeme)) return token;
        return new Token(token.type, `${renamePrefix}_${token.lexeme}`, token.literal, token.line, token.column);
    }

    private cloneTypeAnnotation(type: TypeAnnotation, renamePrefix: string, renamedNames: Set<string>): TypeAnnotation {
        if (type instanceof BasicTypeAnnotation) {
            return new BasicTypeAnnotation(this.rewriteToken(type.name, renamePrefix, renamedNames));
        }
        if (type instanceof ArrayTypeAnnotation) {
            return new ArrayTypeAnnotation(this.cloneTypeAnnotation(type.elementType, renamePrefix, renamedNames));
        }
        if (type instanceof PointerTypeAnnotation) {
            return new PointerTypeAnnotation(this.cloneTypeAnnotation(type.baseType, renamePrefix, renamedNames));
        }
        if (type instanceof FunctionTypeAnnotation) {
            return new FunctionTypeAnnotation(
                type.parameters.map(param => this.cloneTypeAnnotation(param, renamePrefix, renamedNames)),
                this.cloneTypeAnnotation(type.returnType, renamePrefix, renamedNames)
            );
        }
        if (type instanceof PromiseTypeAnnotation) {
            return new PromiseTypeAnnotation(this.cloneTypeAnnotation(type.valueType, renamePrefix, renamedNames));
        }
        return type;
    }

    private cloneBlockStmt(block: BlockStmt, renamePrefix: string, renamedNames: Set<string>): BlockStmt {
        return new BlockStmt(block.statements.map(statement => this.rewriteStmt(statement, renamePrefix, renamedNames)));
    }

    private rewriteStmt(statement: Stmt, renamePrefix: string, renamedNames: Set<string>): Stmt {
        if (statement instanceof ExpressionStmt) {
            return new ExpressionStmt(this.rewriteExpr(statement.expression, renamePrefix, renamedNames));
        }
        if (statement instanceof LetStmt) {
            return new LetStmt(
                statement.name,
                statement.type ? this.cloneTypeAnnotation(statement.type, renamePrefix, renamedNames) : null,
                statement.initializer ? this.rewriteExpr(statement.initializer, renamePrefix, renamedNames) : null,
                statement.isExported
            );
        }
        if (statement instanceof ConstStmt) {
            return new ConstStmt(
                statement.name,
                statement.type ? this.cloneTypeAnnotation(statement.type, renamePrefix, renamedNames) : null,
                statement.initializer ? this.rewriteExpr(statement.initializer, renamePrefix, renamedNames) : null,
                statement.isExported
            );
        }
        if (statement instanceof ReturnStmt) {
            return new ReturnStmt(statement.keyword, statement.value ? this.rewriteExpr(statement.value, renamePrefix, renamedNames) : null);
        }
        if (statement instanceof BlockStmt) {
            return this.cloneBlockStmt(statement, renamePrefix, renamedNames);
        }
        if (statement instanceof IfStmt) {
            return new IfStmt(
                this.rewriteExpr(statement.condition, renamePrefix, renamedNames),
                this.rewriteStmt(statement.thenBranch, renamePrefix, renamedNames),
                statement.elseBranch ? this.rewriteStmt(statement.elseBranch, renamePrefix, renamedNames) : null
            );
        }
        if (statement instanceof WhileStmt) {
            return new WhileStmt(
                this.rewriteExpr(statement.condition, renamePrefix, renamedNames),
                this.rewriteStmt(statement.body, renamePrefix, renamedNames)
            );
        }
        return statement;
    }

    private rewriteExpr(expr: Expr, renamePrefix: string, renamedNames: Set<string>): Expr {
        if (expr instanceof IdentifierExpr) {
            return new IdentifierExpr(this.rewriteToken(expr.name, renamePrefix, renamedNames));
        }
        if (expr instanceof BinaryExpr) {
            return new BinaryExpr(this.rewriteExpr(expr.left, renamePrefix, renamedNames), expr.operator, this.rewriteExpr(expr.right, renamePrefix, renamedNames));
        }
        if (expr instanceof UnaryExpr) {
            return new UnaryExpr(expr.operator, this.rewriteExpr(expr.right, renamePrefix, renamedNames));
        }
        if (expr instanceof GroupingExpr) {
            return new GroupingExpr(this.rewriteExpr(expr.expression, renamePrefix, renamedNames));
        }
        if (expr instanceof CallExpr) {
            return new CallExpr(this.rewriteExpr(expr.callee, renamePrefix, renamedNames), expr.paren, expr.args.map(arg => this.rewriteExpr(arg, renamePrefix, renamedNames)));
        }
        if (expr instanceof GetExpr) {
            return new GetExpr(this.rewriteExpr(expr.object, renamePrefix, renamedNames), expr.name);
        }
        if (expr instanceof IndexExpr) {
            return new IndexExpr(this.rewriteExpr(expr.array, renamePrefix, renamedNames), this.rewriteExpr(expr.index, renamePrefix, renamedNames));
        }
        if (expr instanceof AssignExpr) {
            return new AssignExpr(this.rewriteExpr(expr.target, renamePrefix, renamedNames), this.rewriteExpr(expr.value, renamePrefix, renamedNames));
        }
        if (expr instanceof AsExpr) {
            return new AsExpr(this.rewriteExpr(expr.expression, renamePrefix, renamedNames), this.cloneTypeAnnotation(expr.type, renamePrefix, renamedNames));
        }
        if (expr instanceof AwaitExpr) {
            return new AwaitExpr(this.rewriteExpr(expr.expression, renamePrefix, renamedNames));
        }
        if (expr instanceof ObjectLiteralExpr) {
            return new ObjectLiteralExpr(new Map(Array.from(expr.properties.entries()).map(([key, value]) => [key, this.rewriteExpr(value, renamePrefix, renamedNames)])));
        }
        if (expr instanceof NewExpr) {
            return new NewExpr(this.rewriteExpr(expr.callee, renamePrefix, renamedNames), expr.args.map(arg => this.rewriteExpr(arg, renamePrefix, renamedNames)));
        }
        if (expr instanceof DeleteExpr) {
            return new DeleteExpr(this.rewriteExpr(expr.target, renamePrefix, renamedNames));
        }
        if (expr instanceof AddressOfExpr) {
            return new AddressOfExpr(this.rewriteExpr(expr.expression, renamePrefix, renamedNames));
        }
        if (expr instanceof DereferenceExpr) {
            return new DereferenceExpr(this.rewriteExpr(expr.expression, renamePrefix, renamedNames));
        }
        if (expr instanceof FunctionLiteralExpr) {
            return new FunctionLiteralExpr(
                expr.parameters.map(param => this.cloneParameter(param, renamePrefix, renamedNames)),
                expr.returnType ? this.cloneTypeAnnotation(expr.returnType, renamePrefix, renamedNames) : null,
                this.cloneBlockStmt(expr.body, renamePrefix, renamedNames)
            );
        }
        if (expr instanceof ArrayLiteralExpr) {
            return new ArrayLiteralExpr(expr.elements.map(element => this.rewriteExpr(element, renamePrefix, renamedNames)));
        }
        return expr;
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
