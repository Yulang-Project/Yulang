import { Token, TokenType } from '../token.js';
import {
    Expr, BinaryExpr, UnaryExpr, LiteralExpr, GroupingExpr, IdentifierExpr, CallExpr, GetExpr, AssignExpr, ThisExpr, AsExpr, ObjectLiteralExpr, NewExpr, DeleteExpr, 
    AddressOfExpr,
    DereferenceExpr, 
    TypeAnnotation,
    FunctionLiteralExpr,
    Parameter
} from '../ast.js';
import { Parser } from './index.js'; // Import Parser to use it as a type

export class ExpressionParser {
    private parser: Parser;

    constructor(parser: Parser) {
        this.parser = parser;
    }

    public parse(): Expr {
        return this.assignment();
    }

    private assignment(): Expr {
        const expr = this.equality();

        if (this.parser.match(TokenType.EQ)) {
            const equals = this.parser.previous();
            const value = this.assignment();

            if (expr instanceof IdentifierExpr || expr instanceof GetExpr || expr instanceof DereferenceExpr) { // Now DereferenceExpr is a valid target
                return new AssignExpr(expr, value); // expr is now the target
            }
            
            this.parser.error(equals, "Invalid assignment target.");
        }

        return expr;
    }

    // equality       → comparison ( ( "!=" | "==" ) comparison )* ;
    private equality(): Expr {
        let expr = this.logicAnd(); // Changed from this.bitwiseOr()

        while (this.parser.match(TokenType.BANG_EQ, TokenType.EQ_EQ)) {
            const operator = this.parser.previous();
            const right = this.logicAnd(); // Changed from this.bitwiseOr()
            expr = new BinaryExpr(expr, operator, right);
        }

        return expr;
    }

    // NEW: logicAnd → bitwiseOr ( "&&" bitwiseOr )* ;
    private logicAnd(): Expr {
        let expr = this.bitwiseOr();

        while (this.parser.match(TokenType.AMP_AMP)) {
            const operator = this.parser.previous();
            const right = this.bitwiseOr();
            expr = new BinaryExpr(expr, operator, right);
        }
        return expr;
    }

    // NEW: bitwiseOr       → comparison ( "|" comparison )* ;
    private bitwiseOr(): Expr {
        let expr = this.comparison(); // Starts with comparison

        while (this.parser.match(TokenType.PIPE)) {
            const operator = this.parser.previous();
            const right = this.comparison(); // Use comparison for right operand
            expr = new BinaryExpr(expr, operator, right);
        }

        return expr;
    }

    // comparison     → term ( ( ">" | ">=" | "<" | "<=" ) term )* ;
    private comparison(): Expr {
        let expr = this.term();

        while (this.parser.match(TokenType.GT, TokenType.GT_EQ, TokenType.LT, TokenType.LT_EQ)) {
            const operator = this.parser.previous();
            const right = this.term();
            expr = new BinaryExpr(expr, operator, right);
        }

        return expr;
    }

    // term           → factor ( ( "-" | "+" ) factor )* ;
    private term(): Expr {
        let expr = this.factor();

        while (this.parser.match(TokenType.MINUS, TokenType.PLUS)) {
            const operator = this.parser.previous();
            const right = this.factor();
            expr = new BinaryExpr(expr, operator, right);
        }

        return expr;
    }

    // factor         → unary ( ( "/" | "*" ) unary )* ;
    private factor(): Expr {
        let expr = this.unary();

        while (this.parser.match(TokenType.SLASH, TokenType.STAR)) {
            const operator = this.parser.previous();
            const right = this.unary();
            expr = new BinaryExpr(expr, operator, right);
        }

        return expr;
    }

    // unary          → ( "!" | "-" | "delete" | "&" | "*" ) unary | call ;
    private unary(): Expr {
        if (this.parser.match(TokenType.BANG, TokenType.MINUS, TokenType.AMPERSAND, TokenType.STAR)) {
            const operator = this.parser.previous();
            const right = this.unary();
            if (operator.type === TokenType.AMPERSAND) {
                return new AddressOfExpr(right);
            }
            if (operator.type === TokenType.STAR) {
                return new DereferenceExpr(right);
            }
            return new UnaryExpr(operator, right);
        }

        if (this.parser.match(TokenType.DELETE)) {
            const target = this.unary();
            return new DeleteExpr(target);
        }

        return this.call();
    }

    // call           → primary ( "(" arguments? ")" | "." IDENTIFIER )*  | "new" primary ( "." IDENTIFIER )* "(" arguments? ")" ;
    private call(): Expr {
        if (this.parser.match(TokenType.NEW)) {
            // Parse class reference with optional dotted path, then ctor args
            let callee = this.primary();
            while (this.parser.match(TokenType.DOT)) {
                const name = this.parser.consume(TokenType.IDENTIFIER, "Expect property name after '.'.");
                callee = new GetExpr(callee, name);
            }
            let args: Expr[] = [];
            if (this.parser.match(TokenType.LPAREN)) {
                args = this.collectArgs();
                this.parser.consume(TokenType.RPAREN, "Expect ')' after arguments.");
            }
            return new NewExpr(callee, args);
        }

        let expr = this.primary();

        while (true) {
            if (this.parser.match(TokenType.LPAREN)) {
                expr = this.finishCall(expr);
            } else if (this.parser.match(TokenType.DOT)) {
                const name = this.parser.consume(TokenType.IDENTIFIER, "Expect property name after '.'.");
                expr = new GetExpr(expr, name);
            } else if (this.parser.match(TokenType.AS)) { // NEW: Handle 'as' keyword
                const asToken = this.parser.previous(); // The 'as' token itself
                const typeAnnotation = this.parser.typeAnnotation(); // Parse the type after 'as'
                expr = new AsExpr(expr, typeAnnotation);
            }
            else {
                break;
            }
        }

        return expr;
    }

    private finishCall(callee: Expr): CallExpr {
        const args = this.collectArgs();
        const paren = this.parser.consume(TokenType.RPAREN, "Expect ')' after arguments.");
        return new CallExpr(callee, paren, args);
    }

    private collectArgs(): Expr[] {
        const args: Expr[] = [];
        if (!this.parser.check(TokenType.RPAREN)) {
            do {
                if (args.length >= 255) {
                    this.parser.error(this.parser.peek(), "Cannot have more than 255 arguments.");
                }
                args.push(this.parse()); // Use the main parse method of ExpressionParser
            } while (this.parser.match(TokenType.COMMA));
        }
        return args;
    }

    // primary        → NUMBER | STRING_LITERAL | IDENTIFIER | "(" expression ")" | CHAR_LITERAL | OBJECT_LITERAL ;
    private primary(): Expr {
        if (this.parser.match(TokenType.NUMBER, TokenType.STRING_LITERAL, TokenType.CHAR_LITERAL)) {
            return new LiteralExpr(this.parser.previous().literal);
        }

        if (this.parser.match(TokenType.IDENTIFIER, TokenType.SYSCALL, TokenType.ADDROF, TokenType.OBJOF)) {
            return new IdentifierExpr(this.parser.previous());
        }

        if (this.parser.match(TokenType.THIS)) {
            return new ThisExpr(this.parser.previous());
        }

        if (this.parser.match(TokenType.LPAREN)) {
            const expr = this.parse();
            this.parser.consume(TokenType.RPAREN, "Expect ')' after expression.");
            return new GroupingExpr(expr);
        }

        if (this.parser.match(TokenType.LBRACE)) { // NEW: Handle object literal { key: value }
            const properties = new Map<Token, Expr>();
            if (!this.parser.check(TokenType.RBRACE)) { // Check for empty object literal {}
                do {
                    // Key can be an identifier or a string literal
                    const keyToken = this.parser.consume(TokenType.IDENTIFIER, "Expect property name or string literal for object key.");
                    // For now, only identifier keys are supported, but future could support string literals
                    
                    this.parser.consume(TokenType.COLON, "Expect ':' after property name in object literal.");
                    const value = this.parse(); // Parse the value expression
                    properties.set(keyToken, value);
                } while (this.parser.match(TokenType.COMMA));
            }
            this.parser.consume(TokenType.RBRACE, "Expect '}' after object literal.");
            return new ObjectLiteralExpr(properties);
        }

        if (this.parser.match(TokenType.FUN)) { // NEW: Handle function literals
            // Parse parameters
            this.parser.consume(TokenType.LPAREN, "Expect '(' after 'fun'.");
            const parameters: Parameter[] = [];
            if (!this.parser.check(TokenType.RPAREN)) {
                do {
                    if (parameters.length >= 255) {
                        this.parser.error(this.parser.peek(), "Cannot have more than 255 parameters.");
                    }
                    const paramName = this.parser.consume(TokenType.IDENTIFIER, "Expect parameter name.");
                    let paramType: TypeAnnotation | null = null;
                    if (this.parser.match(TokenType.COLON)) {
                        paramType = this.parser.typeAnnotation();
                    }
                    parameters.push(new Parameter(paramName, paramType));
                } while (this.parser.match(TokenType.COMMA));
            }
            this.parser.consume(TokenType.RPAREN, "Expect ')' after parameters.");

            // Parse return type
            let returnType: TypeAnnotation | null = null;
            if (this.parser.match(TokenType.COLON)) {
                returnType = this.parser.typeAnnotation();
            }

            // Parse body
            this.parser.consume(TokenType.LBRACE, "Expect '{' before function body.");
            const body = this.parser.block(); // block() returns a BlockStmt

            return new FunctionLiteralExpr(parameters, returnType, body);
        }
        
        throw this.parser.error(this.parser.peek(), "Expect expression.");
    }
}
