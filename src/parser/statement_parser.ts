// src/parser/statement_parser.ts

import { Token, TokenType } from '../token.js';
import {
    Stmt, ExpressionStmt, IfStmt, WhileStmt, ReturnStmt, BlockStmt, LetStmt, MacroBlockStmt,
    Expr, LiteralExpr, FunctionLiteralExpr, FunctionTypeAnnotation, TypeAnnotation, BasicTypeAnnotation // Added new AST imports
} from '../ast.js';
import { Parser } from './index.js'; // Import Parser from the main parser file

export class StatementParser {
    private parser: Parser;

    constructor(parser: Parser) {
        this.parser = parser;
    }

    public statement(): Stmt {
        if (this.parser.match(TokenType.MACRO)) return this.macroBlockStatement(); // NEW
        if (this.parser.match(TokenType.IF)) return this.ifStatement();
        if (this.parser.match(TokenType.WHILE)) return this.whileStatement();
        if (this.parser.match(TokenType.FOR)) return this.forStatement(); // NEW: Handle for loop
        if (this.parser.match(TokenType.RETURN)) return this.returnStatement();
        if (this.parser.match(TokenType.LBRACE)) return this.block();
        if (this.parser.match(TokenType.FUN)) { // Handle local function declarations (desugar into let name = fun(...) { ... };)
            const funcDecl = this.parser.declarationParser.functionDeclaration("function", false); // Parse as FunctionDeclaration
            
            // Create a FunctionLiteralExpr from the parsed FunctionDeclaration parts
            const funcLiteral = new FunctionLiteralExpr(funcDecl.parameters, funcDecl.returnType, funcDecl.body);

            // Create a FunctionTypeAnnotation for the 'let' statement's type
            const paramTypesForFuncType = funcDecl.parameters.map(p => p.type || null);
            const returnTypeForFuncType = funcDecl.returnType || null;
            const funcTypeAnnotation = new FunctionTypeAnnotation(paramTypesForFuncType as TypeAnnotation[], returnTypeForFuncType as TypeAnnotation);

            // Return a LetStmt that defines the function name as a variable holding the function literal (closure)
            return new LetStmt(funcDecl.name, funcTypeAnnotation, funcLiteral, false); // Local functions are not exported
        }
        
        return this.expressionStatement();
    }

    private forStatement(): Stmt {
        this.parser.consume(TokenType.LPAREN, "Expect '(' after 'for'.");

        let initializer: Stmt | null = null;
        if (this.parser.check(TokenType.LET)) { // It's a 'let' declaration
            this.parser.advance(); // consume 'let'
            initializer = this.parser.declarationParser.letDeclarationForForLoop(false);
        } else if (!this.parser.check(TokenType.SEMICOLON)) { // It's an expression or empty
            initializer = new ExpressionStmt(this.parser.expression());
        }
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after for initializer.");

        let condition: Expr | null = null;
        if (!this.parser.check(TokenType.SEMICOLON)) {
            condition = this.parser.expression();
        }
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after for condition.");

        let increment: Stmt | null = null;
        if (!this.parser.check(TokenType.RPAREN)) {
            increment = new ExpressionStmt(this.parser.expression()); // Increment is an ExpressionStmt
        }
        this.parser.consume(TokenType.RPAREN, "Expect ')' after for clauses.");

        const body = this.statement(); // The loop body

        // --- AST transformation: for (init; cond; post) { body } -> init; while (cond) { body; post; } ---
        const loopStatements: Stmt[] = [body];
        if (increment) {
            loopStatements.push(increment);
        }
        const whileBody = new BlockStmt(loopStatements);

        const whileStmt = new WhileStmt(condition || new LiteralExpr(true), whileBody); // Default true condition if none given

        const resultStatements: Stmt[] = [];
        if (initializer) {
            resultStatements.push(initializer);
        }
        resultStatements.push(whileStmt);

        return new BlockStmt(resultStatements); // Return a block containing init and the while loop
    }

    private returnStatement(): ReturnStmt {
        const keyword = this.parser.previous();
        let value: Expr | null = null;
        if (!this.parser.check(TokenType.SEMICOLON)) {
            value = this.parser.expression();
        }
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after return value.");
        return new ReturnStmt(keyword, value);
    }

    private ifStatement(): IfStmt {
        this.parser.consume(TokenType.LPAREN, "Expect '(' after 'if'.");
        const condition = this.parser.expression();
        this.parser.consume(TokenType.RPAREN, "Expect ')' after if condition.");

        const thenBranch = this.statement();
        let elseBranch: Stmt | null = null;
        if (this.parser.match(TokenType.ELSE)) {
            elseBranch = this.statement();
        }

        return new IfStmt(condition, thenBranch, elseBranch);
    }

    private whileStatement(): WhileStmt {
        this.parser.consume(TokenType.LPAREN, "Expect '(' after 'while'.");
        const condition = this.parser.expression();
        this.parser.consume(TokenType.RPAREN, "Expect ')' after while condition.");

        const body = this.statement();
        return new WhileStmt(condition, body);
    }

    public block(): BlockStmt { // public because declaration_parser needs it
        const statements: Stmt[] = [];
        while (!this.parser.check(TokenType.RBRACE) && !this.parser.isAtEnd()) {
            const decl = this.parser.statementOrLocalDeclaration();
            if (decl !== null) {
                statements.push(decl);
            }
        }

        this.parser.consume(TokenType.RBRACE, "Expect '}' after block.");
        return new BlockStmt(statements);
    }

    private expressionStatement(): ExpressionStmt {
        const expr = this.parser.expression();
        this.parser.consume(TokenType.SEMICOLON, "Expect ';' after expression.");
        return new ExpressionStmt(expr);
    }

    private macroBlockStatement(): MacroBlockStmt {
        this.parser.consume(TokenType.LPAREN, "Expect '(' after 'macro'.");
        const macroTypeToken = this.parser.consume(TokenType.IDENTIFIER, "Expect macro type (e.g., 'unsafe') after '('.");
        // Validate macroTypeToken is a known macro type, e.g., TokenType.UNSAFE
        // Here, we check the actual TokenType of the identified macro type
        if (macroTypeToken.type !== TokenType.UNSAFE) { // Future: extend to other macro types
            this.parser.error(macroTypeToken, `Unknown macro type '${macroTypeToken.lexeme}'. Only 'unsafe' is supported for now.`);
        }
        this.parser.consume(TokenType.RPAREN, "Expect ')' after macro type.");
        this.parser.consume(TokenType.LBRACE, "Expect '{' before macro block body.");
        const body = this.block(); // Reuse existing block parsing
        return new MacroBlockStmt(macroTypeToken, body);
    }
}
