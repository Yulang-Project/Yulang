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

    public functionDeclaration(kind: string, isExported: boolean, visibility: Token = new Token(TokenType.PUBLIC, 'public', null, 0, 0)): FunctionDeclaration { // Add visibility parameter
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

        return new FunctionDeclaration(name, parameters, returnType, body, isExported, visibility);
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
        } else if (this.parser.match(TokenType.ARROW)) { // Handle '->' for implicit address-of assignment
            const targetExpr = this.parser.expression();
            initializer = new AddressOfExpr(targetExpr);
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
        const path = this.parser.consume(TokenType.STRING_LITERAL, "Expect string literal for #using path.");
        this.parser.consume(TokenType.AS, "Expect 'as' after #using path.");
        const alias = this.parser.consume(TokenType.IDENTIFIER, "Expect alias name for #using.");
        let headPath: Token | null = null;
        if (this.parser.match(TokenType.HEAD)) {
            headPath = this.parser.consume(TokenType.STRING_LITERAL, "Expect string literal for #using head path.");
        }
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after #using declaration.");
        // 声明还没做
        return new ExpressionStmt(new LiteralExpr(`USING ${path.lexeme} AS ${alias.lexeme} HEAD ${headPath ? headPath.lexeme : ''}`));
    }
    
    public importDeclaration(): Stmt {
        let namespaceAlias: Token | null = null;
        // Syntax: #import "path" as alias;
        const pathToken = this.parser.consume(TokenType.STRING_LITERAL, "Expect string literal for import path.");
        if (this.parser.match(TokenType.AS)) {
            namespaceAlias = this.parser.consume(TokenType.IDENTIFIER, "Expect alias after 'as'.");
        }
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after import declaration.");

        const modulePath = pathToken.literal as string;
        
        // Resolve module path
        const currentFileDir = path.dirname(this.parser.currentFilePath);
        let fullModulePath: string;
        if (modulePath === 'std') {
            fullModulePath = path.resolve(process.cwd(), 'src/libs/std/std.yu');
        } else if (modulePath.startsWith('std/')) {
            const subPath = modulePath.slice(4); // after "std/"
            fullModulePath = path.resolve(process.cwd(), 'src/libs/std', `${subPath}.yu`);
        } else if (modulePath.startsWith('/')) {
            fullModulePath = path.resolve(modulePath + '.yu');
        } else {
            fullModulePath = path.resolve(currentFileDir, modulePath + '.yu');
        }

        if (!fs.existsSync(fullModulePath)) {
            throw this.parser.error(pathToken, `Module not found: ${fullModulePath}`);
        }

        // Check if module already loaded
        if (this.parser.moduleDeclarations.has(fullModulePath)) {
            // Module already loaded, just return the AST node
            return new ImportStmt(pathToken, namespaceAlias);
        }

        // Load and parse the module
        const moduleSourceCode = fs.readFileSync(fullModulePath, 'utf8');
        const moduleLexer = new Lexer(moduleSourceCode);
        const moduleTokens = moduleLexer.tokenize();
        const moduleParser = new Parser(moduleTokens, fullModulePath); // Pass module's own path for nested imports
        const moduleStatements = moduleParser.parse(); // Recursively parse the module

        // Store module declarations
        this.parser.moduleDeclarations.set(fullModulePath, moduleStatements);

        return new ImportStmt(pathToken, namespaceAlias);
    }



    public classDeclaration(): ClassDeclaration {
        let name: Token;
        if (this.parser.match(TokenType.IDENTIFIER, TokenType.STRING)) {
            name = this.parser.previous();
        } else {
            throw this.parser.error(this.parser.peek(), "Expect class name.");
        }

        this.parser.consume(TokenType.LBRACE, "Expect '{' before class body.");

        const properties: PropertyDeclaration[] = [];
        const methods: FunctionDeclaration[] = [];
        
        while (!this.parser.check(TokenType.RBRACE) && !this.parser.isAtEnd()) {
            let visibility: Token | null = null;
            if (this.parser.match(TokenType.PUBLIC, TokenType.PRIVATE)) {
                visibility = this.parser.previous();
            } else {
                visibility = new Token(TokenType.PUBLIC, 'public', null, this.parser.peek().line, this.parser.peek().column);
            }

            if (this.parser.match(TokenType.FUN)) {
                methods.push(this.functionDeclaration("function", false, visibility));
            } else {
                properties.push(this.propertyDeclaration(visibility));
            }
        }
        this.parser.consume(TokenType.RBRACE, "Expect '}' after class body.");
        return new ClassDeclaration(name, properties, methods);
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
